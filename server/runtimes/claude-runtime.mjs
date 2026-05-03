import os from 'node:os';
import path from 'node:path';
import { buildClaudePrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP, ACTION_WRITE_REPLY } from '../core/constants.mjs';
import { buildRuntimePageBundleFetchPrompt } from '../core/mcp-page-bundle.mjs';
import {
  buildClaudePermissionArgs,
  buildPermissionStatus,
  hasClaudePermissionArgs,
  normalizePermissionMode,
} from '../core/permission-mode.mjs';
import { runCommand } from './exec-utils.mjs';
import { ClaudeCliSession } from './claude-cli-session.mjs';
import { MCPConfigWatcher } from './mcp-config-watcher.mjs';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

export class ClaudeRuntime {
  constructor(log, options = {}) {
    this.id = 'claude';
    this.label = 'Claude Code';
    this.log = log;
    this.context = null;
    this.cwd = options.cwd || process.cwd();
    this.permissionMode = normalizePermissionMode(options.permissionMode || process.env.NOTION2CLI_PERMISSION_MODE);
    this.model = process.env.NOTION2CLI_CLAUDE_MODEL || '';
    const configuredExtraArgs = Array.isArray(options.extraArgs)
      ? options.extraArgs
      : parseArgs(process.env.NOTION2CLI_CLAUDE_EXTRA_ARGS || '');
    this.extraArgs = hasClaudePermissionArgs(configuredExtraArgs)
      ? configuredExtraArgs
      : [...buildClaudePermissionArgs(this.permissionMode), ...configuredExtraArgs];
    this.ready = false;
    this.statusMessage = 'Waiting to check Claude Code.';
    this.runningJobs = new Map();
    this.mcpConfigWatcher = null;
  }

  async start(context) {
    this.context = context;
    try {
      const result = await runCommand('claude', ['--version'], { cwd: this.cwd, timeoutMs: 4000 });
      this.ready = result.code === 0;
      this.statusMessage = this.ready
        ? `Claude Code is ready (${compactCommandOutput(result) || 'version unknown'}).`
        : (result.stderr.trim() || 'Claude Code is not ready.');
    } catch (error) {
      this.ready = false;
      this.statusMessage = error?.message || 'Unable to start the claude command.';
    }

    if (this.ready) {
      this.mcpConfigWatcher = new MCPConfigWatcher({
        configPaths: [
          path.join(os.homedir(), '.claude.json'),
          path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json'),
          path.join(os.homedir(), '.claude', 'mcp_settings.json'),
        ],
        runProbe: () => probeNotionMcpStatusViaCli({ cwd: this.cwd, log: this.log }),
        log: this.log,
      });
      await this.mcpConfigWatcher.start();
    }
  }

  async stop() {
    for (const session of this.runningJobs.values()) {
      session.shutdown();
    }
    this.runningJobs.clear();

    this.mcpConfigWatcher?.stop();
    this.mcpConfigWatcher = null;
  }

  async startPairing() {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Claude Code is not ready');
    }
  }

  async fetchPageBundle({ jobId, pageUrl, pageTitle }) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Claude Code is not ready');
    }

    const prompt = buildRuntimePageBundleFetchPrompt({
      pageUrl,
      pageTitle,
      runtimeLabel: 'the local Claude Code runtime',
    });
    const sessionPrompts = await this.prepareNotionAwarePrompts({
      prompt,
      requiresNotionAuth: true,
    });
    this.log('claude page bundle fetch requested', {
      jobId,
      pageUrl,
      pageTitle,
    });

    const result = await this.runManagedPrompt({
      jobId: jobId || `prefetch-${Date.now()}`,
      prompt: sessionPrompts.prompt,
      resumePromptAfterApproval: sessionPrompts.resumePromptAfterApproval,
      addDirs: [this.cwd],
      phase: 'page_bundle_fetch',
      dispatchType: 'claude_page_bundle_fetch_requested',
      runningType: 'claude_page_bundle_fetch_running',
      waitingType: 'claude_page_bundle_fetch_waiting_for_approval',
    });

    this.log('claude page bundle fetch completed', {
      jobId,
      pageUrl,
      pageTitle,
      sessionId: result.sessionId,
      replyChars: result.replyText.length,
    });
    return result.replyText;
  }

  async dispatchJob(job) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Claude Code is not ready');
    }

    if (job.action === ACTION_INSTALL_NOTION_MCP) {
      await this.installNotionMcp(job);
      return;
    }

    const prompt = buildClaudePrompt(job, {
      notionMcpHint: 'Use the configured Notion MCP tools when the action requires full-page reading or write-back.',
    });
    const addDirs = collectAddDirs(job, this.cwd);
    const sessionPrompts = await this.prepareNotionAwarePrompts({
      prompt,
      requiresNotionAuth: job.action === ACTION_WRITE_REPLY,
    });

    await this.runManagedPrompt({
      jobId: job.id,
      prompt: sessionPrompts.prompt,
      resumePromptAfterApproval: sessionPrompts.resumePromptAfterApproval,
      addDirs,
      phase: 'job_turn',
      dispatchType: 'sent_to_claude_cli',
      runningType: 'claude_cli_running',
      waitingType: 'claude_cli_waiting_for_approval',
      onCompleted: (replyText, meta = {}) => {
        this.context.completeJob(job.id, replyText, {
          type: 'claude_cli_completed',
          runtimeMeta: buildRuntimeMeta({
            phase: 'job_turn',
            sessionId: meta.sessionId || null,
          }),
        });
      },
      onFailed: (errorText, meta = {}) => {
        this.context.failJob(job.id, errorText, {
          type: 'claude_cli_failed',
          runtimeMeta: buildRuntimeMeta({
            phase: 'job_turn',
            sessionId: meta.sessionId || null,
            exitCode: meta.exitCode ?? null,
            signal: meta.signal ?? null,
            pendingApproval: null,
          }),
        });
      },
    });
  }

  async respondToApproval(jobId, resolution) {
    const session = this.runningJobs.get(jobId);
    if (!session) {
      throw new Error('No active Claude Code session for this job');
    }

    this.mcpConfigWatcher?.invalidate();
    await session.respondToApproval(resolution);
    if (resolution.action !== 'accept') {
      return;
    }

    this.context.markJobRunning(jobId, {
      type: 'claude_cli_approval_resolved',
      note: 'Allowed Claude Code to continue.',
      runtimeMeta: buildRuntimeMeta({
        approvalResponse: resolution.action,
        pendingApproval: null,
      }),
    });
  }

  async cancelJob(jobId) {
    const session = this.runningJobs.get(jobId);
    if (!session) {
      return {
        ok: true,
        mode: 'unsupported',
        message: 'No active Claude Code session was found for this stop request.',
      };
    }

    session.cancel('The user stopped the task.');
    this.runningJobs.delete(jobId);
    return {
      ok: true,
      mode: 'hard',
      message: 'Claude Code subprocess was terminated.',
    };
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'dedicated-cli',
        ready: this.ready,
        standalone: false,
        cwd: this.cwd,
        ...buildPermissionStatus(this.id, this.permissionMode),
        pairingCommand: 'notion2cli pair',
        launchCommand: buildClaudeLaunchCommand(this.permissionMode),
        statusMessage: this.statusMessage,
      },
      notionMcp: await this.getNotionMcpStatus(),
    };
  }

  async getNotionMcpStatus() {
    if (!this.mcpConfigWatcher) {
      return {
        status: 'unknown',
        detail: this.statusMessage || 'Claude Code is not ready.',
      };
    }
    return this.mcpConfigWatcher.getStatus();
  }

  async installNotionMcp(job) {
    this.context.markJobDispatched(job.id, {
      type: 'claude_mcp_install_requested',
      runtimeMeta: { runtime: 'claude' },
    });
    this.context.markJobRunning(job.id, {
      type: 'claude_mcp_install_started',
      runtimeMeta: { runtime: 'claude' },
    });

    await this.mcpConfigWatcher?.invalidate();
    const notes = [];
    let status = await this.getNotionMcpStatus();

    if (status.status === 'missing') {
      const addResult = await runCommand('claude', [
        'mcp',
        'add',
        '--scope',
        'user',
        '--transport',
        'http',
        'notion',
        NOTION_MCP_URL,
      ], {
        cwd: os.homedir(),
        timeoutMs: 300000,
      });
      const output = compactCommandOutput(addResult);
      notes.push('Ran `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp`.');
      if (output) {
        notes.push(output);
      }

      if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(output)) {
        this.context.failJob(job.id, output || 'Failed to run claude mcp add.', {
          type: 'claude_mcp_add_failed',
          runtimeMeta: { runtime: 'claude', exitCode: addResult.code ?? 'unknown' },
        });
        return;
      }
    }

    await this.mcpConfigWatcher?.invalidate();
    status = await this.getNotionMcpStatus();
    if (status.status === 'unauthenticated') {
      notes.push('Notion MCP is already configured. Browser authorization will be started from the Activity panel during the first full-page read or write-back.');
    }

    const summary = [
      status.status === 'configured'
        ? 'Claude Code detected a usable Notion MCP connection.'
        : 'Claude Code added the Notion MCP configuration, but browser authorization is not complete.',
      status.detail,
      ...notes,
    ].filter(Boolean).join('\n\n');

    this.context.completeJob(job.id, summary, {
      type: status.status === 'configured' ? 'claude_mcp_ready' : 'claude_mcp_manual_follow_up',
      runtimeMeta: { runtime: 'claude' },
    });
  }

  runManagedPrompt({
    jobId,
    prompt,
    resumePromptAfterApproval = '',
    addDirs,
    phase,
    dispatchType,
    runningType,
    waitingType,
    onCompleted,
    onFailed,
  }) {
    const session = new ClaudeCliSession({
      jobId,
      cwd: this.cwd,
      prompt,
      resumePromptAfterApproval,
      model: this.model,
      extraArgs: this.extraArgs,
      addDirs,
      log: this.log,
      onRunning: ({ sessionId }) => {
        this.context.markJobDispatched(jobId, {
          type: dispatchType,
          runtimeMeta: buildRuntimeMeta({
            phase,
            sessionId: sessionId || null,
          }),
        });
        this.context.markJobRunning(jobId, {
          type: runningType,
          runtimeMeta: buildRuntimeMeta({
            phase,
            sessionId: sessionId || null,
            pendingApproval: null,
          }),
        });
      },
      onApprovalRequested: ({ sessionId, pendingApproval }) => {
        this.context.markJobWaitingForApproval(jobId, {
          type: waitingType,
          note: pendingApproval.mode === 'url'
            ? 'Claude Code needs browser authorization first.'
            : 'Claude Code needs user confirmation to continue.',
          runtimeMeta: buildRuntimeMeta({
            phase,
            sessionId: sessionId || null,
            pendingApproval,
          }),
        });
      },
      onCompleted: (replyText, meta = {}) => {
        this.runningJobs.delete(jobId);
        if (typeof onCompleted === 'function') {
          onCompleted(replyText, meta);
        }
        resolveOnce({
          replyText,
          sessionId: meta.sessionId || null,
        });
      },
      onFailed: (errorText, meta = {}) => {
        this.runningJobs.delete(jobId);
        if (typeof onFailed === 'function') {
          onFailed(errorText, meta);
        }
        rejectOnce(new Error(errorText || 'Claude session failed'));
      },
      onClosed: () => {
        this.runningJobs.delete(jobId);
      },
    });

    let settled = false;
    let resolveOnce = null;
    let rejectOnce = null;

    const completion = new Promise((resolve, reject) => {
      resolveOnce = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };
    });

    this.runningJobs.set(jobId, session);
    session.start().catch((error) => {
      this.runningJobs.delete(jobId);
      rejectOnce(error);
    });

    return completion;
  }

  async prepareNotionAwarePrompts({ prompt, requiresNotionAuth }) {
    if (!requiresNotionAuth) {
      return {
        prompt,
        resumePromptAfterApproval: '',
      };
    }

    const notionMcp = await this.getNotionMcpStatus();
    if (notionMcp.status !== 'unauthenticated') {
      return {
        prompt,
        resumePromptAfterApproval: '',
      };
    }

    return {
      prompt: buildClaudeNotionAuthBootstrapPrompt(),
      resumePromptAfterApproval: prompt,
    };
  }
}

export function parseClaudeMcpList(output) {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const notionLine = lines.find((line) => /^notion:/i.test(line) || /notion\.com\/mcp/i.test(line));

  if (!notionLine) {
    return {
      status: 'missing',
      detail: 'Claude Code Notion MCP configuration was not detected.',
    };
  }

  if (/Needs authentication/i.test(notionLine)) {
    return {
      status: 'unauthenticated',
      detail: 'Claude Code Notion MCP configuration was detected, but authorization is not complete.',
    };
  }

  if (/✓ Connected/i.test(notionLine)) {
    return {
      status: 'configured',
      detail: 'Claude Code is configured and can use Notion MCP.',
    };
  }

  return {
    status: 'unknown',
    detail: notionLine,
  };
}

async function probeNotionMcpStatusViaCli({ cwd, log }) {
  try {
    const result = await runCommand('claude', ['mcp', 'list'], {
      cwd: cwd || os.homedir(),
      timeoutMs: 12000,
    });
    if (result.code !== 0) {
      const output = compactCommandOutput(result);
      return {
        status: 'unknown',
        detail: output || `claude mcp list exited with code ${result.code ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`,
      };
    }
    return parseClaudeMcpList(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    log?.('claude mcp list failed', { message: error?.message });
    return {
      status: 'unknown',
      detail: error?.message || 'Unable to check Claude Code Notion MCP status.',
    };
  }
}

function parseArgs(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return [];
  }

  return value.split(/\s+/).filter(Boolean);
}

function collectAddDirs(job, cwd) {
  const dirs = new Set([cwd || process.cwd()]);
  if (job.inputBundle?.cacheDir) {
    dirs.add(job.inputBundle.cacheDir);
  }
  for (const image of job.inputBundle?.images || []) {
    dirs.add(path.dirname(image.cachePath));
  }

  return Array.from(dirs).filter((dir) => dir && dir !== '.');
}

function compactCommandOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n');
}

function buildRuntimeMeta(overrides = {}) {
  return {
    runtime: 'claude',
    transport: 'cli-stream-json',
    ...overrides,
  };
}

function buildClaudeLaunchCommand(permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === 'default') {
    return 'notion2cli claude launch';
  }

  return `notion2cli claude launch --permission-mode ${mode}`;
}

function buildClaudeNotionAuthBootstrapPrompt() {
  return [
    'You are handling a notion2cli task that requires the Notion MCP server.',
    'Do not attempt the main task yet.',
    'Call the Notion authentication tool now.',
    'If it returns an authorization URL, output only that URL and nothing else.',
    'Do not summarize the task, and do not claim failure before trying authentication.',
  ].join('\n');
}

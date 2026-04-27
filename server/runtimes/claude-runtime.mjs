import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { buildClaudePrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP, ACTION_WRITE_REPLY } from '../core/constants.mjs';
import { buildRuntimePageBundleFetchPrompt } from '../core/mcp-page-bundle.mjs';
import { runCommand } from './exec-utils.mjs';
import { buildClaudeCliArgs, buildStreamJsonUserMessage, ClaudeCliSession } from './claude-cli-session.mjs';

const MCP_PROBE_TTL_MS = 15000;
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

export class ClaudeRuntime {
  constructor(log, options = {}) {
    this.id = 'claude';
    this.label = 'Claude Code';
    this.log = log;
    this.context = null;
    this.cwd = options.cwd || process.cwd();
    this.model = process.env.NOTION2CLI_CLAUDE_MODEL || '';
    this.extraArgs = Array.isArray(options.extraArgs)
      ? options.extraArgs
      : parseArgs(process.env.NOTION2CLI_CLAUDE_EXTRA_ARGS || '');
    this.ready = false;
    this.statusMessage = '等待检查 Claude Code。';
    this.runningJobs = new Map();
    this.probeSessions = new Set();
    this.cachedMcpStatus = null;
  }

  async start(context) {
    this.context = context;
    try {
      const result = await runCommand('claude', ['--version'], { cwd: this.cwd, timeoutMs: 4000 });
      this.ready = result.code === 0;
      this.statusMessage = this.ready
        ? `Claude Code 已就绪（${compactCommandOutput(result) || 'version unknown'}）。`
        : (result.stderr.trim() || 'Claude Code 未就绪。');
    } catch (error) {
      this.ready = false;
      this.statusMessage = error?.message || '无法启动 claude 命令。';
    }
  }

  async stop() {
    for (const session of this.runningJobs.values()) {
      session.shutdown();
    }
    this.runningJobs.clear();

    for (const session of this.probeSessions.values()) {
      session.shutdown();
    }
    this.probeSessions.clear();
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

    this.cachedMcpStatus = null;
    await session.respondToApproval(resolution);
    if (resolution.action !== 'accept') {
      return;
    }

    this.context.markJobRunning(jobId, {
      type: 'claude_cli_approval_resolved',
      note: '已允许 Claude Code 继续执行。',
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

    session.cancel('用户停止了任务。');
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
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli claude launch',
        statusMessage: this.statusMessage,
      },
      notionMcp: await this.getNotionMcpStatus(),
    };
  }

  async getNotionMcpStatus() {
    if (this.cachedMcpStatus && Date.now() - this.cachedMcpStatus.checkedAt < MCP_PROBE_TTL_MS) {
      return this.cachedMcpStatus.value;
    }

    let value;
    try {
      value = await probeClaudeSessionNotionMcpStatus({
        cwd: this.cwd,
        model: this.model,
        extraArgs: this.extraArgs,
        log: this.log,
        registerProbeSession: (session) => {
          this.probeSessions.add(session);
        },
        unregisterProbeSession: (session) => {
          this.probeSessions.delete(session);
        },
      });
    } catch (error) {
      try {
        const result = await runCommand('claude', ['mcp', 'list'], { cwd: os.homedir(), timeoutMs: 12000 });
        value = parseClaudeMcpList(`${result.stdout}\n${result.stderr}`);
      } catch {
        value = {
          status: 'unknown',
          detail: error?.message || '无法检查 Claude Code 的 Notion MCP 状态。',
        };
      }
    }

    this.cachedMcpStatus = {
      checkedAt: Date.now(),
      value,
    };

    return value;
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

    this.cachedMcpStatus = null;
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
      notes.push('已执行 `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp`。');
      if (output) {
        notes.push(output);
      }

      if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(output)) {
        this.context.failJob(job.id, output || '执行 claude mcp add 失败。', {
          type: 'claude_mcp_add_failed',
          runtimeMeta: { runtime: 'claude', exitCode: addResult.code ?? 'unknown' },
        });
        return;
      }
    }

    this.cachedMcpStatus = null;
    status = await this.getNotionMcpStatus();
    if (status.status === 'unauthenticated') {
      notes.push('Notion MCP 配置已经存在，但真正的浏览器授权会在第一次整页读取或写回时，直接在 Activity 面板里发起。');
    }

    const summary = [
      status.status === 'configured'
        ? 'Claude Code 已检测到可用的 Notion MCP 连接。'
        : 'Claude Code 已添加 Notion MCP 配置，但还没有完成浏览器授权。',
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
            ? 'Claude Code 需要先完成浏览器授权。'
            : 'Claude Code 需要用户确认才能继续。',
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
      detail: '未检测到 Claude Code 的 Notion MCP 配置。',
    };
  }

  if (/Needs authentication/i.test(notionLine)) {
    return {
      status: 'unauthenticated',
      detail: '已检测到 Claude Code 的 Notion MCP 配置，但当前还没有完成授权。',
    };
  }

  if (/✓ Connected/i.test(notionLine)) {
    return {
      status: 'configured',
      detail: '检测到 Claude Code 已配置并可使用 Notion MCP。',
    };
  }

  return {
    status: 'unknown',
    detail: notionLine,
  };
}

export function parseClaudeSessionInitNotionStatus(message) {
  const servers = Array.isArray(message?.mcp_servers) ? message.mcp_servers : [];
  const notionServer = servers.find((server) => String(server?.name || '').trim().toLowerCase() === 'notion');

  if (!notionServer) {
    return {
      status: 'missing',
      detail: '未检测到 Claude Code 的 Notion MCP 配置。',
    };
  }

  const status = String(notionServer.status || '').trim().toLowerCase();
  if (status === 'connected') {
    return {
      status: 'configured',
      detail: '检测到 Claude Code 已配置并可使用 Notion MCP。',
    };
  }

  if (status === 'needs-auth') {
    return {
      status: 'unauthenticated',
      detail: 'Claude Code 运行时仍需要先完成一次 Notion 浏览器授权。',
    };
  }

  return {
    status: 'unknown',
    detail: `Claude Code Notion MCP 状态：${notionServer.status || 'unknown'}`,
  };
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

function buildClaudeNotionAuthBootstrapPrompt() {
  return [
    'You are handling a notion2cli task that requires the Notion MCP server.',
    'Do not attempt the main task yet.',
    'Call the Notion authentication tool now.',
    'If it returns an authorization URL, output only that URL and nothing else.',
    'Do not summarize the task, and do not claim failure before trying authentication.',
  ].join('\n');
}

function probeClaudeSessionNotionMcpStatus({
  cwd,
  model,
  extraArgs,
  log,
  registerProbeSession,
  unregisterProbeSession,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', buildClaudeCliArgs({
      model,
      extraArgs,
      addDirs: [cwd],
    }), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reader = readline.createInterface({ input: child.stdout });
    const session = {
      shutdown() {
        reader.close();
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      },
    };
    registerProbeSession?.(session);

    let stderr = '';
    let settled = false;
    let timeoutId = null;

    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unregisterProbeSession?.(session);
      session.shutdown();
      fn(value);
    };

    reader.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        log?.('claude probe emitted invalid JSON', { line });
        return;
      }

      if (message?.type === 'system' && message?.subtype === 'init') {
        finish(resolve, parseClaudeSessionInitNotionStatus(message));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish(reject, new Error(error?.message || 'Failed to start Claude Code probe'));
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }

      const reason = stderr.trim() || `Claude Code probe exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
      finish(reject, new Error(reason));
    });

    timeoutId = setTimeout(() => {
      finish(reject, new Error('Timed out while waiting for Claude Code MCP status'));
    }, 6000);

    child.stdin.write(`${JSON.stringify(buildStreamJsonUserMessage('Reply exactly ok.'))}\n`);
  });
}

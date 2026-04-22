import os from 'node:os';
import path from 'node:path';
import { chmod, writeFile } from 'node:fs/promises';
import { buildClaudePrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP } from '../core/constants.mjs';
import { buildRuntimePageBundleFetchPrompt } from '../core/mcp-page-bundle.mjs';
import { runCommand } from './exec-utils.mjs';
import { ClaudeCliSession } from './claude-cli-session.mjs';

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
    this.extraArgs = parseArgs(process.env.NOTION2CLI_CLAUDE_EXTRA_ARGS || '');
    this.ready = false;
    this.statusMessage = '等待检查 Claude Code。';
    this.runningJobs = new Map();
    this.auxiliarySessions = new Set();
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
    for (const session of this.auxiliarySessions.values()) {
      session.shutdown();
    }
    this.auxiliarySessions.clear();
  }

  async startPairing() {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Claude Code is not ready');
    }
  }

  async fetchPageBundle({ pageUrl, pageTitle }) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Claude Code is not ready');
    }

    const prompt = buildRuntimePageBundleFetchPrompt({
      pageUrl,
      pageTitle,
      runtimeLabel: 'the local Claude Code runtime',
    });
    this.log('claude page bundle fetch requested', {
      pageUrl,
      pageTitle,
    });
    const result = await this.runEphemeralPrompt(prompt);
    this.log('claude page bundle fetch completed', {
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

    this.context.markJobDispatched(job.id, {
      type: 'sent_to_claude_cli',
      runtimeMeta: {
        runtime: 'claude',
        transport: 'cli-print',
      },
    });

    const session = new ClaudeCliSession({
      jobId: job.id,
      cwd: this.cwd,
      prompt,
      model: this.model,
      extraArgs: this.extraArgs,
      addDirs,
      log: this.log,
      onRunning: () => {
        this.context.markJobRunning(job.id, {
          type: 'claude_cli_running',
          runtimeMeta: {
            runtime: 'claude',
            transport: 'cli-print',
          },
        });
      },
      onCompleted: (replyText, meta = {}) => {
        this.runningJobs.delete(job.id);
        this.context.completeJob(job.id, replyText, {
          type: 'claude_cli_completed',
          runtimeMeta: {
            runtime: 'claude',
            transport: 'cli-print',
            sessionId: meta.sessionId || null,
          },
        });
      },
      onFailed: (errorText, meta = {}) => {
        this.runningJobs.delete(job.id);
        this.context.failJob(job.id, errorText, {
          type: 'claude_cli_failed',
          runtimeMeta: {
            runtime: 'claude',
            transport: 'cli-print',
            sessionId: meta.sessionId || null,
            exitCode: meta.exitCode ?? null,
            signal: meta.signal ?? null,
          },
        });
      },
      onClosed: () => {
        this.runningJobs.delete(job.id);
      },
    });

    this.runningJobs.set(job.id, session);
    await session.start();
  }

  async respondToApproval() {
    throw new Error('Claude dedicated runtime does not use bridge-managed approval callbacks');
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
        launchCommand: 'notion2cli daemon start --runtime claude',
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
      const result = await runCommand('claude', ['mcp', 'list'], { cwd: os.homedir(), timeoutMs: 12000 });
      value = parseClaudeMcpList(`${result.stdout}\n${result.stderr}`);
    } catch (error) {
      value = {
        status: 'unknown',
        detail: error?.message || '无法检查 Claude Code 的 Notion MCP 状态。',
      };
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
      notes.push(await launchClaudeMcpAuthGuide(this.log));
    }
    const summary = [
      status.status === 'configured'
        ? 'Claude Code 已检测到可用的 Notion MCP 连接。'
        : 'Claude Code 已添加 Notion MCP 配置，但可能还需要完成授权。',
      status.detail,
      ...notes,
    ].filter(Boolean).join('\n\n');

    this.context.completeJob(job.id, summary, {
      type: status.status === 'configured' ? 'claude_mcp_ready' : 'claude_mcp_manual_follow_up',
      runtimeMeta: { runtime: 'claude' },
    });
  }

  async runEphemeralPrompt(prompt) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const session = new ClaudeCliSession({
        jobId: `prefetch-${Date.now()}`,
        cwd: this.cwd,
        prompt,
        model: this.model,
        extraArgs: this.extraArgs,
        addDirs: [this.cwd],
        log: this.log,
        onRunning: () => {
          this.log('claude auxiliary session running');
        },
        onCompleted: (replyText, meta = {}) => {
          resolveOnce({
            replyText,
            sessionId: meta.sessionId || null,
          });
        },
        onFailed: (errorText) => {
          rejectOnce(new Error(errorText || 'Claude auxiliary session failed'));
        },
        onClosed: () => {
          this.auxiliarySessions.delete(session);
        },
      });

      const resolveOnce = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        this.auxiliarySessions.delete(session);
        resolve(value);
      };

      const rejectOnce = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.auxiliarySessions.delete(session);
        reject(error);
      };

      this.auxiliarySessions.add(session);
      session.start().catch((error) => {
        rejectOnce(error);
      });
    });
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

async function launchClaudeMcpAuthGuide(log) {
  const guidance = [
    'Claude Code 当前没有可编排的 `claude mcp login` 子命令。',
    '我会尽量在插件里发起授权引导，但真正的 OAuth 仍需在 Claude Code + 浏览器里完成。',
  ].join('\n');

  if (os.platform() !== 'darwin') {
    return [
      guidance,
      '请手动打开一个终端并运行 `claude`，进入 Claude Code 后输入 `/mcp`，选择 `notion`，再按浏览器提示完成授权。',
      '授权完成后回到 notion2cli 插件，状态会自动刷新。',
    ].join('\n\n');
  }

  try {
    const scriptPath = path.join(os.tmpdir(), `notion2cli-claude-mcp-auth-${Date.now()}.command`);
    await writeFile(scriptPath, buildClaudeMcpAuthTerminalScript(), { mode: 0o755 });
    await chmod(scriptPath, 0o755);

    const openResult = await runCommand('open', ['-a', 'Terminal', scriptPath], {
      cwd: os.homedir(),
      timeoutMs: 10000,
    });
    const openOutput = compactCommandOutput(openResult);
    if (openResult.code !== 0) {
      throw new Error(openOutput || '无法打开 Terminal.app');
    }

    log('claude mcp auth guide opened in Terminal', {
      scriptPath,
    });

    return [
      guidance,
      '已为你打开一个专用 Claude Code 终端。',
      '请在新终端中按提示进入 `/mcp`，选择 `notion`，再在系统浏览器里完成 OAuth。',
      '授权完成后回到 notion2cli 插件，状态会自动刷新。',
    ].join('\n\n');
  } catch (error) {
    return [
      guidance,
      `自动打开 Claude 授权终端失败：${error?.message || 'unknown error'}`,
      '请手动打开一个终端并运行 `claude`，进入 Claude Code 后输入 `/mcp`，选择 `notion`，再按浏览器提示完成授权。',
      '授权完成后回到 notion2cli 插件，状态会自动刷新。',
    ].join('\n\n');
  }
}

function buildClaudeMcpAuthTerminalScript() {
  return [
    '#!/bin/zsh',
    'clear',
    "cat <<'EOF'",
    'notion2cli 正在引导 Claude Code 完成 Notion MCP 授权。',
    '',
    '接下来请按下面步骤操作：',
    '1. Claude Code 启动后，输入 /mcp',
    '2. 在 MCP 列表中选择 notion',
    '3. 按浏览器提示完成 Notion OAuth',
    '4. 完成后回到 notion2cli 插件，状态会自动刷新',
    '',
    '如果 Claude Code 没有自动显示提示，你仍然只需要输入 /mcp。',
    'EOF',
    'echo',
    'exec claude',
    '',
  ].join('\n');
}

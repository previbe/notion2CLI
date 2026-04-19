import { buildCodexPrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP } from '../core/constants.mjs';
import { buildRuntimePageBundleFetchPrompt } from '../core/mcp-page-bundle.mjs';
import { CodexAppServerSession, buildCodexAppServerArgs, buildCodexInputItems } from './codex-app-server-session.mjs';
import { runCommand } from './exec-utils.mjs';

const MCP_PROBE_TTL_MS = 15000;
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

export class CodexRuntime {
  constructor(log, options = {}) {
    this.id = 'codex';
    this.label = 'Codex CLI';
    this.log = log;
    this.context = null;
    this.cwd = options.cwd || process.cwd();
    this.model = process.env.NOTION2CLI_CODEX_MODEL || '';
    this.profile = process.env.NOTION2CLI_CODEX_PROFILE || '';
    this.extraArgs = parseArgs(process.env.NOTION2CLI_CODEX_EXTRA_ARGS || '');
    this.ready = false;
    this.statusMessage = '等待检查 Codex CLI。';
    this.runningJobs = new Map();
    this.auxiliarySessions = new Set();
    this.cachedMcpStatus = null;
  }

  async start(context) {
    this.context = context;
    try {
      const result = await runCommand('codex', ['--version'], { timeoutMs: 4000 });
      this.ready = result.code === 0;
      this.statusMessage = this.ready
        ? `Codex CLI 已就绪（${result.stdout.trim() || 'version unknown'}）。`
        : (result.stderr.trim() || 'Codex CLI 未就绪。');
    } catch (error) {
      this.ready = false;
      this.statusMessage = error?.message || '无法启动 codex 命令。';
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
      throw new Error(this.statusMessage || 'Codex CLI is not ready');
    }
  }

  async fetchPageBundle({ pageUrl, pageTitle }) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Codex CLI is not ready');
    }

    const prompt = buildRuntimePageBundleFetchPrompt({
      pageUrl,
      pageTitle,
      runtimeLabel: 'the local Codex CLI runtime',
    });
    this.log('codex page bundle fetch requested', {
      pageUrl,
      pageTitle,
    });
    const replyText = await this.runEphemeralPrompt(prompt);
    this.log('codex page bundle fetch completed', {
      pageUrl,
      pageTitle,
      replyChars: replyText.length,
    });
    return replyText;
  }

  async dispatchJob(job) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Codex CLI is not ready');
    }

    if (job.action === ACTION_INSTALL_NOTION_MCP) {
      await this.installNotionMcp(job);
      return;
    }

    const prompt = buildCodexPrompt(job, {
      notionMcpHint: 'Use the configured Notion MCP tools when the action requires full-page reading or write-back.',
    });
    const inputItems = buildCodexInputItems({
      prompt,
      images: job.inputBundle?.images || [],
    });

    this.context.markJobDispatched(job.id, {
      type: 'sent_to_codex_app_server',
      runtimeMeta: {
        runtime: 'codex',
        transport: 'app-server',
      },
    });

    const session = new CodexAppServerSession({
      jobId: job.id,
      cwd: this.cwd,
      inputItems,
      model: this.model,
      profile: this.profile,
      extraArgs: this.extraArgs,
      log: this.log,
      onRunning: ({ threadId, turnId }) => {
        this.context.markJobRunning(job.id, {
          type: 'codex_app_server_running',
          runtimeMeta: {
            runtime: 'codex',
            transport: 'app-server',
            threadId,
            turnId,
            pendingApproval: null,
          },
        });
      },
      onApprovalRequested: ({ threadId, turnId, requestId, pendingApproval }) => {
        this.context.markJobWaitingForApproval(job.id, {
          type: 'codex_app_server_waiting_for_approval',
          note: 'Codex 需要用户确认才能继续。',
          runtimeMeta: {
            runtime: 'codex',
            transport: 'app-server',
            threadId,
            turnId,
            pendingApproval: {
              ...pendingApproval,
              requestId: String(requestId),
            },
          },
        });
      },
      onCompleted: (replyText, meta = {}) => {
        this.runningJobs.delete(job.id);
        this.context.completeJob(job.id, replyText, {
          type: 'codex_app_server_completed',
          runtimeMeta: {
            runtime: 'codex',
            transport: 'app-server',
            threadId: meta.threadId || null,
            turnId: meta.turnId || null,
            pendingApproval: null,
          },
        });
      },
      onFailed: (errorText, meta = {}) => {
        this.runningJobs.delete(job.id);
        this.context.failJob(job.id, errorText, {
          type: 'codex_app_server_failed',
          runtimeMeta: {
            runtime: 'codex',
            transport: 'app-server',
            threadId: meta.threadId || null,
            turnId: meta.turnId || null,
            turnStatus: meta.turnStatus || null,
            exitCode: meta.exitCode ?? null,
            signal: meta.signal ?? null,
            pendingApproval: null,
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

  async respondToApproval(jobId, resolution) {
    const session = this.runningJobs.get(jobId);
    if (!session) {
      throw new Error('No active Codex app-server session for this job');
    }

    await session.respondToApproval(resolution);
    this.context.markJobRunning(jobId, {
      type: 'codex_app_server_approval_resolved',
      note: resolution.action === 'accept' ? '已允许 Codex 继续执行。' : '已拒绝当前请求，等待 Codex 结束本次 turn。',
      runtimeMeta: {
        runtime: 'codex',
        transport: 'app-server',
        pendingApproval: null,
        approvalResponse: resolution.action,
      },
    });
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'app-server',
        ready: this.ready,
        standalone: false,
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli daemon start --runtime codex',
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
      const result = await runCommand('codex', ['mcp', 'list'], { cwd: this.cwd, timeoutMs: 5000 });
      value = parseNotionMcpList(`${result.stdout}\n${result.stderr}`);
    } catch (error) {
      value = {
        status: 'unknown',
        detail: error?.message || '无法检查 Codex MCP 状态。',
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
      type: 'codex_mcp_install_requested',
      runtimeMeta: {
        runtime: 'codex',
      },
    });
    this.context.markJobRunning(job.id, {
      type: 'codex_mcp_install_started',
      runtimeMeta: {
        runtime: 'codex',
      },
    });

    this.cachedMcpStatus = null;
    let status = await this.getNotionMcpStatus();
    const notes = [];

    if (status.status === 'configured') {
      this.context.completeJob(job.id, `Codex CLI 已检测到可用的 Notion MCP 连接。${status.detail}`, {
        type: 'codex_mcp_already_configured',
        runtimeMeta: { runtime: 'codex' },
      });
      return;
    }

    if (status.status === 'missing') {
      const addResult = await runCommand('codex', ['mcp', 'add', 'notion', '--url', NOTION_MCP_URL], {
        cwd: this.cwd,
        timeoutMs: 300000,
      });
      const addOutput = compactCommandOutput(addResult);
      notes.push('已执行 `codex mcp add notion --url https://mcp.notion.com/mcp`。');
      if (addOutput) {
        notes.push(addOutput);
      }

      if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(addOutput)) {
        this.context.failJob(job.id, addOutput || '执行 codex mcp add 失败。', {
          type: 'codex_mcp_add_failed',
          runtimeMeta: { runtime: 'codex', exitCode: addResult.code ?? 'unknown' },
        });
        return;
      }
    }

    this.cachedMcpStatus = null;
    status = await this.getNotionMcpStatus();

    if (status.status === 'unauthenticated') {
      const loginResult = await runCommand('codex', ['mcp', 'login', 'notion'], {
        cwd: this.cwd,
        timeoutMs: 300000,
      });
      const loginOutput = compactCommandOutput(loginResult);
      notes.push('已执行 `codex mcp login notion`。');
      if (loginOutput) {
        notes.push(loginOutput);
      }

      if (loginResult.code !== 0) {
        this.context.failJob(job.id, loginOutput || '执行 codex mcp login 失败。', {
          type: 'codex_mcp_login_failed',
          runtimeMeta: { runtime: 'codex', exitCode: loginResult.code ?? 'unknown' },
        });
        return;
      }
    }

    this.cachedMcpStatus = null;
    status = await this.getNotionMcpStatus();

    if (status.status === 'configured') {
      const summary = [
        '已为 Codex CLI 准备 Notion MCP。',
        status.detail,
        ...notes,
      ].filter(Boolean).join('\n\n');
      this.context.completeJob(job.id, summary, {
        type: 'codex_mcp_install_completed',
        runtimeMeta: { runtime: 'codex' },
      });
      return;
    }

    this.context.failJob(job.id, [
      'Codex CLI 的 Notion MCP 安装流程没有达到可用状态。',
      status.detail,
      ...notes,
    ].filter(Boolean).join('\n\n'), {
      type: 'codex_mcp_install_incomplete',
      runtimeMeta: { runtime: 'codex' },
    });
  }

  async runEphemeralPrompt(prompt) {
    const inputItems = buildCodexInputItems({
      prompt,
      images: [],
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const session = new CodexAppServerSession({
        jobId: `prefetch-${Date.now()}`,
        cwd: this.cwd,
        inputItems,
        model: this.model,
        profile: this.profile,
        extraArgs: this.extraArgs,
        log: this.log,
        onRunning: ({ threadId, turnId }) => {
          this.log('codex auxiliary session running', {
            threadId,
            turnId,
          });
        },
        onApprovalRequested: ({ pendingApproval }) => {
          rejectOnce(new Error(`Page bundle fetch unexpectedly requested approval: ${pendingApproval.message}`));
        },
        onCompleted: (replyText) => {
          resolveOnce(replyText);
        },
        onFailed: (errorText) => {
          rejectOnce(new Error(errorText || 'Codex auxiliary session failed'));
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

export { buildCodexAppServerArgs };

function parseArgs(raw) {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseNotionMcpList(output) {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const notionLine = lines.find((line) => /(^|\s)notion(\s|$)|mcp\.notion\.com|notion\.com\/mcp/i.test(line));

  if (!notionLine) {
    return {
      status: 'missing',
      detail: '未检测到 Codex CLI 的 Notion MCP 配置。',
    };
  }

  if (/not logged in/i.test(notionLine)) {
    return {
      status: 'unauthenticated',
      detail: '已检测到 Codex CLI 的 Notion MCP 配置，但当前还没有完成登录授权。',
    };
  }

  return {
    status: 'configured',
    detail: '检测到 Codex CLI 已配置并可使用 Notion MCP。',
  };
}

function compactCommandOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join('\n');
}

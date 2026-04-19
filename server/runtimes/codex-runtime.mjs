import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodexPrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP } from '../core/constants.mjs';
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
    for (const job of this.runningJobs.values()) {
      job.child.kill('SIGTERM');
    }
    this.runningJobs.clear();
  }

  async startPairing() {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Codex CLI is not ready');
    }
  }

  async dispatchJob(job) {
    if (!this.ready) {
      throw new Error(this.statusMessage || 'Codex CLI is not ready');
    }

    if (job.action === ACTION_INSTALL_NOTION_MCP) {
      await this.installNotionMcp(job);
      return;
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-codex-'));
    const outputFile = path.join(tempDir, `${job.id}.md`);
    const prompt = buildCodexPrompt(job, {
      notionMcpHint: 'Use the configured Notion MCP tools when the action requires full-page reading or write-back.',
    });
    const args = buildCodexExecArgs({
      cwd: this.cwd,
      outputFile,
      model: this.model,
      profile: this.profile,
      extraArgs: this.extraArgs,
    });

    this.context.markJobDispatched(job.id, {
      type: 'sent_to_codex_exec',
      runtimeMeta: {
        runtime: 'codex',
        outputFile,
      },
    });

    const child = spawnCodexProcess(args, prompt, this.cwd);
    this.runningJobs.set(job.id, { child, outputFile, tempDir });

    this.context.markJobRunning(job.id, {
      type: 'codex_exec_started',
      runtimeMeta: {
        runtime: 'codex',
      },
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      this.runningJobs.delete(job.id);
      this.context.failJob(job.id, error.message || 'Codex process error', {
        type: 'codex_exec_error',
        runtimeMeta: { runtime: 'codex' },
      });
      cleanupTempDir(tempDir);
    });

    child.on('close', async (code) => {
      this.runningJobs.delete(job.id);

      const message = await readOutputFile(outputFile);
      const finalMessage = message || stdout.trim();

      if (code === 0 && finalMessage) {
        this.context.completeJob(job.id, finalMessage, {
          type: 'codex_exec_completed',
          runtimeMeta: { runtime: 'codex' },
        });
      } else {
        const errorText = finalMessage || stderr.trim() || `Codex exited with code ${code}`;
        this.context.failJob(job.id, errorText, {
          type: 'codex_exec_failed',
          runtimeMeta: { runtime: 'codex', exitCode: code ?? 'unknown' },
        });
      }

      cleanupTempDir(tempDir);
    });
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'subprocess',
        ready: this.ready,
        standalone: false,
        sessionAttached: false,
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli daemon start --runtime codex',
        statusMessage: this.statusMessage,
      },
      capabilities: {
        supportsInteractiveSessionAttach: false,
        supportsStandaloneDispatch: true,
        supportsNotionRead: true,
        supportsNotionWrite: true,
        supportsInstallGuidance: true,
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
}

export function buildCodexExecArgs({ cwd, outputFile, model, profile, extraArgs }) {
  const args = ['exec', '--ephemeral', '-C', cwd, '-o', outputFile];

  if (profile) {
    args.push('-p', profile);
  }

  if (model) {
    args.push('-m', model);
  }

  args.push('-s', 'read-only');

  if (Array.isArray(extraArgs) && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

function spawnCodexProcess(args, prompt, cwd) {
  const child = spawn('codex', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write(prompt);
  child.stdin.end();
  return child;
}

async function readOutputFile(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function cleanupTempDir(tempDir) {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {}
}

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

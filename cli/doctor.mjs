import { access } from 'node:fs/promises';
import os from 'node:os';
import { runCommand } from '../server/runtimes/exec-utils.mjs';
import { parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { inspectDaemon } from './daemon.mjs';
import { getAppPaths } from './paths.mjs';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

export async function runDoctor() {
  const [claude, codex, daemon, claudeMcp, codexMcp, claudeConfig] = await Promise.all([
    probeBinary('claude', ['--version']),
    probeBinary('codex', ['--version']),
    inspectDaemon(),
    probeClaudeNotionMcp(),
    probeCodexNotionMcp(),
    probeClaudeBridgeConfig(),
  ]);

  return {
    ok: true,
    appHome: getAppPaths().root,
    bridge: summarizeDaemon(daemon),
    runtimes: {
      claude,
      codex,
    },
    notionMcp: {
      claude: claudeMcp,
      codex: codexMcp,
    },
    claudeBridgeConfig: claudeConfig,
  };
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

async function probeBinary(command, args) {
  try {
    const result = await runCommand(command, args, {
      cwd: os.homedir(),
      timeoutMs: 5000,
    });
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    return {
      installed: result.code === 0,
      detail: detail || `${command} 可执行`,
    };
  } catch (error) {
    return {
      installed: false,
      detail: error?.message || `${command} 不可用`,
    };
  }
}

async function probeClaudeNotionMcp() {
  try {
    const result = await runCommand('claude', ['mcp', 'list'], {
      cwd: os.homedir(),
      timeoutMs: 12000,
    });
    return parseClaudeMcpList(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    return {
      status: 'unknown',
      detail: error?.message || '无法检查 Claude Code 的 Notion MCP 状态。',
    };
  }
}

async function probeCodexNotionMcp() {
  try {
    const result = await runCommand('codex', ['mcp', 'list'], {
      cwd: os.homedir(),
      timeoutMs: 5000,
    });
    return parseNotionMcpList(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    return {
      status: 'unknown',
      detail: error?.message || '无法检查 Codex CLI 的 Notion MCP 状态。',
    };
  }
}

async function probeClaudeBridgeConfig() {
  const filePath = getAppPaths().claudeMcpConfigFile;

  try {
    await access(filePath);
    return {
      status: 'configured',
      detail: `Claude launch 配置文件已存在：${filePath}`,
      path: filePath,
    };
  } catch {
    return {
      status: 'missing',
      detail: `尚未生成 Claude launch 配置文件。运行 \`notion2cli claude launch\` 后会自动写入：${filePath}`,
      path: filePath,
    };
  }
}

function summarizeDaemon(inspection) {
  if (inspection.unmanaged) {
    return {
      status: 'unmanaged',
      detail: `检测到 ${inspection.host}:${inspection.port} 上有 bridge，但它不是 notion2cli daemon 管理的。`,
      runtime: inspection.bridge?.runtime || null,
    };
  }

  if (inspection.running) {
    return {
      status: 'running',
      detail: `bridge 正在 ${inspection.host}:${inspection.port} 运行。`,
      runtime: inspection.bridge?.runtime || null,
      metadata: inspection.metadata,
    };
  }

  if (inspection.stale) {
    return {
      status: 'stale',
      detail: '发现过期 daemon 状态文件，但当前 bridge 不在线。',
      metadata: inspection.metadata,
    };
  }

  return {
    status: 'stopped',
    detail: `当前没有 daemon 在 ${inspection.host}:${inspection.port} 运行。`,
  };
}

export function formatDoctorReport(report) {
  return [
    `notion2cli home：${report.appHome}`,
    `bridge：${report.bridge.detail}`,
    `Claude Code：${formatBinaryLine(report.runtimes.claude)}`,
    `Codex CLI：${formatBinaryLine(report.runtimes.codex)}`,
    `Claude Notion MCP：${report.notionMcp.claude.detail}`,
    `Codex Notion MCP：${report.notionMcp.codex.detail}`,
    `Claude launch 配置：${report.claudeBridgeConfig.detail}`,
    `Notion MCP 官方地址：${NOTION_MCP_URL}`,
  ].join('\n');
}

function formatBinaryLine(binary) {
  return binary.installed ? `已安装（${binary.detail}）` : `未安装（${binary.detail}）`;
}

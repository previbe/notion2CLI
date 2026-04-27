import os from 'node:os';
import { runCommand } from '../server/runtimes/exec-utils.mjs';
import { parseClaudeMcpList } from '../server/runtimes/claude-runtime.mjs';
import { parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { inspectDaemon } from './daemon.mjs';
import { getAppPaths } from './paths.mjs';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

export async function runDoctor() {
  const [claude, codex, daemon, claudeMcp, codexMcp] = await Promise.all([
    probeBinary('claude', ['--version']),
    probeBinary('codex', ['--version']),
    inspectDaemon(),
    probeClaudeNotionMcp(),
    probeCodexNotionMcp(),
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
      detail: detail || `${command} is executable`,
    };
  } catch (error) {
    return {
      installed: false,
      detail: error?.message || `${command} is unavailable`,
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
      detail: error?.message || 'Unable to check Claude Code Notion MCP status.',
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
      detail: error?.message || 'Unable to check Codex CLI Notion MCP status.',
    };
  }
}

function summarizeDaemon(inspection) {
  if (inspection.unmanaged) {
    return {
      status: 'unmanaged',
      detail: `Detected ${inspection.host}:${inspection.port} has a bridge running, but it is not managed by notion2cli daemon.`,
      runtime: inspection.bridge?.runtime || null,
    };
  }

  if (inspection.running) {
    return {
      status: 'running',
      detail: `bridge is running at ${inspection.host}:${inspection.port}.`,
      runtime: inspection.bridge?.runtime || null,
      metadata: inspection.metadata,
    };
  }

  if (inspection.stale) {
    return {
      status: 'stale',
      detail: 'Found a stale daemon state file, but the current bridge is offline.',
      metadata: inspection.metadata,
    };
  }

  return {
    status: 'stopped',
    detail: `No daemon is running at ${inspection.host}:${inspection.port}.`,
  };
}

export function formatDoctorReport(report) {
  return [
    `notion2cli home: ${report.appHome}`,
    `bridge: ${report.bridge.detail}`,
    `Claude Code: ${formatBinaryLine(report.runtimes.claude)}`,
    `Codex CLI: ${formatBinaryLine(report.runtimes.codex)}`,
    `Claude Notion MCP: ${report.notionMcp.claude.detail}`,
    `Codex Notion MCP: ${report.notionMcp.codex.detail}`,
    `Official Notion MCP URL: ${NOTION_MCP_URL}`,
  ].join('\n');
}

function formatBinaryLine(binary) {
  return binary.installed ? `installed (${binary.detail})` : `not installed (${binary.detail})`;
}

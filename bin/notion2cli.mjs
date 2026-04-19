#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import { parseArgv } from '../cli/argv.mjs';
import { inspectDaemon, runManagedDaemon, startDaemon, stopDaemon } from '../cli/daemon.mjs';
import { createPairCode, fetchBridgeStatus } from '../cli/http-client.mjs';
import { formatDoctorReport, parseClaudeMcpList, runDoctor } from '../cli/doctor.mjs';
import { ensureClaudeMcpConfig, getAppPaths } from '../cli/paths.mjs';
import { DEFAULT_PORT, HOST } from '../server/core/constants.mjs';
import { parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { runCommand } from '../server/runtimes/exec-utils.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

await main(process.argv.slice(2));

async function main(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case '--version':
    case '-v':
    case 'version':
      process.stdout.write(`${version}\n`);
      return;
    case 'pair':
      await handlePair(rest);
      return;
    case 'status':
      await handleStatus(rest);
      return;
    case 'doctor':
      await handleDoctor(rest);
      return;
    case 'daemon':
      await handleDaemon(rest);
      return;
    case 'mcp':
      await handleMcp(rest);
      return;
    case 'claude':
      await handleClaude(rest);
      return;
    default:
      throw new Error(`未知命令：${command}\n\n${buildUsageHint()}`);
  }
}

async function handlePair(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (!status.runtime?.ready) {
    throw new Error([
      `当前 runtime 未就绪：${status.runtime?.statusMessage || 'unknown status'}`,
      status.runtime?.launchCommand ? `先启动：${status.runtime.launchCommand}` : null,
    ].filter(Boolean).join('\n'));
  }

  const pair = await createPairCode(target);
  if (options.json) {
    printJson({
      ok: true,
      runtime: status.runtime,
      pair,
    });
    return;
  }

  process.stdout.write([
    `运行时：${status.runtime?.label || 'Unknown Runtime'}`,
    `配对码：${pair.code}`,
    `有效期至：${pair.expiresAt}`,
    status.runtime?.standalone
      ? '提示：当前连到的是 standalone 调试 runtime。浏览器会收到模拟结果，不会调用真实 Claude/Codex 会话。'
      : null,
    '下一步：打开浏览器工具栏中的 notion2CLI，输入这个配对码并点击连接。',
  ].filter(Boolean).join('\n') + '\n');
}

async function handleStatus(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);

  try {
    const status = await fetchBridgeStatus(target);
    printJson(status);
  } catch (error) {
    const inspection = await inspectDaemon(target);
    const detail = inspection.metadata
      ? `检测到 daemon 状态文件：${inspection.metadata.runtime} @ ${inspection.metadata.cwd}`
      : '当前没有已记录的 daemon。';
    throw new Error([
      `notion2CLI bridge 不可达：${target.host}:${target.port} 无响应。`,
      detail,
      error.message,
    ].join('\n'));
  }
}

async function handleDoctor(argv) {
  const options = parseArgv(argv);
  const report = await runDoctor();

  if (options.json) {
    printJson(report);
    return;
  }

  process.stdout.write(`${formatDoctorReport(report)}\n`);
}

async function handleDaemon(argv) {
  const [subcommand, ...rest] = argv;
  const options = parseArgv(rest);

  switch (subcommand) {
    case 'start': {
      const result = await startDaemon({
        runtime: options.runtime,
        cwd: options.cwd,
        host: options.host || HOST,
        port: options.port || DEFAULT_PORT,
        foreground: Boolean(options.foreground),
      });

      if (options.json) {
        printJson(result);
        return;
      }

      if (result.alreadyRunning) {
        process.stdout.write([
          `daemon 已在运行：${result.metadata.runtime}`,
          `地址：http://${result.metadata.host}:${result.metadata.port}`,
          `工作目录：${result.metadata.cwd}`,
        ].join('\n') + '\n');
        return;
      }

      process.stdout.write([
        options.foreground ? 'notion2cli daemon 已以前台模式启动。' : 'notion2cli daemon 已在后台启动。',
        `运行时：${result.metadata?.runtime || options.runtime}`,
        `地址：http://${result.metadata?.host || options.host || HOST}:${result.metadata?.port || options.port || DEFAULT_PORT}`,
        result.metadata?.cwd ? `工作目录：${result.metadata.cwd}` : null,
        options.foreground ? '按 Ctrl+C 可停止当前 daemon。' : null,
      ].filter(Boolean).join('\n') + '\n');
      return;
    }
    case 'run':
      await runManagedDaemon({
        runtime: options.runtime,
        cwd: options.cwd,
        host: options.host || HOST,
        port: options.port || DEFAULT_PORT,
        mode: process.env.NOTION2CLI_DAEMON_MODE || 'background',
      });
      return;
    case 'stop': {
      const result = await stopDaemon();
      if (options.json) {
        printJson(result);
        return;
      }

      process.stdout.write(`${result.message || 'notion2cli daemon 已停止。'}\n`);
      return;
    }
    case 'status': {
      const status = await inspectDaemon({
        host: options.host,
        port: options.port,
      });
      if (options.json) {
        printJson(status);
        return;
      }

      process.stdout.write(formatDaemonStatus(status));
      return;
    }
    default:
      throw new Error([
        '用法：',
        '  notion2cli daemon start --runtime codex',
        '  notion2cli daemon start --runtime standalone --foreground',
        '  notion2cli daemon stop',
        '  notion2cli daemon status',
      ].join('\n'));
  }
}

async function handleMcp(argv) {
  const [subcommand, target, ...rest] = argv;
  if (subcommand !== 'install' || target !== 'notion') {
    throw new Error('用法：notion2cli mcp install notion --runtime codex|claude');
  }

  const options = parseArgv(rest);
  const runtime = resolveMcpRuntime(options.runtime);

  if (runtime === 'codex') {
    const report = await installCodexNotionMcp();
    if (options.json) {
      printJson(report);
      return;
    }

    process.stdout.write(`${report.summary}\n`);
    return;
  }

  const report = await installClaudeNotionMcp();
  if (options.json) {
    printJson(report);
    return;
  }

  process.stdout.write(`${report.summary}\n`);
}

async function handleClaude(argv) {
  const [subcommand, ...rest] = argv;
  const options = parseArgv(rest);

  switch (subcommand) {
    case 'launch': {
      const configPath = await ensureClaudeMcpConfig();
      const cwd = options.cwd || process.cwd();
      const passthrough = options['--'] || [];
      const command = [
        'claude',
        '--mcp-config',
        configPath,
        '--dangerously-load-development-channels',
        'server:notion2cli_bridge',
        ...passthrough,
      ];

      if (options.print) {
        process.stdout.write(`${command.join(' ')}\n`);
        return;
      }

      const child = spawn(command[0], command.slice(1), {
        cwd,
        stdio: 'inherit',
      });

      const exitCode = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 0));
      });
      process.exit(exitCode);
      return;
    }
    case 'config-path': {
      const configPath = await ensureClaudeMcpConfig();
      process.stdout.write(`${configPath}\n`);
      return;
    }
    default:
      throw new Error([
        '用法：',
        '  notion2cli claude launch',
        '  notion2cli claude launch -- --continue',
        '  notion2cli claude config-path',
      ].join('\n'));
  }
}

async function installCodexNotionMcp() {
  const notes = [];
  let status = await probeCodexNotionMcp();

  if (status.status === 'missing') {
    const addResult = await runCommand('codex', ['mcp', 'add', 'notion', '--url', NOTION_MCP_URL], {
      cwd: os.homedir(),
      timeoutMs: 300000,
    });
    const output = compactCommandOutput(addResult);
    notes.push('已执行 `codex mcp add notion --url https://mcp.notion.com/mcp`。');
    if (output) {
      notes.push(output);
    }

    if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(output)) {
      throw new Error(output || '执行 codex mcp add 失败。');
    }
  }

  status = await probeCodexNotionMcp();
  if (status.status === 'unauthenticated') {
    const loginResult = await runCommand('codex', ['mcp', 'login', 'notion'], {
      cwd: os.homedir(),
      timeoutMs: 300000,
    });
    const output = compactCommandOutput(loginResult);
    notes.push('已执行 `codex mcp login notion`。');
    if (output) {
      notes.push(output);
    }

    if (loginResult.code !== 0) {
      throw new Error(output || '执行 codex mcp login 失败。');
    }
  }

  status = await probeCodexNotionMcp();
  return {
    ok: status.status === 'configured',
    runtime: 'codex',
    notionMcp: status,
    summary: [
      status.status === 'configured'
        ? 'Codex CLI 的 Notion MCP 已可用。'
        : 'Codex CLI 的 Notion MCP 仍未达到可用状态。',
      status.detail,
      ...notes,
    ].filter(Boolean).join('\n\n'),
  };
}

async function installClaudeNotionMcp() {
  const notes = [];
  let status = await probeClaudeNotionMcp();

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
      throw new Error(output || '执行 claude mcp add 失败。');
    }
  }

  status = await probeClaudeNotionMcp();
  return {
    ok: status.status === 'configured',
    runtime: 'claude',
    notionMcp: status,
    summary: [
      status.status === 'configured'
        ? 'Claude Code 的 Notion MCP 已可用。'
        : 'Claude Code 的 Notion MCP 已添加，但可能还需要在 Claude 会话中完成授权。',
      status.detail,
      ...notes,
    ].filter(Boolean).join('\n\n'),
  };
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

async function resolveBridgeTarget(options) {
  const inspection = await inspectDaemon({
    host: options.host,
    port: options.port,
  });

  return {
    host: inspection.host,
    port: inspection.port,
  };
}

function resolveMcpRuntime(runtimeOption) {
  if (runtimeOption === 'claude' || runtimeOption === 'codex') {
    return runtimeOption;
  }

  throw new Error('缺少 `--runtime`，或值不是 `claude` / `codex`。');
}

function compactCommandOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .join('\n');
}

function formatDaemonStatus(status) {
  if (status.unmanaged) {
    return [
      `检测到 ${status.host}:${status.port} 上有 bridge，但它不是 notion2cli daemon 管理的。`,
      `当前 runtime：${status.bridge?.runtime?.label || 'unknown'}`,
      '如果这是旧版 bridge，请先手动停止它，再运行 `notion2cli daemon start ...`。',
    ].join('\n') + '\n';
  }

  if (status.running) {
    return [
      'notion2cli daemon 正在运行。',
      `地址：http://${status.host}:${status.port}`,
      `运行时：${status.bridge?.runtime?.label || status.metadata?.runtime || 'unknown'}`,
      status.metadata?.cwd ? `工作目录：${status.metadata.cwd}` : null,
      status.metadata?.pid ? `PID：${status.metadata.pid}` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  if (status.stale) {
    return [
      '检测到过期的 daemon 状态文件。',
      status.metadata?.cwd ? `上次工作目录：${status.metadata.cwd}` : null,
      '运行 `notion2cli daemon stop` 会清理这条记录。',
    ].filter(Boolean).join('\n') + '\n';
  }

  return '当前没有 notion2cli daemon 在运行。\n';
}

function printHelp() {
  process.stdout.write([
    'notion2cli',
    '',
    '命令：',
    '  notion2cli daemon start --runtime codex',
    '  notion2cli daemon start --runtime standalone --foreground',
    '  notion2cli daemon stop',
    '  notion2cli daemon status',
    '  notion2cli pair',
    '  notion2cli status',
    '  notion2cli doctor',
    '  notion2cli mcp install notion --runtime codex',
    '  notion2cli mcp install notion --runtime claude',
    '  notion2cli claude launch',
    '',
    '说明：',
    '  - `codex` 和 `standalone` 支持真正的本地 daemon。',
    '  - `claude` 仍然依赖当前 Claude Code 会话，所以用 `notion2cli claude launch` 启动。',
  ].join('\n') + '\n');
}

function buildUsageHint() {
  return '运行 `notion2cli --help` 查看可用命令。';
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

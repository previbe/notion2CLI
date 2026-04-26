#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgv } from '../cli/argv.mjs';
import { inspectDaemon, runManagedDaemon, startDaemon, stopDaemon } from '../cli/daemon.mjs';
import { createPairCode, fetchBridgeStatus } from '../cli/http-client.mjs';
import { formatDoctorReport, runDoctor } from '../cli/doctor.mjs';
import {
  ensureAppDirs,
  getAppPaths,
  getClaudeChannelServerPath,
  resolveWorkspaceCwd,
  writeJsonFile,
} from '../cli/paths.mjs';
import { DEFAULT_PORT, HOST } from '../server/core/constants.mjs';
import { parseClaudeMcpList } from '../server/runtimes/claude-runtime.mjs';
import { buildClaudeChannelName } from '../server/runtimes/claude-channel-runtime.mjs';
import { parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { runCommand } from '../server/runtimes/exec-utils.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Error: ${error?.message || 'Unknown error'}\n`);
  process.exit(1);
}

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
    case 'codex':
      await handleCodex(rest);
      return;
    case 'claude':
      await handleClaude(rest);
      return;
    case 'mcp':
      await handleMcp(rest);
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

async function handleCodex(argv) {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case 'attach':
      await handleCodexAttach(rest);
      return;
    case 'inspect':
      await handleCodexInspect(rest);
      return;
    case 'open':
      await handleCodexOpen(rest);
      return;
    default:
      throw new Error('用法：notion2cli codex attach|inspect|open');
  }
}

async function handleCodexAttach(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'codex') {
    throw new Error('当前 daemon 不是 Codex runtime。先运行 `notion2cli daemon start --runtime codex`。');
  }

  if (!status.runtime?.ready) {
    throw new Error(status.runtime?.statusMessage || 'Codex runtime 未就绪。');
  }

  if (!status.session?.threadId || !status.session?.wsUrl) {
    throw new Error('当前 Codex 会话还没有准备好。请先重新启动 daemon。');
  }

  const args = options.remoteOnly || !status.session.latestAssistantAt
    ? ['--remote', status.session.wsUrl]
    : ['resume', status.session.threadId, '--remote', status.session.wsUrl];

  if (options.json) {
    printJson({
      ok: true,
      command: ['codex', ...args],
      session: status.session,
    });
    return;
  }

  if (options.print) {
    process.stdout.write(`codex ${args.map(quoteShellArg).join(' ')}\n`);
    return;
  }

  const result = await runInteractiveCommand('codex', args, {
    cwd: status.runtime?.cwd || process.cwd(),
  });
  if (result.code !== 0) {
    throw new Error([
      `Codex attach 退出（code=${result.code ?? 'unknown'}${result.signal ? `, signal=${result.signal}` : ''}）。`,
      args[0] === 'resume'
        ? '如果错误来自 Codex resume session 文件缺失，可以先用 `notion2cli codex attach --remote-only` 直接连接当前 daemon。'
        : null,
    ].filter(Boolean).join('\n'));
  }
}

async function handleCodexInspect(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'codex') {
    throw new Error('当前 daemon 不是 Codex runtime。先运行 `notion2cli daemon start --runtime codex`。');
  }

  if (options.json) {
    printJson({
      ok: true,
      runtime: status.runtime,
      session: status.session || null,
    });
    return;
  }

  process.stdout.write(formatCodexSession(status));
}

async function handleCodexOpen(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'codex') {
    throw new Error('当前 daemon 不是 Codex runtime。先运行 `notion2cli daemon start --runtime codex`。');
  }

  if (process.platform !== 'darwin') {
    throw new Error('当前自动打开 Codex App 只支持 macOS。请手动打开 Codex App 后查看 notion2CLI session。');
  }

  const result = await runCommand('open', ['-b', 'com.openai.codex'], {
    cwd: status.runtime?.cwd || process.cwd(),
    timeoutMs: 8000,
  });
  const output = compactCommandOutput(result);
  if (result.code !== 0) {
    throw new Error(output || '无法打开 Codex App。');
  }

  if (options.json) {
    printJson({
      ok: true,
      session: status.session || null,
    });
    return;
  }

  process.stdout.write([
    '已打开 Codex App。',
    status.session?.threadName ? `会话：${status.session.threadName}` : null,
    status.session?.threadId ? `Thread ID：${status.session.threadId}` : null,
    '如果 Codex App 已经打开但没有立即跳到该会话，请在最近会话里查看 notion2CLI session。',
  ].filter(Boolean).join('\n') + '\n');
}

async function handleClaude(argv) {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case 'launch':
      await handleClaudeLaunch(rest);
      return;
    case 'inspect':
      await handleClaudeInspect(rest);
      return;
    case 'config-path':
      await handleClaudeConfigPath(rest);
      return;
    default:
      throw new Error('用法：notion2cli claude launch|inspect|config-path');
  }
}

async function handleClaudeLaunch(argv) {
  const options = parseArgv(argv);
  const cwd = resolveWorkspaceCwd(options.cwd);
  const host = options.host || HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const configs = await ensureClaudeChannelConfigs({ cwd, host, port });
  const passthrough = options['--'] || [];
  const artifactDir = getAppPaths().artifactsDir;
  const command = [
    'claude',
    '--mcp-config',
    configs.channelConfigPath,
    '--dangerously-load-development-channels',
    'server:notion2cli_bridge',
    '--add-dir',
    artifactDir,
    ...(!hasClaudeOption(passthrough, '--name', '-n') ? ['--name', buildClaudeChannelName(cwd)] : []),
    ...passthrough,
  ];

  if (options.json) {
    printJson({
      ok: true,
      command,
      cwd,
      host,
      port,
      ...configs,
    });
    return;
  }

  if (options.print) {
    process.stdout.write(`${command.map(quoteShellArg).join(' ')}\n`);
    return;
  }

  const result = await runInteractiveCommand(command[0], command.slice(1), { cwd });
  process.exit(result.code ?? 0);
}

async function handleClaudeInspect(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'claude') {
    throw new Error('当前 bridge 不是 Claude runtime。先运行 `notion2cli claude launch`。');
  }

  if (options.json) {
    printJson({
      ok: true,
      runtime: status.runtime,
      session: status.session || null,
      notionMcp: status.notionMcp || null,
    });
    return;
  }

  process.stdout.write(formatClaudeSession(status));
}

async function handleClaudeConfigPath(argv) {
  const options = parseArgv(argv);
  const cwd = resolveWorkspaceCwd(options.cwd);
  const configs = await ensureClaudeChannelConfigs({
    cwd,
    host: options.host || HOST,
    port: Number(options.port || DEFAULT_PORT),
  });

  if (options.json) {
    printJson({
      ok: true,
      ...configs,
    });
    return;
  }

  process.stdout.write([
    `channel：${configs.channelConfigPath}`,
    `worker：${configs.workerConfigPath}`,
  ].join('\n') + '\n');
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
      status.bridge?.runtime?.id === 'codex' && status.bridge?.session?.threadId
        ? `Attach：notion2cli codex attach`
        : null,
      status.bridge?.runtime?.id === 'codex' && status.bridge?.session?.threadId
        ? `Codex App：${status.bridge.session.threadName || status.bridge.session.threadId}（${status.bridge.session.appVisible ? 'App 可见' : '等待同步'}）`
        : null,
      status.bridge?.runtime?.id === 'claude' && status.bridge?.session?.threadId
        ? `Claude Channel：${status.bridge.session.threadName || status.bridge.session.threadId}`
        : null,
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
    '  notion2cli codex attach',
    '  notion2cli codex attach --remote-only',
    '  notion2cli codex inspect',
    '  notion2cli codex open',
    '  notion2cli claude launch',
    '  notion2cli claude inspect',
    '  notion2cli claude config-path',
    '  notion2cli pair',
    '  notion2cli status',
    '  notion2cli doctor',
    '  notion2cli mcp install notion --runtime codex',
    '  notion2cli mcp install notion --runtime claude',
    '',
    '说明：',
    '  - `codex` 主流程使用本地 daemon 和 Codex App session。',
    '  - `claude` 主流程使用 `notion2cli claude launch` 附着当前 Claude Code channel session。',
  ].join('\n') + '\n');
}

function formatCodexSession(status) {
  const session = status.session || null;
  if (!session?.threadId) {
    return [
      '当前没有已准备好的 Codex App session。',
      status.runtime?.statusMessage ? `状态：${status.runtime.statusMessage}` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  return [
    'Codex App session',
    `名称：${session.threadName || 'notion2CLI'}`,
    `Thread ID：${session.threadId}`,
    session.threadPath ? `历史文件：${session.threadPath}` : null,
    `App 可见：${session.appVisible ? '是' : '未确认'}`,
    `Turns：${session.turnCount ?? 0}`,
    session.lastVerifiedAt ? `上次校验：${session.lastVerifiedAt}` : null,
    session.lastVerificationError ? `校验提示：${session.lastVerificationError}` : null,
    session.latestUserMessage ? `最近用户输入：${compactOneLine(session.latestUserMessage)}` : null,
    session.latestAssistantMessage ? `最近 Codex 回复：${compactOneLine(session.latestAssistantMessage)}` : null,
    '打开：notion2cli codex open',
  ].filter(Boolean).join('\n') + '\n';
}

function formatClaudeSession(status) {
  const session = status.session || null;
  if (!session?.sessionId && !session?.threadId) {
    return [
      '当前没有已附着的 Claude Code channel session。',
      status.runtime?.statusMessage ? `状态：${status.runtime.statusMessage}` : null,
      '启动：notion2cli claude launch',
    ].filter(Boolean).join('\n') + '\n';
  }

  return [
    'Claude Code channel session',
    `名称：${session.sessionName || session.threadName || 'notion2CLI'}`,
    `Session ID：${session.sessionId || session.threadId}`,
    `Transport：${session.transport || 'claude-channel'}`,
    `当前会话可见：${session.visibleInNativeClient || session.appVisible ? '是' : '未确认'}`,
    `Turns：${session.turnCount ?? 0}`,
    status.notionMcp?.status ? `Notion MCP：${status.notionMcp.status}` : null,
    status.notionMcp?.detail ? `Notion MCP 详情：${status.notionMcp.detail}` : null,
    session.latestUserMessage ? `最近用户输入：${compactOneLine(session.latestUserMessage)}` : null,
    session.latestAssistantMessage ? `最近 Claude 回复：${compactOneLine(session.latestAssistantMessage)}` : null,
    '启动：notion2cli claude launch',
  ].filter(Boolean).join('\n') + '\n';
}

async function ensureClaudeChannelConfigs({ cwd, host, port }) {
  await ensureAppDirs();
  const paths = getAppPaths();
  const workerConfigPath = paths.claudeWorkerMcpConfigFile;
  const channelConfigPath = paths.claudeChannelMcpConfigFile;

  await writeJsonFile(workerConfigPath, {
    mcpServers: {
      notion: {
        type: 'http',
        url: NOTION_MCP_URL,
      },
    },
  });

  await writeJsonFile(channelConfigPath, {
    mcpServers: {
      notion2cli_bridge: {
        command: process.execPath,
        args: [getClaudeChannelServerPath()],
        cwd,
        env: {
          NOTION2CLI_HOST: host,
          NOTION2CLI_PORT: String(port),
          NOTION2CLI_WORKSPACE_CWD: cwd,
          NOTION2CLI_CLAUDE_WORKER_MCP_CONFIG: workerConfigPath,
        },
      },
      notion: {
        type: 'http',
        url: NOTION_MCP_URL,
      },
    },
  });

  return {
    channelConfigPath,
    workerConfigPath,
  };
}

function hasClaudeOption(args, longName, shortName) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === longName || arg === shortName || arg.startsWith(`${longName}=`)) {
      return true;
    }
  }

  return false;
}

function compactOneLine(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function buildUsageHint() {
  return '运行 `notion2cli --help` 查看可用命令。';
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(text)) {
    return text;
  }

  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

function runInteractiveCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
}

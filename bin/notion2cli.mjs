#!/usr/bin/env node

import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
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
import {
  buildClaudePermissionArgs,
  getPermissionModeLabel,
  hasClaudePermissionArgs,
  inferClaudePermissionModeFromArgs,
  normalizePermissionMode,
} from '../server/core/permission-mode.mjs';
import { parseClaudeMcpList } from '../server/runtimes/claude-runtime.mjs';
import { buildClaudeChannelName } from '../server/runtimes/claude-channel-runtime.mjs';
import { parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { runCommand, spawnCommand } from '../server/runtimes/exec-utils.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
const CLAUDE_BRIDGE_MCP_SERVER_NAME = 'notion2cli_bridge';
const PAIR_READY_TIMEOUT_MS = Number(process.env.NOTION2CLI_PAIR_READY_TIMEOUT_MS || 30000);
const PAIR_READY_POLL_MS = Number(process.env.NOTION2CLI_PAIR_READY_POLL_MS || 500);

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
      throw new Error(`Unknown command: ${command}\n\n${buildUsageHint()}`);
  }
}

async function handlePair(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await waitForRuntimeReady(target);

  if (!status.runtime?.ready) {
    throw new Error([
      `Current runtime is not ready after waiting ${Math.round(PAIR_READY_TIMEOUT_MS / 1000)}s: ${status.runtime?.statusMessage || 'unknown status'}`,
      status.runtime?.launchCommand ? `Start first: ${status.runtime.launchCommand}` : null,
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
    `Runtime: ${status.runtime?.label || 'Unknown Runtime'}`,
    `Pairing code: ${pair.code}`,
    `Expires at: ${pair.expiresAt}`,
    status.runtime?.standalone
      ? 'Note: you are connected to the standalone debug runtime. Browser actions return simulated results and do not call a real Claude/Codex session.'
      : null,
    'Next: open notion2CLI from the browser toolbar, enter this pairing code, and click connect.',
  ].filter(Boolean).join('\n') + '\n');
}

async function waitForRuntimeReady(target) {
  const deadline = Date.now() + PAIR_READY_TIMEOUT_MS;
  let status = await fetchBridgeStatus(target);

  while (!status.runtime?.ready && Date.now() < deadline) {
    await sleep(PAIR_READY_POLL_MS);
    status = await fetchBridgeStatus(target);
  }

  return status;
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
      ? `Found daemon state file: ${inspection.metadata.runtime} @ ${inspection.metadata.cwd}`
      : 'No recorded daemon was found.';
    throw new Error([
      `notion2CLI bridge is not reachable: ${target.host}:${target.port} did not respond.`,
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
      const permissionMode = normalizePermissionMode(options.permissionMode || options['permission-mode'] || process.env.NOTION2CLI_PERMISSION_MODE);
      const result = await startDaemon({
        runtime: options.runtime,
        cwd: options.cwd,
        host: options.host || HOST,
        port: options.port || DEFAULT_PORT,
        permissionMode,
        foreground: Boolean(options.foreground),
      });

      if (options.json) {
        printJson(result);
        return;
      }

      if (result.alreadyRunning) {
        process.stdout.write([
          `daemon is already running: ${result.metadata.runtime}`,
          `Permission mode: ${getPermissionModeLabel(result.metadata.permissionMode)}`,
          `Address: http://${result.metadata.host}:${result.metadata.port}`,
          `Working directory: ${result.metadata.cwd}`,
        ].join('\n') + '\n');
        return;
      }

      process.stdout.write([
        options.foreground ? 'notion2cli daemon started in foreground mode.' : 'notion2cli daemon started in the background.',
        `Runtime: ${result.metadata?.runtime || options.runtime}`,
        `Permission mode: ${getPermissionModeLabel(result.metadata?.permissionMode || permissionMode)}`,
        `Address: http://${result.metadata?.host || options.host || HOST}:${result.metadata?.port || options.port || DEFAULT_PORT}`,
        result.metadata?.cwd ? `Working directory: ${result.metadata.cwd}` : null,
        options.foreground ? 'Press Ctrl+C to stop the current daemon.' : null,
      ].filter(Boolean).join('\n') + '\n');
      return;
    }
    case 'run': {
      const permissionMode = normalizePermissionMode(options.permissionMode || options['permission-mode'] || process.env.NOTION2CLI_PERMISSION_MODE);
      await runManagedDaemon({
        runtime: options.runtime,
        cwd: options.cwd,
        host: options.host || HOST,
        port: options.port || DEFAULT_PORT,
        permissionMode,
        mode: process.env.NOTION2CLI_DAEMON_MODE || 'background',
      });
      return;
    }
    case 'stop': {
      const result = await stopDaemon();
      if (options.json) {
        printJson(result);
        return;
      }

      process.stdout.write(`${result.message || 'notion2cli daemon stopped.'}\n`);
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
        'Usage:',
        '  notion2cli daemon start --runtime codex [--permission-mode default|auto-review|full-access]',
        '  notion2cli daemon start --runtime standalone --foreground',
        '  notion2cli daemon stop',
        '  notion2cli daemon status',
      ].join('\n'));
  }
}

async function handleMcp(argv) {
  const [subcommand, target, ...rest] = argv;
  if (subcommand !== 'install' || target !== 'notion') {
    throw new Error('Usage: notion2cli mcp install notion --runtime codex|claude');
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
      throw new Error('Usage: notion2cli codex attach|inspect|open');
  }
}

async function handleCodexAttach(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'codex') {
    throw new Error('The current daemon is not using the Codex runtime. Run `notion2cli daemon start --runtime codex` first.');
  }

  if (!status.runtime?.ready) {
    throw new Error(status.runtime?.statusMessage || 'Codex runtime is not ready.');
  }

  if (!status.session?.threadId || !status.session?.wsUrl) {
    throw new Error('The current Codex session is not ready. Restart the daemon first.');
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
      `Codex attach exited (code=${result.code ?? 'unknown'}${result.signal ? `, signal=${result.signal}` : ''}).`,
      args[0] === 'resume'
        ? 'If the error is caused by a missing Codex resume session file, use `notion2cli codex attach --remote-only` to connect directly to the current daemon.'
        : null,
    ].filter(Boolean).join('\n'));
  }
}

async function handleCodexInspect(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'codex') {
    throw new Error('The current daemon is not using the Codex runtime. Run `notion2cli daemon start --runtime codex` first.');
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
    throw new Error('The current daemon is not using the Codex runtime. Run `notion2cli daemon start --runtime codex` first.');
  }

  if (process.platform !== 'darwin') {
    const response = buildCodexOpenUnsupportedResponse(status.session || null);
    if (options.json) {
      printJson(response);
      return;
    }

    process.stdout.write(`${response.message}\n`);
    return;
  }

  const result = await runCommand('open', ['-b', 'com.openai.codex'], {
    cwd: status.runtime?.cwd || process.cwd(),
    timeoutMs: 8000,
  });
  const output = compactCommandOutput(result);
  if (result.code !== 0) {
    throw new Error(output || 'Unable to open Codex App.');
  }

  if (options.json) {
    printJson({
      ok: true,
      session: status.session || null,
    });
    return;
  }

  process.stdout.write([
    'Codex App opened.',
    status.session?.threadName ? `Session: ${status.session.threadName}` : null,
    status.session?.threadId ? `Thread ID: ${status.session.threadId}` : null,
    'If Codex App is already open and does not switch immediately, check recent sessions for the notion2CLI session.',
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
      throw new Error('Usage: notion2cli claude launch|inspect|config-path');
  }
}

async function handleClaudeLaunch(argv) {
  const options = parseArgv(argv);
  const cwd = resolveWorkspaceCwd(options.cwd);
  const host = options.host || HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const passthrough = options['--'] || [];
  const explicitPermissionMode = options.permissionMode || options['permission-mode'] || '';
  if (explicitPermissionMode && hasClaudePermissionArgs(passthrough)) {
    throw new Error('Use either `--permission-mode` or passthrough Claude permission flags, not both.');
  }

  const permissionMode = explicitPermissionMode
    ? normalizePermissionMode(explicitPermissionMode)
    : inferClaudePermissionModeFromArgs(passthrough);
  const permissionArgs = explicitPermissionMode ? buildClaudePermissionArgs(permissionMode) : [];
  const configs = await ensureClaudeChannelConfigs({ cwd, host, port, permissionMode });
  const artifactDir = getAppPaths().artifactsDir;
  const command = [
    'claude',
    '--mcp-config',
    configs.channelConfigPath,
    '--dangerously-load-development-channels',
    `server:${CLAUDE_BRIDGE_MCP_SERVER_NAME}`,
    '--add-dir',
    artifactDir,
    ...permissionArgs,
    ...(!hasClaudeOption([...permissionArgs, ...passthrough], '--name', '-n') ? ['--name', buildClaudeChannelName(cwd)] : []),
    ...passthrough,
  ];

  if (options.json) {
    printJson({
      ok: true,
      command,
      cwd,
      host,
      port,
      permissionMode,
      ...configs,
    });
    return;
  }

  if (options.print) {
    process.stdout.write(`${command.map(quoteShellArg).join(' ')}\n`);
    return;
  }

  const registration = await ensureClaudeBridgeMcpRegistration({
    cwd,
    host,
    port,
    permissionMode,
    workerConfigPath: configs.workerConfigPath,
  });
  if (registration.changed) {
    process.stdout.write(`Configured Claude local MCP server: ${CLAUDE_BRIDGE_MCP_SERVER_NAME}\n`);
  }

  const result = await runInteractiveCommand(command[0], command.slice(1), { cwd });
  process.exit(result.code ?? 0);
}

async function handleClaudeInspect(argv) {
  const options = parseArgv(argv);
  const target = await resolveBridgeTarget(options);
  const status = await fetchBridgeStatus(target);

  if (status.runtime?.id !== 'claude') {
    throw new Error('The current bridge is not using the Claude runtime. Run `notion2cli claude launch` first.');
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
    `channel: ${configs.channelConfigPath}`,
    `worker: ${configs.workerConfigPath}`,
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
    notes.push('Ran `codex mcp add notion --url https://mcp.notion.com/mcp`.');
    if (output) {
      notes.push(output);
    }

    if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(output)) {
      throw new Error(output || 'Failed to run codex mcp add.');
    }
  }

  status = await probeCodexNotionMcp();
  if (status.status === 'unauthenticated') {
    const loginResult = await runCommand('codex', ['mcp', 'login', 'notion'], {
      cwd: os.homedir(),
      timeoutMs: 300000,
    });
    const output = compactCommandOutput(loginResult);
    notes.push('Ran `codex mcp login notion`.');
    if (output) {
      notes.push(output);
    }

    if (loginResult.code !== 0) {
      throw new Error(output || 'Failed to run codex mcp login.');
    }
  }

  status = await probeCodexNotionMcp();
  return {
    ok: status.status === 'configured',
    runtime: 'codex',
    notionMcp: status,
    summary: [
      status.status === 'configured'
        ? 'Codex CLI Notion MCP is ready.'
        : 'Codex CLI Notion MCP is still not ready.',
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
    notes.push('Ran `claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp`.');
    if (output) {
      notes.push(output);
    }

    if (addResult.code !== 0 && !/already exists|already configured|already added/i.test(output)) {
      throw new Error(output || 'Failed to run claude mcp add.');
    }
  }

  status = await probeClaudeNotionMcp();
  return {
    ok: status.status === 'configured',
    runtime: 'claude',
    notionMcp: status,
    summary: [
      status.status === 'configured'
        ? 'Claude Code Notion MCP is ready.'
        : 'Claude Code Notion MCP has been added, but authorization may still need to be completed in a Claude session.',
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
      detail: error?.message || 'Unable to check Codex CLI Notion MCP status.',
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

  throw new Error('Missing `--runtime`, or the value is not `claude` / `codex`.');
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
      `Detected ${status.host}:${status.port} has a bridge running, but it is not managed by notion2cli daemon.`,
      `Current runtime: ${status.bridge?.runtime?.label || 'unknown'}`,
      'If this is an old bridge, stop it manually before running `notion2cli daemon start ...`.',
    ].join('\n') + '\n';
  }

  if (status.running) {
    return [
      'notion2cli daemon is running.',
      `Address: http://${status.host}:${status.port}`,
      `Runtime: ${status.bridge?.runtime?.label || status.metadata?.runtime || 'unknown'}`,
      status.bridge?.runtime?.permissionLabel || status.metadata?.permissionMode
        ? `Permission mode: ${status.bridge?.runtime?.permissionLabel || getPermissionModeLabel(status.metadata.permissionMode)}`
        : null,
      status.bridge?.runtime?.id === 'codex' && status.bridge?.session?.threadId
        ? `Attach: notion2cli codex attach`
        : null,
      status.bridge?.runtime?.id === 'codex' && status.bridge?.session?.threadId
        ? `Codex App: ${status.bridge.session.threadName || status.bridge.session.threadId} (${status.bridge.session.appVisible ? 'App visible' : 'waiting for sync'})`
        : null,
      status.bridge?.runtime?.id === 'claude' && status.bridge?.session?.threadId
        ? `Claude Channel: ${status.bridge.session.threadName || status.bridge.session.threadId}`
        : null,
      status.metadata?.cwd ? `Working directory: ${status.metadata.cwd}` : null,
      status.metadata?.pid ? `PID: ${status.metadata.pid}` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  if (status.stale) {
    return [
      'Found a stale daemon state file.',
      status.metadata?.cwd ? `Previous working directory: ${status.metadata.cwd}` : null,
      'Run `notion2cli daemon stop` to clean up this record.',
    ].filter(Boolean).join('\n') + '\n';
  }

  return 'No notion2cli daemon is running.\n';
}

function printHelp() {
  process.stdout.write([
    'notion2cli',
    '',
    'Commands:',
    '  notion2cli daemon start --runtime codex [--permission-mode default|auto-review|full-access]',
    '  notion2cli daemon start --runtime standalone --foreground',
    '  notion2cli daemon stop',
    '  notion2cli daemon status',
    '  notion2cli codex attach',
    '  notion2cli codex attach --remote-only',
    '  notion2cli codex inspect',
    '  notion2cli codex open',
    '  notion2cli claude launch [--permission-mode default|auto-review|full-access]',
    '  notion2cli claude inspect',
    '  notion2cli claude config-path',
    '  notion2cli pair',
    '  notion2cli status',
    '  notion2cli doctor',
    '  notion2cli mcp install notion --runtime codex',
    '  notion2cli mcp install notion --runtime claude',
    '',
    'Notes:',
    '  - `codex` uses a local daemon and Codex App session.',
    '  - `claude` uses `notion2cli claude launch` to attach the active Claude Code channel session.',
    '  - Permission modes affect startup only; restart the CLI to apply a different mode.',
  ].join('\n') + '\n');
}

function formatCodexSession(status) {
  const session = status.session || null;
  if (!session?.threadId) {
    return [
      'No Codex App session is ready.',
      status.runtime?.statusMessage ? `Status: ${status.runtime.statusMessage}` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  return [
    'Codex App session',
    `Name: ${session.threadName || 'notion2CLI'}`,
    `Thread ID: ${session.threadId}`,
    status.runtime?.permissionLabel ? `Permission mode: ${status.runtime.permissionLabel}` : null,
    session.threadPath ? `History file: ${session.threadPath}` : null,
    `App visible: ${session.appVisible ? 'yes' : 'not confirmed'}`,
    `Turns: ${session.turnCount ?? 0}`,
    session.lastVerifiedAt ? `Last verified at: ${session.lastVerifiedAt}` : null,
    session.lastVerificationError ? `Verification note: ${session.lastVerificationError}` : null,
    session.latestUserMessage ? `Latest user input: ${compactOneLine(session.latestUserMessage)}` : null,
    session.latestAssistantMessage ? `Latest Codex reply: ${compactOneLine(session.latestAssistantMessage)}` : null,
    'Open: notion2cli codex open',
  ].filter(Boolean).join('\n') + '\n';
}

function formatClaudeSession(status) {
  const session = status.session || null;
  if (!session?.sessionId && !session?.threadId) {
    return [
      'No Claude Code channel session is attached.',
      status.runtime?.statusMessage ? `Status: ${status.runtime.statusMessage}` : null,
      'Launch: notion2cli claude launch',
    ].filter(Boolean).join('\n') + '\n';
  }

  return [
    'Claude Code channel session',
    `Name: ${session.sessionName || session.threadName || 'notion2CLI'}`,
    `Session ID: ${session.sessionId || session.threadId}`,
    `Transport: ${session.transport || 'claude-channel'}`,
    status.runtime?.permissionLabel ? `Permission mode: ${status.runtime.permissionLabel}` : null,
    `Current session visible: ${session.visibleInNativeClient || session.appVisible ? 'yes' : 'not confirmed'}`,
    `Turns: ${session.turnCount ?? 0}`,
    status.notionMcp?.status ? `Notion MCP: ${status.notionMcp.status}` : null,
    status.notionMcp?.detail ? `Notion MCP detail: ${status.notionMcp.detail}` : null,
    session.latestUserMessage ? `Latest user input: ${compactOneLine(session.latestUserMessage)}` : null,
    session.latestAssistantMessage ? `Latest Claude reply: ${compactOneLine(session.latestAssistantMessage)}` : null,
    'Launch: notion2cli claude launch',
  ].filter(Boolean).join('\n') + '\n';
}

async function ensureClaudeChannelConfigs({ cwd, host, port, permissionMode = 'default' }) {
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
      [CLAUDE_BRIDGE_MCP_SERVER_NAME]: buildClaudeBridgeMcpConfig({
        cwd,
        host,
        port,
        permissionMode,
        workerConfigPath,
      }),
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

async function ensureClaudeBridgeMcpRegistration({ cwd, host, port, permissionMode = 'default', workerConfigPath }) {
  const removeResult = await runCommand('claude', [
    'mcp',
    'remove',
    CLAUDE_BRIDGE_MCP_SERVER_NAME,
  ], {
    cwd,
    timeoutMs: 30000,
  });
  const removeOutput = compactCommandOutput(removeResult);
  if (removeResult.code !== 0 && !/not found|no .*mcp server/i.test(removeOutput)) {
    throw new Error(removeOutput || `Failed to remove stale Claude MCP server ${CLAUDE_BRIDGE_MCP_SERVER_NAME}.`);
  }

  const addResult = await runCommand('claude', [
    'mcp',
    'add-json',
    '--scope',
    'local',
    CLAUDE_BRIDGE_MCP_SERVER_NAME,
    JSON.stringify(buildClaudeBridgeMcpConfig({
      cwd,
      host,
      port,
      permissionMode,
      workerConfigPath,
    })),
  ], {
    cwd,
    timeoutMs: 30000,
  });
  const addOutput = compactCommandOutput(addResult);
  if (addResult.code !== 0) {
    throw new Error(addOutput || `Failed to add Claude MCP server ${CLAUDE_BRIDGE_MCP_SERVER_NAME}.`);
  }

  return {
    changed: true,
    removeOutput,
    addOutput,
  };
}

function buildClaudeBridgeMcpConfig({ cwd, host, port, permissionMode = 'default', workerConfigPath }) {
  return {
    command: process.execPath,
    args: [getClaudeChannelServerPath()],
    cwd,
    env: {
      NOTION2CLI_HOST: host,
      NOTION2CLI_PORT: String(port),
      NOTION2CLI_WORKSPACE_CWD: cwd,
      NOTION2CLI_PERMISSION_MODE: normalizePermissionMode(permissionMode),
      NOTION2CLI_CLAUDE_WORKER_MCP_CONFIG: workerConfigPath,
    },
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

  return `${text.slice(0, maxLength - 1)}...`;
}

function buildUsageHint() {
  return 'Run `notion2cli --help` to see available commands.';
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
    const child = spawnCommand(command, args, {
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

function buildCodexOpenUnsupportedResponse(session = null) {
  return {
    ok: false,
    supported: false,
    session,
    message: [
      process.platform === 'win32'
        ? 'Automatic Codex App opening is not available in native Windows mode yet.'
        : 'Automatic Codex App opening is not available on this platform yet.',
      session?.threadName ? `Open Codex App manually and look for: ${session.threadName}.` : 'Open Codex App manually and check recent sessions for the notion2CLI session.',
      session?.threadId ? `Thread ID: ${session.threadId}` : null,
    ].filter(Boolean).join(' '),
  };
}

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { DEFAULT_PORT, HOST } from '../server/core/constants.mjs';
import { startBridgeServer } from '../server/bridge-server.mjs';
import { fetchBridgeStatus } from './http-client.mjs';
import {
  clearFileIfOwnedSync,
  ensureAppDirs,
  getAppPaths,
  getCliEntrypointPath,
  readJsonFile,
  removeFile,
  resolveWorkspaceCwd,
  writeJsonFile,
} from './paths.mjs';

const START_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 6000;
const POLL_INTERVAL_MS = 250;

export async function readDaemonMetadata() {
  return readJsonFile(getAppPaths().daemonFile);
}

export async function inspectDaemon(options = {}) {
  const metadata = await readDaemonMetadata();
  const host = options.host || metadata?.host || HOST;
  const port = Number(options.port || metadata?.port || DEFAULT_PORT);

  let bridge = null;
  let bridgeError = null;
  try {
    bridge = await fetchBridgeStatus({ host, port });
  } catch (error) {
    bridgeError = error?.message || 'bridge is not reachable';
  }

  return {
    metadata,
    host,
    port,
    bridge,
    bridgeError,
    managed: Boolean(metadata),
    running: Boolean(metadata && bridge?.bridgeRunning),
    stale: Boolean(metadata && !bridge),
    unmanaged: Boolean(!metadata && bridge),
  };
}

export async function startDaemon(options = {}) {
  const runtime = String(options.runtime || '').trim();
  if (!runtime) {
    throw new Error('Missing `--runtime`. Valid values: codex, standalone. Use `notion2cli claude launch` for Claude.');
  }

  if (!['codex', 'standalone'].includes(runtime)) {
    throw new Error('daemon currently supports only `codex` or `standalone`. Use `notion2cli claude launch` for Claude.');
  }

  const host = options.host || HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const cwd = resolveWorkspaceCwd(options.cwd);
  const foreground = Boolean(options.foreground);
  const inspection = await inspectDaemon({ host, port });

  if (inspection.running) {
    const current = inspection.metadata;
    if (current && current.runtime === runtime && current.cwd === cwd) {
      return {
        ok: true,
        alreadyRunning: true,
        metadata: current,
        bridge: inspection.bridge,
      };
    }

    throw new Error([
      `A notion2cli daemon is already running: ${inspection.bridge?.runtime?.label || inspection.metadata?.runtime || 'unknown runtime'}`,
      inspection.metadata?.cwd ? `Working directory: ${inspection.metadata.cwd}` : null,
      'Run `notion2cli daemon stop` before starting a new daemon.',
    ].filter(Boolean).join('\n'));
  }

  if (inspection.stale) {
    await cleanupStaleDaemon(inspection.metadata);
  }

  if (foreground) {
    const metadata = await runManagedDaemon({ runtime, cwd, host, port, mode: 'foreground' });
    return {
      ok: true,
      started: true,
      foreground: true,
      metadata,
    };
  }

  return startDetachedDaemon({ runtime, cwd, host, port });
}

export async function runManagedDaemon(options = {}) {
  const runtime = options.runtime;
  const host = options.host || HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const cwd = resolveWorkspaceCwd(options.cwd);
  const paths = await ensureAppDirs();
  const metadata = {
    pid: process.pid,
    runtime,
    host,
    port,
    cwd,
    mode: options.mode || 'background',
    startedAt: new Date().toISOString(),
    logFile: paths.daemonOutLog,
    errorLogFile: paths.daemonErrLog,
    platform: os.platform(),
  };

  await writeJsonFile(paths.daemonFile, metadata);
  registerMetadataCleanup(process.pid);
  await startBridgeServer({
    runtimeId: runtime,
    host,
    port,
    cwd,
  });
  return metadata;
}

export async function stopDaemon() {
  const inspection = await inspectDaemon();
  if (!inspection.metadata) {
    if (inspection.bridge) {
      throw new Error(`Detected a bridge at ${inspection.host}:${inspection.port}, but it is not managed by notion2cli daemon. Stop it manually.`);
    }

    return {
      ok: true,
      stopped: false,
      message: 'No notion2cli daemon is running.',
    };
  }

  if (!inspection.running) {
    await cleanupStaleDaemon(inspection.metadata);
    return {
      ok: true,
      stopped: true,
      stale: true,
      message: 'bridge is offline. Stale daemon state was cleaned up.',
    };
  }

  const pid = Number(inspection.metadata.pid);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code === 'ESRCH') {
      await cleanupStaleDaemon(inspection.metadata);
      return {
        ok: true,
        stopped: true,
        stale: true,
        message: 'daemon process no longer exists. State file was cleaned up.',
      };
    }

    throw error;
  }

  await waitForBridgeToStop({
    host: inspection.host,
    port: inspection.port,
    timeoutMs: STOP_TIMEOUT_MS,
  });
  await removeFile(getAppPaths().daemonFile);

  return {
    ok: true,
    stopped: true,
    pid,
    runtime: inspection.metadata.runtime,
  };
}

async function startDetachedDaemon({ runtime, cwd, host, port }) {
  const paths = await ensureAppDirs();
  const stdoutHandle = await open(paths.daemonOutLog, 'a');
  const stderrHandle = await open(paths.daemonErrLog, 'a');

  const child = spawn(
    process.execPath,
    [
      getCliEntrypointPath(),
      'daemon',
      'run',
      '--runtime',
      runtime,
      '--cwd',
      cwd,
      '--host',
      host,
      '--port',
      String(port),
    ],
    {
      detached: true,
      cwd,
      env: {
        ...process.env,
        NOTION2CLI_DAEMON_MODE: 'background',
      },
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
    },
  );

  child.unref();
  await stdoutHandle.close();
  await stderrHandle.close();

  try {
    await waitForBridge({
      host,
      port,
      timeoutMs: START_TIMEOUT_MS,
    });
  } catch (error) {
    const logTail = await readLogTail(paths.daemonErrLog);
    throw new Error([
      error.message,
      logTail ? 'Recent daemon error log:\n' + logTail : null,
    ].filter(Boolean).join('\n\n'));
  }

  return {
    ok: true,
    started: true,
    metadata: await readDaemonMetadata(),
    bridge: await fetchBridgeStatus({ host, port }),
  };
}

async function cleanupStaleDaemon(metadata) {
  if (metadata?.pid) {
    try {
      process.kill(Number(metadata.pid), 'SIGTERM');
    } catch {}
  }

  await removeFile(getAppPaths().daemonFile);
}

async function waitForBridge({ host, port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchBridgeStatus({ host, port });
    } catch (error) {
      lastError = error;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(lastError?.message || 'Timed out while starting daemon.');
}

async function waitForBridgeToStop({ host, port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await fetchBridgeStatus({ host, port });
      await sleep(POLL_INTERVAL_MS);
    } catch {
      return;
    }
  }

  throw new Error('Timed out while waiting for daemon to stop.');
}

async function readLogTail(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .trim()
      .split('\n')
      .slice(-12)
      .join('\n');
  } catch {
    return '';
  }
}

function registerMetadataCleanup(pid) {
  const daemonFile = getAppPaths().daemonFile;
  const cleanup = () => clearFileIfOwnedSync(daemonFile, pid);
  process.on('exit', cleanup);
}

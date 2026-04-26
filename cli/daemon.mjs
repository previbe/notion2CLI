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
    bridgeError = error?.message || 'bridge 不可达';
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
    throw new Error('缺少 `--runtime`。可选值：codex、standalone。Claude 请使用 `notion2cli claude launch`。');
  }

  if (!['codex', 'standalone'].includes(runtime)) {
    throw new Error('daemon 当前只支持 `codex` 或 `standalone`。Claude 请使用 `notion2cli claude launch`。');
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
      `已有 notion2cli daemon 正在运行：${inspection.bridge?.runtime?.label || inspection.metadata?.runtime || 'unknown runtime'}`,
      inspection.metadata?.cwd ? `工作目录：${inspection.metadata.cwd}` : null,
      '先运行 `notion2cli daemon stop`，再启动新的 daemon。',
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
      throw new Error(`检测到 ${inspection.host}:${inspection.port} 上有 bridge，但它不是 notion2cli 管理的 daemon。请手动停止它。`);
    }

    return {
      ok: true,
      stopped: false,
      message: '当前没有 notion2cli daemon 在运行。',
    };
  }

  if (!inspection.running) {
    await cleanupStaleDaemon(inspection.metadata);
    return {
      ok: true,
      stopped: true,
      stale: true,
      message: 'bridge 已不在线，已清理过期 daemon 状态。',
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
        message: 'daemon 进程已不存在，已清理状态文件。',
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
      logTail ? '最近 daemon 错误日志：\n' + logTail : null,
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

  throw new Error(lastError?.message || 'daemon 启动超时。');
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

  throw new Error('等待 daemon 停止超时。');
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

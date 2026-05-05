#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeApp } from './core/bridge-app.mjs';
import { DEFAULT_PORT, HOST } from './core/constants.mjs';
import { normalizePermissionMode } from './core/permission-mode.mjs';
import { createBridgeHttpServer } from './core/http-server.mjs';
import { ClaudeChannelRuntime } from './runtimes/claude-channel-runtime.mjs';
import { ClaudeRuntime } from './runtimes/claude-runtime.mjs';
import { CodexRuntime } from './runtimes/codex-runtime.mjs';
import { StandaloneRuntime } from './runtimes/standalone-runtime.mjs';

export async function startBridgeServer(options = {}) {
  const runtimeId = options.runtimeId || process.env.NOTION2CLI_RUNTIME || 'standalone';
  const host = options.host || HOST;
  const port = Number(options.port ?? DEFAULT_PORT);
  const cwd = options.cwd || process.env.NOTION2CLI_WORKSPACE_CWD || process.cwd();
  const permissionMode = normalizePermissionMode(options.permissionMode || process.env.NOTION2CLI_PERMISSION_MODE);
  const log = options.log || createLogger();
  const runtime = options.runtime || createRuntime(runtimeId, log, { cwd, permissionMode });
  const app = new BridgeApp({ runtime, log });
  const httpServer = createBridgeHttpServer(app, log, { host, port });
  let closed = false;
  const startup = app.start()
    .then(async () => {
      if (closed) {
        await app.stop();
      }
    })
    .catch((error) => {
      log('bridge runtime startup failed', {
        runtime: runtime.id || runtimeId,
        error: error?.message || 'Unknown runtime startup error',
      });
    });

  const shutdown = async (reason = 'shutdown') => {
    if (closed) {
      return;
    }

    closed = true;
    log('bridge shutting down', { reason });
    await Promise.allSettled([
      httpServer.close(),
      app.stop(),
    ]);
  };

  const handleSignal = (signal) => {
    shutdown(signal).finally(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  const address = await httpServer.listen();

  return {
    app,
    httpServer,
    address,
    startup,
    shutdown,
    runtimeId,
    cwd,
    permissionMode,
  };
}

function createRuntime(id, logger, options = {}) {
  switch (id) {
    case 'claude-channel':
      return new ClaudeChannelRuntime(logger, { cwd: options.cwd });
    case 'claude':
      return new ClaudeRuntime(logger, { cwd: options.cwd });
    case 'codex':
      return new CodexRuntime(logger, { cwd: options.cwd });
    case 'standalone':
      return new StandaloneRuntime(logger);
    default:
      throw new Error(`Unsupported runtime: ${id}`);
  }
}

function parseOptions(argv, env) {
  const fallback = env.NOTION2CLI_RUNTIME || 'standalone';
  const options = {
    runtimeId: fallback,
    host: env.NOTION2CLI_HOST || HOST,
    port: Number(env.NOTION2CLI_PORT || DEFAULT_PORT),
    cwd: env.NOTION2CLI_WORKSPACE_CWD || process.cwd(),
    permissionMode: normalizePermissionMode(env.NOTION2CLI_PERMISSION_MODE),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--runtime' && next) {
      options.runtimeId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === '--host' && next) {
      options.host = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === '--port' && next) {
      options.port = Number(next);
      index += 1;
      continue;
    }

    if (arg === '--cwd' && next) {
      options.cwd = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === '--permission-mode' && next) {
      options.permissionMode = normalizePermissionMode(next);
      index += 1;
    }
  }

  return options;
}

function createLogger() {
  return (message, extra = null) => {
    const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
    process.stderr.write(`[notion2cli] ${message}${suffix}\n`);
  };
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  await startBridgeServer(parseOptions(process.argv.slice(2), process.env));
}

function isDirectRun(moduleUrl, argv1) {
  if (!argv1) {
    return false;
  }

  return fileURLToPath(moduleUrl) === path.resolve(argv1);
}

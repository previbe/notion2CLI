import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let killTimer = null;

    const clearTimers = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };

    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode == null) {
            child.kill('SIGKILL');
          }
        }, options.killAfterMs || 1000);
        killTimer.unref?.();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timer.unref?.();
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimers();

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (code, signal) => {
      clearTimers();

      if (settled) {
        return;
      }

      settled = true;
      resolve({ code, signal, stdout, stderr });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
    }

    child.stdin.end();
  });
}

export function spawnCommand(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const env = buildSpawnEnv(options.env, platform);
  const resolved = resolveCommandForSpawn(command, args, {
    ...options,
    env,
    platform,
  });
  return spawn(resolved.command, resolved.args, {
    cwd: options.cwd,
    env,
    stdio: options.stdio,
    detached: options.detached,
    windowsHide: options.windowsHide ?? platform === 'win32',
    windowsVerbatimArguments: resolved.windowsVerbatimArguments || options.windowsVerbatimArguments,
  });
}

export function resolveCommandForSpawn(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const normalizedArgs = Array.isArray(args) ? args : [];

  if (platform !== 'win32') {
    return {
      command,
      args: normalizedArgs,
      resolvedCommand: command,
      viaShell: false,
    };
  }

  const env = options.env || process.env;
  const resolvedCommand = resolveWindowsExecutable(command, env) || command;
  if (isWindowsCommandScript(resolvedCommand)) {
    const comspec = getEnvValue(env, 'ComSpec') || 'cmd.exe';
    return {
      command: comspec,
      args: ['/d', '/s', '/c', `"${buildWindowsCommandLine(resolvedCommand, normalizedArgs)}"`],
      resolvedCommand,
      viaShell: true,
      windowsVerbatimArguments: true,
    };
  }

  return {
    command: resolvedCommand,
    args: normalizedArgs,
    resolvedCommand,
    viaShell: false,
  };
}

export function buildWindowsCommandLine(command, args = []) {
  return [
    quoteWindowsCommandArg(command),
    ...args.map((arg) => quoteWindowsCommandArg(arg)),
  ].join(' ');
}

export function buildSpawnEnv(env, platform = process.platform) {
  if (platform !== 'win32') {
    return env;
  }

  const nextEnv = { ...(env || process.env) };
  appendPathEntry(nextEnv, path.dirname(process.execPath));
  return nextEnv;
}

function resolveWindowsExecutable(command, env) {
  const value = String(command || '').trim();
  if (!value) {
    return command;
  }

  const hasPathSeparator = /[\\/]/.test(value);
  const extensions = getWindowsExecutableExtensions(value, env);

  if (hasPathSeparator) {
    return findExistingWindowsCandidate(value, extensions);
  }

  for (const dir of getPathEntries(env)) {
    const candidate = findExistingWindowsCandidate(path.join(dir, value), extensions);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function findExistingWindowsCandidate(basePath, extensions) {
  for (const extension of extensions) {
    const candidate = extension ? `${basePath}${extension}` : basePath;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {}
  }

  return null;
}

function getWindowsExecutableExtensions(command, env) {
  if (path.extname(command)) {
    return [''];
  }

  const pathext = getEnvValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD';
  const extensions = pathext
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  return [...extensions, ''];
}

function getPathEntries(env) {
  const rawPath = getEnvValue(env, 'PATH') || '';
  return rawPath
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getEnvValue(env, key) {
  if (!env || typeof env !== 'object') {
    return '';
  }

  if (Object.hasOwn(env, key)) {
    return env[key];
  }

  const lowerKey = key.toLowerCase();
  const match = Object.keys(env).find((candidate) => candidate.toLowerCase() === lowerKey);
  return match ? env[match] : '';
}

function appendPathEntry(env, entry) {
  const value = String(entry || '').trim();
  if (!value) {
    return;
  }

  const key = getEnvKey(env, 'PATH') || 'Path';
  const entries = String(env[key] || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  const alreadyPresent = entries.some((item) => item.trimEnd('\\/') === value.trimEnd('\\/'));
  if (alreadyPresent) {
    return;
  }

  env[key] = [...entries, value].join(path.delimiter);
}

function getEnvKey(env, key) {
  if (!env || typeof env !== 'object') {
    return '';
  }

  if (Object.hasOwn(env, key)) {
    return key;
  }

  const lowerKey = key.toLowerCase();
  return Object.keys(env).find((candidate) => candidate.toLowerCase() === lowerKey) || '';
}

function isWindowsCommandScript(command) {
  return /\.(bat|cmd)$/i.test(String(command || ''));
}

function quoteWindowsCommandArg(value) {
  const text = String(value ?? '');
  if (!text) {
    return '""';
  }

  if (!/[\s"&|<>^()%!]/.test(text)) {
    return text;
  }

  return `"${text
    .replace(/"/g, '\\"')
    .replace(/([&|<>^()%!])/g, '^$1')}"`;
}

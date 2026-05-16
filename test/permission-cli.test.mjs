import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startDaemon } from '../cli/daemon.mjs';
import { getCliEntrypointPath } from '../cli/paths.mjs';

test('claude launch rejects explicit permission mode plus passthrough permission flags', () => {
  const result = spawnSync(process.execPath, [
    getCliEntrypointPath(),
    'claude',
    'launch',
    '--permission-mode',
    'auto-review',
    '--',
    '--dangerously-skip-permissions',
  ], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use either `--permission-mode` or passthrough Claude permission flags/);
});

test('claude launch writes strict stdio MCP config for channel bridge', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-home-'));
  try {
    const result = await runNode([
      getCliEntrypointPath(),
      'claude',
      'launch',
      '--json',
    ], {
      env: {
        ...process.env,
        NOTION2CLI_HOME: home,
      },
    });

    assert.equal(result.status, 0);
    const channelConfig = JSON.parse(await readFile(path.join(home, 'claude-channel.mcp.json'), 'utf8'));
    const workerConfig = JSON.parse(await readFile(path.join(home, 'claude-worker.mcp.json'), 'utf8'));

    assert.equal(channelConfig.mcpServers.notion2cli_bridge.type, 'stdio');
    assert.equal(typeof channelConfig.mcpServers.notion2cli_bridge.command, 'string');
    assert.deepEqual(workerConfig.mcpServers.notion, {
      type: 'http',
      url: 'https://mcp.notion.com/mcp',
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('daemon start refuses to reuse a running daemon with a different permission mode', async () => {
  const originalHome = process.env.NOTION2CLI_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-home-'));
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-cwd-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/api/status') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        bridgeRunning: true,
        runtime: {
          id: 'codex',
          label: 'Codex CLI',
          ready: true,
        },
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  try {
    process.env.NOTION2CLI_HOME = home;
    await mkdir(path.join(home, 'state'), { recursive: true });
    const address = await listen(server);
    await writeFile(path.join(home, 'state', 'daemon.json'), JSON.stringify({
      pid: process.pid,
      runtime: 'codex',
      permissionMode: 'default',
      host: address.address,
      port: address.port,
      cwd,
      mode: 'background',
    }));

    await assert.rejects(
      () => startDaemon({
        runtime: 'codex',
        cwd,
        host: address.address,
        port: address.port,
        permissionMode: 'full-access',
      }),
      (error) => {
        assert.match(error.message, /A notion2cli daemon is already running/);
        assert.match(error.message, /Permission mode: default/);
        assert.match(error.message, /notion2cli daemon stop/);
        return true;
      },
    );
  } finally {
    await closeServer(server);
    if (originalHome === undefined) {
      delete process.env.NOTION2CLI_HOME;
    } else {
      process.env.NOTION2CLI_HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('pair waits for the runtime to become ready before creating a pair code', async () => {
  const originalHome = process.env.NOTION2CLI_HOME;
  const home = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-home-'));
  let statusCalls = 0;
  let pairCalls = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/api/status') {
      statusCalls += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        bridgeRunning: true,
        runtime: {
          id: 'codex',
          label: 'Codex CLI',
          ready: statusCalls >= 3,
          statusMessage: statusCalls >= 3 ? 'Codex CLI is ready.' : 'Waiting to check Codex CLI.',
          launchCommand: 'notion2cli daemon start --runtime codex --permission-mode full-access',
        },
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/pair/create') {
      pairCalls += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        code: '123456',
        expiresAt: '2026-05-05T16:00:00.000Z',
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  try {
    process.env.NOTION2CLI_HOME = home;
    await mkdir(path.join(home, 'state'), { recursive: true });
    const address = await listen(server);
    await writeFile(path.join(home, 'state', 'daemon.json'), JSON.stringify({
      pid: process.pid,
      runtime: 'codex',
      permissionMode: 'full-access',
      host: address.address,
      port: address.port,
      cwd: process.cwd(),
      mode: 'background',
    }));

    const result = await runNode([
      getCliEntrypointPath(),
      'pair',
    ], {
      env: {
        ...process.env,
        NOTION2CLI_HOME: home,
        NOTION2CLI_PAIR_READY_TIMEOUT_MS: '1000',
        NOTION2CLI_PAIR_READY_POLL_MS: '10',
      },
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Pairing code: 123456/);
    assert.equal(statusCalls, 3);
    assert.equal(pairCalls, 1);
  } finally {
    await closeServer(server);
    if (originalHome === undefined) {
      delete process.env.NOTION2CLI_HOME;
    } else {
      process.env.NOTION2CLI_HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
  }
});

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

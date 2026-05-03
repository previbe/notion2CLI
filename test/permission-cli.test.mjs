import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

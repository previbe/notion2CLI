import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MCPConfigWatcher } from '../server/runtimes/mcp-config-watcher.mjs';

function makeProbe(values) {
  let calls = 0;
  const probe = async () => {
    const next = values[Math.min(calls, values.length - 1)];
    calls += 1;
    return typeof next === 'function' ? next() : next;
  };
  probe.callCount = () => calls;
  return probe;
}

async function waitForCondition(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await delay(25);
  }
  assert.equal(predicate(), true);
}

function setupTempConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), 'mcp-watcher-'));
  const file = path.join(dir, '.claude.json');
  writeFileSync(file, '{}');
  return {
    dir,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('MCPConfigWatcher caches initial probe result for sync reads', async () => {
  const { file, cleanup } = setupTempConfig();
  const probe = makeProbe([{ status: 'configured', detail: 'first' }]);
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe });

  await watcher.start();
  assert.equal(probe.callCount(), 1);
  assert.deepEqual(await watcher.getStatus(), { status: 'configured', detail: 'first' });
  assert.deepEqual(await watcher.getStatus(), { status: 'configured', detail: 'first' });
  assert.equal(probe.callCount(), 1, 'getStatus must not re-probe');

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher re-probes when a watched config file changes', async () => {
  const { file, cleanup } = setupTempConfig();
  const probe = makeProbe([
    { status: 'missing', detail: 'first' },
    { status: 'configured', detail: 'second' },
  ]);
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe, debounceMs: 30 });

  await watcher.start();
  assert.equal(probe.callCount(), 1);

  // Wait for the kqueue subscription to settle on macOS — fs.watch returns
  // synchronously but the underlying subscription needs a few ms before
  // events are delivered.
  await delay(80);
  writeFileSync(file, '{"changed":1}');
  await delay(200);

  assert.equal(probe.callCount(), 2);
  assert.deepEqual(await watcher.getStatus(), { status: 'configured', detail: 'second' });

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher.invalidate() forces an immediate re-probe', async () => {
  const { file, cleanup } = setupTempConfig();
  const probe = makeProbe([
    { status: 'unauthenticated', detail: 'first' },
    { status: 'configured', detail: 'second' },
  ]);
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe });

  await watcher.start();
  assert.equal(probe.callCount(), 1);

  watcher.invalidate();
  const status = await watcher.getStatus();

  assert.equal(probe.callCount(), 2);
  assert.deepEqual(status, { status: 'configured', detail: 'second' });

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher re-runs after invalidate during an active probe', async () => {
  const { file, cleanup } = setupTempConfig();
  let calls = 0;
  let releaseSecondProbe = null;
  const probe = async () => {
    calls += 1;
    if (calls === 2) {
      await new Promise((resolve) => {
        releaseSecondProbe = resolve;
      });
    }
    return {
      status: calls === 1 ? 'unauthenticated' : 'configured',
      detail: `probe-${calls}`,
    };
  };
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe });

  await watcher.start();
  assert.equal(calls, 1);

  watcher.invalidate();
  assert.equal(calls, 2);
  const freshStatus = watcher.invalidate();
  releaseSecondProbe();

  assert.deepEqual(await freshStatus, { status: 'configured', detail: 'probe-3' });
  assert.equal(calls, 3);
  assert.deepEqual(await watcher.getStatus(), { status: 'configured', detail: 'probe-3' });

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher.stop() prevents an active dirty probe from looping', async () => {
  const { file, cleanup } = setupTempConfig();
  let calls = 0;
  let releaseSecondProbe = null;
  const probe = async () => {
    calls += 1;
    if (calls === 2) {
      await new Promise((resolve) => {
        releaseSecondProbe = resolve;
      });
    }
    return {
      status: calls === 1 ? 'unauthenticated' : 'configured',
      detail: `probe-${calls}`,
    };
  };
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe });

  await watcher.start();
  assert.equal(calls, 1);

  const firstRefresh = watcher.invalidate();
  assert.equal(calls, 2);
  const dirtyRefresh = watcher.invalidate();
  watcher.stop();
  releaseSecondProbe();

  assert.deepEqual(await firstRefresh, { status: 'configured', detail: 'probe-2' });
  assert.deepEqual(await dirtyRefresh, { status: 'configured', detail: 'probe-2' });
  assert.equal(calls, 2);
  assert.equal(watcher.activeProbe, null);

  cleanup();
});

test('MCPConfigWatcher swallows probe errors and reports unknown status', async () => {
  const { file, cleanup } = setupTempConfig();
  const probe = makeProbe([
    () => { throw new Error('boom'); },
  ]);
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe });

  await watcher.start();
  const status = await watcher.getStatus();
  assert.equal(status.status, 'unknown');
  assert.match(status.detail, /boom/);

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher skips watcher attach when config file is absent', async () => {
  const { dir, cleanup } = setupTempConfig();
  const missing = path.join(dir, 'not-there.json');
  const probe = makeProbe([{ status: 'missing', detail: 'first' }]);
  const watcher = new MCPConfigWatcher({ configPaths: [missing], runProbe: probe });

  await watcher.start();
  assert.equal(probe.callCount(), 1);
  assert.deepEqual(await watcher.getStatus(), { status: 'missing', detail: 'first' });

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher re-probes after an absent watched file is created', async () => {
  const { dir, cleanup } = setupTempConfig();
  const missing = path.join(dir, 'mcp-needs-auth-cache.json');
  const probe = makeProbe([
    { status: 'unauthenticated', detail: 'first' },
    { status: 'configured', detail: 'second' },
  ]);
  const watcher = new MCPConfigWatcher({ configPaths: [missing], runProbe: probe });

  await watcher.start();
  assert.equal(probe.callCount(), 1);

  writeFileSync(missing, '{}');
  await waitForCondition(() => probe.callCount() === 2);

  assert.deepEqual(await watcher.getStatus(), { status: 'configured', detail: 'second' });

  watcher.stop();
  cleanup();
});

test('MCPConfigWatcher.stop() cancels pending debounce and reopen timers', async () => {
  const { file, cleanup } = setupTempConfig();
  const probe = makeProbe([{ status: 'configured', detail: 'first' }]);
  const watcher = new MCPConfigWatcher({ configPaths: [file], runProbe: probe, debounceMs: 50 });

  await watcher.start();
  await delay(80);
  writeFileSync(file, '{"changed":1}');
  watcher.stop();

  await delay(120);
  assert.equal(probe.callCount(), 1, 'probe must not run after stop()');

  cleanup();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startBridgeServer } from '../server/bridge-server.mjs';

test('bridge server listens before a slow runtime finishes startup', async () => {
  let releaseStartup;
  const runtime = {
    id: 'slow-runtime',
    label: 'Slow Runtime',
    ready: false,
    async start() {
      await new Promise((resolve) => {
        releaseStartup = resolve;
      });
      this.ready = true;
    },
    async stop() {},
    async startPairing() {
      if (!this.ready) {
        throw new Error('Slow runtime is not ready');
      }
    },
    async getStatus() {
      return {
        runtime: {
          id: this.id,
          label: this.label,
          ready: this.ready,
          standalone: false,
          statusMessage: this.ready ? 'Slow runtime is ready.' : 'Slow runtime is starting.',
        },
        notionMcp: {
          status: 'unknown',
          detail: this.ready ? 'Ready.' : 'Starting.',
        },
      };
    },
  };

  const pending = startBridgeServer({
    runtimeId: runtime.id,
    runtime,
    port: 0,
    log: () => {},
  });
  const started = await Promise.race([
    pending,
    sleep(500).then(() => null),
  ]);

  assert.notEqual(started, null);

  try {
    const response = await fetch(`http://${started.address.host}:${started.address.port}/api/status`);
    const status = await response.json();

    assert.equal(response.status, 200);
    assert.equal(status.ok, true);
    assert.equal(status.bridgeRunning, true);
    assert.equal(status.runtime.ready, false);

    releaseStartup();
    await started.startup;
  } finally {
    await started?.shutdown('test');
  }
});

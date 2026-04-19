import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { BridgeApp } from '../server/core/bridge-app.mjs';
import { createBridgeHttpServer } from '../server/core/http-server.mjs';

class FakeRuntime {
  constructor() {
    this.id = 'fake';
    this.label = 'Fake Runtime';
    this.context = null;
  }

  async start(context) {
    this.context = context;
  }

  async stop() {}

  async startPairing() {}

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, { type: 'fake_dispatched' });
    this.context.markJobRunning(job.id, { type: 'fake_running' });
    setTimeout(() => {
      this.context.completeJob(job.id, `Echo: ${job.selectionText || job.pageTitle}`, {
        type: 'fake_completed',
      });
    }, 20);
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'test',
        ready: true,
        standalone: false,
        sessionAttached: false,
        pairingCommand: 'notion2cli-connect',
        launchCommand: 'npm run fake',
        statusMessage: 'fake runtime ready',
      },
      capabilities: {
        supportsInteractiveSessionAttach: false,
        supportsStandaloneDispatch: true,
        supportsNotionRead: true,
        supportsNotionWrite: true,
        supportsInstallGuidance: true,
      },
      notionMcp: {
        status: 'configured',
        detail: 'fake notion mcp ready',
      },
    };
  }
}

test('bridge app pairs and completes a browser job through the runtime contract', async () => {
  const app = new BridgeApp({
    runtime: new FakeRuntime(),
    log: () => {},
  });
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });

  await app.start();
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const initialStatus = await getJson(`${baseUrl}/api/status`);
    assert.equal(initialStatus.runtime.label, 'Fake Runtime');
    assert.equal(initialStatus.paired, false);

    const pairResponse = await postJson(`${baseUrl}/api/pair/create`, {});
    assert.match(pairResponse.code, /^\d{6}$/);

    const confirmResponse = await postJson(`${baseUrl}/api/pair/confirm`, {
      code: pairResponse.code,
      clientLabel: 'Test Browser',
    });
    assert.ok(confirmResponse.token);

    const authedStatus = await getJson(`${baseUrl}/api/status`, confirmResponse.token);
    assert.equal(authedStatus.paired, true);
    assert.equal(authedStatus.clientLabel, 'Test Browser');

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'forward_selection_text',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example Page',
      selectionText: 'hello world',
      source: 'test',
    }, confirmResponse.token);

    assert.equal(jobResponse.ok, true);
    assert.ok(jobResponse.jobId);
    assert.equal(jobResponse.status, 'running');

    let job;
    for (let index = 0; index < 20; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'completed') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'completed');
    assert.equal(job.replyText, 'Echo: hello world');
    assert.equal(job.history.some((entry) => entry.type === 'fake_completed'), true);
  } finally {
    await httpServer.close();
    await app.stop();
  }
});

async function getJson(url, token = '') {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.json();
}

async function postJson(url, body, token = '') {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return response.json();
}


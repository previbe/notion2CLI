import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import { BridgeApp } from '../server/core/bridge-app.mjs';
import { createBridgeHttpServer } from '../server/core/http-server.mjs';

const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAvklEQVR4nO3QQREAIAzAMMC/5yFjRxMFPXpm5gZ+5wH8yliEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWMQF7RkB95SVyIgAAAAASUVORK5CYII=',
  'base64',
);

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

  async fetchPageBundle({ pageUrl, pageTitle }) {
    return [
      '<<<N2C_PAGE_BUNDLE_JSON',
      JSON.stringify({
        ok: true,
        pageUrl,
        pageTitle,
        truncated: false,
        warnings: [],
      }),
      'N2C_PAGE_BUNDLE_JSON',
      '<<<N2C_PAGE_MARKDOWN',
      `# ${pageTitle}\n\nMock body from runtime-backed provider.`,
      'N2C_PAGE_MARKDOWN',
    ].join('\n');
  }

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, { type: 'fake_dispatched' });
    if (job.action === 'write_reply_to_notion') {
      this.context.markJobWaitingForApproval(job.id, {
        type: 'fake_waiting_for_approval',
        runtimeMeta: {
          pendingApproval: {
            requestId: 'fake-approval',
            kind: 'mcp_elicitation',
            serverName: 'notion',
            mode: 'form',
            message: 'Allow Notion write?',
          },
        },
      });
      return;
    }

    this.context.markJobRunning(job.id, { type: 'fake_running' });
    setTimeout(() => {
      this.context.completeJob(job.id, `Echo: ${job.selectionText || job.pageTitle}`, {
        type: 'fake_completed',
      });
    }, 20);
  }

  async respondToApproval(jobId, resolution) {
    this.context.markJobRunning(jobId, { type: 'fake_approval_resolved' });
    setTimeout(() => {
      if (resolution.action === 'accept') {
        this.context.completeJob(jobId, 'Write completed', {
          type: 'fake_write_completed',
        });
        return;
      }

      this.context.failJob(jobId, 'Write declined', {
        type: 'fake_write_declined',
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
        pairingCommand: 'notion2cli-connect',
        launchCommand: 'npm run fake',
        statusMessage: 'fake runtime ready',
      },
      notionMcp: {
        status: 'configured',
        detail: 'fake notion mcp ready',
      },
    };
  }
}

class FakeImageBundleRuntime extends FakeRuntime {
  constructor(imageUrl) {
    super();
    this.imageUrl = imageUrl;
  }

  async fetchPageBundle({ pageUrl, pageTitle }) {
    return [
      '<<<N2C_PAGE_BUNDLE_JSON',
      JSON.stringify({
        ok: true,
        pageUrl,
        pageTitle,
        truncated: false,
        warnings: [],
      }),
      'N2C_PAGE_BUNDLE_JSON',
      '<<<N2C_PAGE_MARKDOWN',
      `# ${pageTitle}\n\n![diagram](${this.imageUrl})`,
      'N2C_PAGE_MARKDOWN',
    ].join('\n');
  }

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, { type: 'fake_dispatched' });
    this.context.markJobRunning(job.id, { type: 'fake_running' });
    setTimeout(() => {
      this.context.completeJob(job.id, `Images: ${job.inputBundle?.images.length || 0}`, {
        type: 'fake_completed',
      });
    }, 20);
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

test('bridge app can resolve an approval request through the runtime contract', async () => {
  const app = new BridgeApp({
    runtime: new FakeRuntime(),
    log: () => {},
  });
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });

  await app.start();
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const pairResponse = await postJson(`${baseUrl}/api/pair/create`, {});
    const confirmResponse = await postJson(`${baseUrl}/api/pair/confirm`, {
      code: pairResponse.code,
      clientLabel: 'Approval Browser',
    });

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'write_reply_to_notion',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example Page',
      replyTextToWrite: 'hello write-back',
      source: 'test',
    }, confirmResponse.token);

    let job = null;
    for (let index = 0; index < 20; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'waiting_for_approval') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'waiting_for_approval');
    assert.equal(job.runtimeMeta.pendingApproval.message, 'Allow Notion write?');

    const approvalResponse = await postJson(`${baseUrl}/api/jobs/${jobResponse.jobId}/approval`, {
      action: 'accept',
    }, confirmResponse.token);
    assert.equal(approvalResponse.ok, true);

    for (let index = 0; index < 20; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'completed') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'completed');
    assert.equal(job.replyText, 'Write completed');
    assert.equal(job.history.some((entry) => entry.type === 'fake_waiting_for_approval'), true);
    assert.equal(job.history.some((entry) => entry.type === 'fake_approval_resolved'), true);
  } finally {
    await httpServer.close();
    await app.stop();
  }
});

test('bridge app prefers runtime-backed page bundles for full-page artifact resolution', async () => {
  const imageServer = http.createServer((req, res) => {
    if (req.url === '/diagram.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_BUFFER);
      return;
    }

    res.writeHead(404);
    res.end('missing');
  });
  await new Promise((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
  const imageAddress = imageServer.address();
  const imageUrl = `http://127.0.0.1:${imageAddress.port}/diagram.png`;

  const app = new BridgeApp({
    runtime: new FakeImageBundleRuntime(imageUrl),
    log: () => {},
  });
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });

  await app.start();
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const pairResponse = await postJson(`${baseUrl}/api/pair/create`, {});
    const confirmResponse = await postJson(`${baseUrl}/api/pair/confirm`, {
      code: pairResponse.code,
      clientLabel: 'Bundle Browser',
    });

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'forward_full_page_via_mcp',
      pageUrl: 'https://www.notion.so/full-page',
      pageTitle: 'Bundle Page',
      source: 'test',
    }, confirmResponse.token);

    let job = null;
    for (let index = 0; index < 20; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'completed') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'completed');
    assert.equal(job.replyText, 'Images: 1');
    assert.equal(job.pageBundle.stats.imageBlockCount, 1);
    assert.equal(job.artifactSource, 'page-bundle');
    assert.equal(job.attachedImageCount, 1);
    assert.equal(job.history.some((entry) => entry.type === 'page_bundle_prepared'), true);
  } finally {
    await httpServer.close();
    await app.stop();
    imageServer.close();
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeApp } from '../server/core/bridge-app.mjs';
import { createBridgeHttpServer } from '../server/core/http-server.mjs';
import { PromptProfileStore } from '../server/core/prompt-profiles.mjs';

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

class SoftCancelRuntime extends FakeRuntime {
  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, { type: 'soft_cancel_dispatched' });
    this.context.markJobRunning(job.id, { type: 'soft_cancel_running' });
    setTimeout(() => {
      this.context.completeJob(job.id, 'Late completion should be ignored', {
        type: 'soft_cancel_late_completed',
      });
    }, 80);
  }

  async cancelJob() {
    return {
      ok: true,
      mode: 'soft',
      message: 'fake runtime keeps running',
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

class FakePageBundleApprovalRuntime extends FakeRuntime {
  constructor() {
    super();
    this.pendingFetches = new Map();
  }

  async fetchPageBundle({ jobId, pageUrl, pageTitle }) {
    return new Promise((resolve, reject) => {
      this.context.markJobWaitingForApproval(jobId, {
        type: 'fake_page_bundle_waiting_for_approval',
        runtimeMeta: {
          pendingApproval: {
            requestId: `fetch-${jobId}`,
            kind: 'mcp_auth',
            serverName: 'notion',
            mode: 'url',
            url: 'https://example.com/notion-auth',
            message: 'Authorize page fetch first',
          },
        },
      });

      this.pendingFetches.set(jobId, {
        resolve,
        reject,
        pageUrl,
        pageTitle,
      });
    });
  }

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, { type: 'fake_dispatched_after_page_bundle' });
    this.context.markJobRunning(job.id, { type: 'fake_running_after_page_bundle' });
    setTimeout(() => {
      this.context.completeJob(job.id, `Fetched page: ${job.pageTitle}`, {
        type: 'fake_completed_after_page_bundle',
      });
    }, 20);
  }

  async respondToApproval(jobId, resolution) {
    const pendingFetch = this.pendingFetches.get(jobId);
    if (pendingFetch) {
      this.pendingFetches.delete(jobId);
      this.context.markJobRunning(jobId, { type: 'fake_page_bundle_approval_resolved' });
      setTimeout(() => {
        if (resolution.action === 'accept') {
          pendingFetch.resolve([
            '<<<N2C_PAGE_BUNDLE_JSON',
            JSON.stringify({
              ok: true,
              pageUrl: pendingFetch.pageUrl,
              pageTitle: pendingFetch.pageTitle,
              truncated: false,
              warnings: [],
            }),
            'N2C_PAGE_BUNDLE_JSON',
            '<<<N2C_PAGE_MARKDOWN',
            `# ${pendingFetch.pageTitle}\n\nApproved body.`,
            'N2C_PAGE_MARKDOWN',
          ].join('\n'));
          return;
        }

        pendingFetch.reject(new Error('Fetch declined'));
      }, 20);
      return;
    }

    await super.respondToApproval(jobId, resolution);
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
    assert.match(jobResponse.status, /^(queued|dispatched|running)$/);

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

test('bridge app cancels a job and ignores late runtime completion', async () => {
  const app = new BridgeApp({
    runtime: new SoftCancelRuntime(),
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
      clientLabel: 'Test Browser',
    });

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'forward_selection_text',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example Page',
      selectionText: 'please work slowly',
      source: 'test',
    }, confirmResponse.token);
    assert.equal(jobResponse.ok, true);

    const cancelResponse = await postJson(`${baseUrl}/api/jobs/${jobResponse.jobId}/cancel`, {}, confirmResponse.token);
    assert.equal(cancelResponse.ok, true);
    assert.equal(cancelResponse.job.status, 'cancelled');
    assert.equal(cancelResponse.job.runtimeMeta.cancelMode, 'soft');

    await sleep(120);
    const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
    assert.equal(snapshot.job.status, 'cancelled');
    assert.equal(snapshot.job.replyText, '');
    assert.equal(snapshot.job.history.some((entry) => entry.type === 'ignored_soft_cancel_late_completed'), true);
  } finally {
    await httpServer.close();
    await app.stop();
  }
});

test('bridge app exposes prompt profile CRUD and stores job profile snapshots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notion2cli-bridge-prompts-'));
  const runtime = new FakeRuntime();
  let dispatchedPromptName = '';
  runtime.dispatchJob = async (job) => {
    dispatchedPromptName = job.promptProfile?.name || '';
    runtime.context.markJobDispatched(job.id, { type: 'fake_dispatched' });
    runtime.context.markJobRunning(job.id, { type: 'fake_running' });
    setTimeout(() => {
      runtime.context.completeJob(job.id, `Profile: ${job.promptProfile?.name || ''}`, {
        type: 'fake_completed',
      });
    }, 20);
  };

  const app = new BridgeApp({
    runtime,
    log: () => {},
    promptProfileStore: new PromptProfileStore({
      filePath: path.join(dir, 'prompts.json'),
    }),
  });
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });

  await app.start();
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const pairResponse = await postJson(`${baseUrl}/api/pair/create`, {});
    const confirmResponse = await postJson(`${baseUrl}/api/pair/confirm`, {
      code: pairResponse.code,
      clientLabel: 'Prompt Browser',
    });

    const initialProfiles = await getJson(`${baseUrl}/api/prompt-profiles`, confirmResponse.token);
    assert.deepEqual(initialProfiles.profiles.map((profile) => profile.id), ['raw', 'build']);

    const createResponse = await postJson(`${baseUrl}/api/prompt-profiles`, {
      name: 'Translate',
      instruction: 'Translate this input.',
    }, confirmResponse.token);
    assert.equal(createResponse.profile.name, 'Translate');

    const updateResponse = await patchJson(`${baseUrl}/api/prompt-profiles/build`, {
      name: 'Ship',
      instruction: 'Implement this input.',
    }, confirmResponse.token);
    assert.equal(updateResponse.profile.name, 'Ship');

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'forward_selection_text',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example Page',
      selectionText: 'hello world',
      promptProfileId: 'build',
      source: 'test',
    }, confirmResponse.token);

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
    assert.equal(job.promptProfile.name, 'Ship');
    assert.equal(dispatchedPromptName, 'Ship');

    const deleteResponse = await deleteJson(`${baseUrl}/api/prompt-profiles/${createResponse.profile.id}`, confirmResponse.token);
    assert.equal(deleteResponse.deleted, true);

    const resetResponse = await postJson(`${baseUrl}/api/prompt-profiles/build/reset`, {}, confirmResponse.token);
    assert.equal(resetResponse.profile.name, 'Build');
  } finally {
    await httpServer.close();
    await app.stop();
    await rm(dir, { recursive: true, force: true });
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

test('bridge app can wait for approval during runtime-backed page bundle fetch', async () => {
  const app = new BridgeApp({
    runtime: new FakePageBundleApprovalRuntime(),
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
      clientLabel: 'Page Bundle Approval Browser',
    });

    const jobResponse = await postJson(`${baseUrl}/api/jobs`, {
      action: 'forward_full_page_via_mcp',
      pageUrl: 'https://www.notion.so/page-bundle-approval',
      pageTitle: 'Approval Page',
      source: 'test',
    }, confirmResponse.token);

    let job = null;
    for (let index = 0; index < 30; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'waiting_for_approval') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'waiting_for_approval');
    assert.equal(job.runtimeMeta.pendingApproval.message, 'Authorize page fetch first');

    await postJson(`${baseUrl}/api/jobs/${jobResponse.jobId}/approval`, {
      action: 'accept',
    }, confirmResponse.token);

    for (let index = 0; index < 40; index += 1) {
      const snapshot = await getJson(`${baseUrl}/api/jobs/${jobResponse.jobId}`, confirmResponse.token);
      job = snapshot.job;
      if (job.status === 'completed') {
        break;
      }

      await sleep(20);
    }

    assert.equal(job.status, 'completed');
    assert.equal(job.replyText, 'Fetched page: Approval Page');
    assert.equal(job.history.some((entry) => entry.type === 'fake_page_bundle_waiting_for_approval'), true);
    assert.equal(job.history.some((entry) => entry.type === 'fake_page_bundle_approval_resolved'), true);
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

async function patchJson(url, body, token = '') {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return response.json();
}

async function deleteJson(url, token = '') {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return response.json();
}

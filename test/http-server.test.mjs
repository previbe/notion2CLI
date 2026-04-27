import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHttpServer } from '../server/core/http-server.mjs';

test('bridge HTTP server rejects browser requests from non-extension origins', async () => {
  let pairCreateCalls = 0;
  const app = createFakeHttpApp({
    createPairCode: async () => {
      pairCreateCalls += 1;
      return { ok: true, code: '123456' };
    },
  });
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/pair/create`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.ok, false);
    assert.equal(pairCreateCalls, 0);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await httpServer.close();
  }
});

test('bridge HTTP server allows Chrome extension origins and echoes a narrow CORS origin', async () => {
  const app = createFakeHttpApp();
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;
  const origin = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef';

  try {
    const response = await fetch(`${baseUrl}/api/status`, {
      headers: {
        Origin: origin,
      },
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('vary'), 'Origin');
  } finally {
    await httpServer.close();
  }
});

test('bridge HTTP server still allows local CLI requests without Origin', async () => {
  const app = createFakeHttpApp();
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/status`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    await httpServer.close();
  }
});

test('bridge HTTP server caps JSON request bodies', async () => {
  const app = createFakeHttpApp();
  const httpServer = createBridgeHttpServer(app, () => {}, { port: 0 });
  const address = await httpServer.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  try {
    const response = await fetch(`${baseUrl}/api/pair/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: `"${'x'.repeat(4 * 1024 * 1024 + 1)}"`,
    });
    const payload = await response.json();

    assert.equal(response.status, 413);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /JSON body exceeds/);
  } finally {
    await httpServer.close();
  }
});

function createFakeHttpApp(overrides = {}) {
  return {
    async getPublicStatus() {
      return { ok: true, bridgeRunning: true };
    },
    async createPairCode() {
      return { ok: true, code: '123456' };
    },
    confirmPairCode() {
      return { ok: true, token: 'token', clientLabel: 'Test Browser' };
    },
    ...overrides,
  };
}

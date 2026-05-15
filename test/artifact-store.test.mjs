import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { ArtifactStore } from '../server/core/artifact-store.mjs';
import { parseClaudeJsonOutput } from '../server/runtimes/claude-cli-session.mjs';

const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAvklEQVR4nO3QQREAIAzAMMC/5yFjRxMFPXpm5gZ+5wH8yliEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWIRYhFiEWMQF7RkB95SVyIgAAAAASUVORK5CYII=',
  'base64',
);
const SVG_BUFFER = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#D87620"><path d="M17.5 10.625h-2.187v6.25h-3.75v-5H8.437v5h-3.75v-6.25H2.5v-1.25l7.5-7.5 2.813 2.813V2.5h2.5v4.688L17.5 9.375z" fill="#D87620"></path></svg>',
  'utf8',
);

test('artifact store downloads remote page images into local cache', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/image.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_BUFFER);
      return;
    }

    res.writeHead(404);
    res.end('missing');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const imageUrl = `http://127.0.0.1:${address.port}/image.png`;
  const rootDir = path.join(os.tmpdir(), `n2c-artifacts-${Date.now()}`);
  const store = new ArtifactStore({ rootDir, log: () => {}, allowPrivateNetworkUrls: true });

  try {
    const result = await store.prepareArtifacts('job-1', {
      images: [
        { sourceUrl: imageUrl, width: 120, height: 60, alt: 'diagram' },
      ],
    });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].mimeType, 'image/png');
    assert.equal(result.images[0].width, 120);
    assert.equal(result.images[0].height, 60);
    assert.match(result.images[0].cachePath, /job-1/);
    assert.equal(result.warnings.length, 0);
  } finally {
    server.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('artifact store sniffs octet-stream SVGs and writes .svg artifacts', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/image') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(SVG_BUFFER);
      return;
    }

    res.writeHead(404);
    res.end('missing');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const imageUrl = `http://127.0.0.1:${address.port}/image`;
  const rootDir = path.join(os.tmpdir(), `n2c-artifacts-svg-${Date.now()}`);
  const store = new ArtifactStore({ rootDir, log: () => {}, allowPrivateNetworkUrls: true });

  try {
    const result = await store.prepareArtifacts('job-svg', {
      images: [
        { sourceUrl: imageUrl, width: 128, height: 128, alt: 'icon' },
      ],
    });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].mimeType, 'image/svg+xml');
    assert.match(result.images[0].cachePath, /job-svg/);
    assert.match(result.images[0].cachePath, /\.svg$/);
    assert.equal(result.warnings.length, 0);
  } finally {
    server.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('artifact store sends per-image headers to the source origin only', async () => {
  const seenHeaders = [];
  const server = http.createServer((req, res) => {
    seenHeaders.push(req.headers.authorization || '');
    if (req.url === '/image.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG_BUFFER);
      return;
    }

    res.writeHead(404);
    res.end('missing');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const imageUrl = `http://127.0.0.1:${address.port}/image.png`;
  const rootDir = path.join(os.tmpdir(), `n2c-artifacts-headers-${Date.now()}`);
  const store = new ArtifactStore({ rootDir, log: () => {}, allowPrivateNetworkUrls: true });

  try {
    const result = await store.prepareArtifacts('job-headers', {
      images: [
        {
          sourceUrl: imageUrl,
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      ],
    });
    assert.equal(result.images.length, 1);
    assert.deepEqual(seenHeaders, ['Bearer test-token']);
  } finally {
    server.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('artifact store accepts provider-prepared local image artifacts', async () => {
  const rootDir = path.join(os.tmpdir(), `n2c-artifacts-local-${Date.now()}`);
  const localDir = path.join(rootDir, 'job-local');
  const localPath = path.join(localDir, 'image.png');
  const store = new ArtifactStore({ rootDir, log: () => {} });

  try {
    await mkdir(localDir, { recursive: true });
    await writeFile(localPath, PNG_BUFFER);
    const result = await store.prepareArtifacts('job-local', {
      images: [
        {
          sourceUrl: 'lark-media:img-token',
          cachePath: localPath,
          alt: 'diagram',
        },
      ],
    });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].cachePath, localPath);
    assert.equal(result.images[0].mimeType, 'image/png');
    assert.equal(result.images[0].sourceUrl, 'lark-media:img-token');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('artifact store blocks private network image URLs by default', async () => {
  const rootDir = path.join(os.tmpdir(), `n2c-artifacts-private-${Date.now()}`);
  const store = new ArtifactStore({ rootDir, log: () => {} });

  try {
    const result = await store.prepareArtifacts('job-private', {
      images: [
        { sourceUrl: 'http://127.0.0.1:43821/private.png' },
      ],
    });

    assert.equal(result.images.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /local\/private image URLs are not allowed/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('parseClaudeJsonOutput extracts the final result payload', () => {
  const parsed = parseClaudeJsonOutput(`
{"type":"meta","foo":1}
{"type":"result","is_error":false,"result":"DONE","session_id":"abc"}
  `);

  assert.deepEqual(parsed, {
    ok: true,
    result: 'DONE',
    error: '',
    sessionId: 'abc',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { LarkDocumentProvider, markdownToDocxBlocks } from '../server/providers/lark-provider.mjs';
import { LarkCliAdapter, extractVerificationUrl, parseLarkCliJson } from '../server/providers/lark/lark-cli-adapter.mjs';
import {
  extractLarkMarkdownImageAssets,
  locateUniqueMarkdownSelection,
  resolveLarkDocumentReference,
} from '../server/providers/lark/lark-document-parser.mjs';

test('resolveLarkDocumentReference supports docx and wiki URLs', () => {
  assert.deepEqual(resolveLarkDocumentReference('https://example.feishu.cn/docx/abc123?from=copy'), {
    providerId: 'lark',
    kind: 'docx',
    token: 'abc123',
    pageUrl: 'https://example.feishu.cn/docx/abc123?from=copy',
  });

  assert.deepEqual(resolveLarkDocumentReference('https://example.larksuite.com/wiki/wikcnToken'), {
    providerId: 'lark',
    kind: 'wiki',
    token: 'wikcnToken',
    pageUrl: 'https://example.larksuite.com/wiki/wikcnToken',
  });

  assert.equal(resolveLarkDocumentReference('https://www.notion.so/page'), null);
});

test('extractLarkMarkdownImageAssets handles direct URLs and media tokens', () => {
  const assets = extractLarkMarkdownImageAssets([
    '# Doc',
    '![diagram](lark-media:img-token)',
    '<img token="boxcnToken" alt="screenshot" width="640" height="360"/>',
    '![remote](https://example.com/remote.png)',
  ].join('\n'));

  assert.deepEqual(assets, [
    {
      sourceUrl: '',
      token: 'img-token',
      caption: 'diagram',
      width: null,
      height: null,
    },
    {
      sourceUrl: '',
      token: 'boxcnToken',
      caption: 'screenshot',
      width: 640,
      height: 360,
    },
    {
      sourceUrl: 'https://example.com/remote.png',
      token: '',
      caption: 'remote',
      width: null,
      height: null,
    },
  ]);
});

test('locateUniqueMarkdownSelection fails safely on ambiguous matches', () => {
  assert.equal(locateUniqueMarkdownSelection({
    markdown: 'replace me\n\nreplace me',
    selectionText: 'replace me',
  }).ok, false);

  const unique = locateUniqueMarkdownSelection({
    markdown: 'alpha beta gamma',
    selectionText: 'beta',
  });
  assert.equal(unique.ok, true);
  assert.equal(unique.index, 6);
});

test('lark-cli output helpers parse JSON and authorization URLs', () => {
  assert.deepEqual(parseLarkCliJson('notice\n{"ok":true,"value":1}\n'), {
    ok: true,
    value: 1,
  });
  assert.equal(
    extractVerificationUrl('Open: https://open.feishu.cn/page/cli?user_code=ABC&from=cli.'),
    'https://open.feishu.cn/page/cli?user_code=ABC&from=cli',
  );
});

test('LarkCliAdapter uses explicit OpenAPI calls for docx writes', async () => {
  const fake = createFakeSpawn({ stdout: '{"ok":true}' });
  const adapter = new LarkCliAdapter({
    command: 'lark-cli',
    baseArgs: [],
    spawnImpl: fake.spawn,
  });

  await adapter.createDocumentChildren('doc1', 'doc1', {
    index: -1,
    children: markdownToDocxBlocks('hello'),
  });

  const call = fake.calls[0];
  assert.deepEqual(call.args.slice(0, 3), ['api', 'POST', '/open-apis/docx/v1/documents/doc1/blocks/doc1/children']);
  assert.equal(call.args.includes('--format'), true);
  assert.equal(call.args.includes('--data'), true);
  const data = JSON.parse(call.args[call.args.indexOf('--data') + 1]);
  assert.equal(data.index, -1);
  assert.equal(data.children[0].text.elements[0].text_run.content, 'hello');
});

test('LarkCliAdapter uses supported docs +media-download flags', async () => {
  const fake = createFakeSpawn({ stdout: '{"saved_path":"/tmp/media.png"}' });
  const adapter = new LarkCliAdapter({
    command: 'lark-cli',
    baseArgs: [],
    spawnImpl: fake.spawn,
  });

  const result = await adapter.downloadMedia({
    token: 'media-token',
    outputPath: '/tmp/media',
  });

  const call = fake.calls[0];
  assert.deepEqual(call.args.slice(0, 2), ['docs', '+media-download']);
  assert.equal(call.args.includes('--format'), false);
  assert.equal(call.args.includes('--token'), true);
  assert.equal(call.args[call.args.indexOf('--token') + 1], 'media-token');
  assert.equal(result.saved_path, '/tmp/media.png');
});

test('LarkDocumentProvider fetches docx raw content and resolves media through explicit APIs', async () => {
  const calls = [];
  const cacheDir = path.join(os.tmpdir(), `n2c-lark-test-${Date.now()}`);
  const adapter = {
    async getDocumentRawContent(documentId) {
      calls.push({ method: 'raw', documentId });
      return {
        data: {
          content: '# Doc\n\nBody',
          revision_id: 7,
        },
      };
    },
    async getDocument(documentId) {
      calls.push({ method: 'doc', documentId });
      return {
        data: {
          document: {
            title: 'Doc',
          },
        },
      };
    },
    async listDocumentBlocks(documentId) {
      calls.push({ method: 'blocks', documentId });
      return {
        data: {
          items: [
            {
              block_id: 'img-block',
              block_type: 27,
              image: {
                token: 'img1',
              },
            },
          ],
        },
      };
    },
    async downloadMedia({ token, outputPath }) {
      calls.push({ method: 'download', token, outputPath });
      return {
        saved_path: `${outputPath}.png`,
      };
    },
  };
  const provider = new LarkDocumentProvider({
    adapter,
    authService: { async ensureReady() {}, async getStatus() { return { status: 'configured' }; } },
    artifactStore: { resolveJobCacheDir: () => cacheDir },
    log: () => {},
  });

  const result = await provider.fetchPageBundle({
    id: 'job1',
    pageUrl: 'https://example.feishu.cn/docx/doc1',
    pageTitle: 'Fallback',
  });

  assert.equal(result.bundle.providerId, 'lark');
  assert.equal(result.bundle.pageTitle, 'Doc');
  assert.equal(result.bundle.revision, '7');
  assert.equal(result.bundle.assets.images[0].cachePath, path.join(cacheDir, 'lark-media-01.png'));
  assert.deepEqual(calls.map((call) => call.method), ['raw', 'doc', 'blocks', 'download']);
});

test('LarkDocumentProvider resolves wiki nodes before appending through docx block API', async () => {
  const calls = [];
  const adapter = {
    async getWikiNode(token) {
      calls.push({ method: 'wiki', token });
      return {
        data: {
          node: {
            obj_type: 'docx',
            obj_token: 'doc1',
            node_token: token,
            title: 'Wiki Doc',
          },
        },
      };
    },
    async createDocumentChildren(documentId, blockId, request) {
      calls.push({ method: 'create', documentId, blockId, request });
      return { ok: true };
    },
  };
  const provider = new LarkDocumentProvider({
    adapter,
    authService: { async ensureReady() {}, async getStatus() { return { status: 'configured' }; } },
    log: () => {},
  });

  const result = await provider.writeBack({
    action: 'write_reply_to_notion',
    pageUrl: 'https://example.feishu.cn/wiki/wiki1',
    pageTitle: 'Doc',
    selectionText: '',
    selectionContext: null,
    replyTextToWrite: 'hello',
    writeMode: 'append_markdown_section',
    writeSectionTitle: 'notion2CLI',
  });

  assert.equal(result.handled, true);
  assert.deepEqual(calls.map((call) => call.method), ['wiki', 'create']);
  const create = calls.find((call) => call.method === 'create');
  assert.equal(create.documentId, 'doc1');
  assert.equal(create.blockId, 'doc1');
  assert.equal(create.request.children[0].heading2.elements[0].text_run.content, 'notion2CLI');
});

test('LarkDocumentProvider replaces a unique selection through docx block patch', async () => {
  const calls = [];
  const adapter = {
    async listDocumentBlocks(documentId) {
      calls.push({ method: 'blocks', documentId });
      return {
        data: {
          items: [
            {
              block_id: 'block1',
              block_type: 2,
              text: {
                elements: [
                  {
                    text_run: {
                      content: 'alpha beta gamma',
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    },
    async patchDocumentBlock(documentId, blockId, blockPatch) {
      calls.push({ method: 'patch', documentId, blockId, blockPatch });
      return { ok: true };
    },
  };
  const provider = new LarkDocumentProvider({
    adapter,
    authService: { async ensureReady() {}, async getStatus() { return { status: 'configured' }; } },
    log: () => {},
  });

  const result = await provider.writeBack({
    action: 'write_reply_to_notion',
    pageUrl: 'https://example.feishu.cn/docx/doc1',
    pageTitle: 'Doc',
    selectionText: 'beta',
    selectionContext: null,
    replyTextToWrite: 'BETA',
    writeMode: 'update_content',
  });

  assert.equal(result.handled, true);
  const patch = calls.find((call) => call.method === 'patch');
  assert.equal(patch.documentId, 'doc1');
  assert.equal(patch.blockId, 'block1');
  assert.equal(patch.blockPatch.text.elements[0].text_run.content, 'alpha BETA gamma');
});

function createFakeSpawn({ stdout = '{}', stderr = '', exitCode = 0 } = {}) {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      const call = {
        command,
        args: args.map(String),
        options,
        input: '',
      };
      calls.push(call);
      child.stdin.on('data', (chunk) => {
        call.input += Buffer.from(chunk).toString('utf8');
      });
      process.nextTick(() => {
        if (stdout) {
          child.stdout.write(stdout);
        }
        if (stderr) {
          child.stderr.write(stderr);
        }
        child.stdout.end();
        child.stderr.end();
        child.emit('close', exitCode, '');
      });
      return child;
    },
  };
}

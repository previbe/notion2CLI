import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeMcpList, parseClaudeSessionInitNotionStatus } from '../server/runtimes/claude-runtime.mjs';
import { buildClaudePrompt } from '../server/core/codex-prompt.mjs';
import { buildCodexAppServerArgs, parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { buildCodexInputItems } from '../server/runtimes/codex-app-server-session.mjs';
import { buildCodexAppServerWsArgs, buildCodexThreadName } from '../server/runtimes/codex-live-session.mjs';
import { parseJobRequest } from '../server/core/schemas.mjs';

test('codex app-server args keep stdio transport and optional profile overrides', () => {
  const args = buildCodexAppServerArgs({
    profile: 'default',
    extraArgs: ['--enable', 'foo'],
  });

  assert.deepEqual(args, [
    'app-server',
    '--listen',
    'stdio://',
    '-c',
    'profile="default"',
    '--enable',
    'foo',
  ]);
});

test('codex live session args keep websocket transport and optional profile overrides', () => {
  const args = buildCodexAppServerWsArgs({
    listenUrl: 'ws://127.0.0.1:45678',
    profile: 'default',
    extraArgs: ['--enable', 'foo'],
  });

  assert.deepEqual(args, [
    'app-server',
    '--listen',
    'ws://127.0.0.1:45678',
    '-c',
    'profile="default"',
    '--enable',
    'foo',
  ]);
});

test('codex live session uses a stable user-facing thread name', () => {
  assert.equal(
    buildCodexThreadName('/Users/morrow/coding/notion2CLI'),
    'notion2CLI - notion2CLI',
  );
});

test('parseNotionMcpList detects configured and unauthenticated codex MCP states', () => {
  assert.deepEqual(
    parseNotionMcpList(`
Name        Url                        Bearer Token Env Var   Status   Auth
notion      https://mcp.notion.com/mcp -                      enabled  OAuth
    `),
    {
      status: 'configured',
      detail: '检测到 Codex CLI 已配置并可使用 Notion MCP。',
    },
  );

  assert.deepEqual(
    parseNotionMcpList(`
Name        Url                        Bearer Token Env Var   Status   Auth
notion      https://mcp.notion.com/mcp -                      enabled  Not logged in
    `),
    {
      status: 'unauthenticated',
      detail: '已检测到 Codex CLI 的 Notion MCP 配置，但当前还没有完成登录授权。',
    },
  );
});

test('job schema enforces action-specific required fields', () => {
  assert.throws(() => {
    parseJobRequest({
      action: 'forward_selection_text',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example',
      selectionText: '',
    });
  }, /selectionText is required/);

  const payload = parseJobRequest({
    action: 'write_reply_to_notion',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    replyTextToWrite: 'hello',
  });

  assert.equal(payload.writeSectionTitle, 'notion2CLI');
  assert.equal(payload.writeMode, 'append_markdown_section');

  const updatePayload = parseJobRequest({
    action: 'write_reply_to_notion',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    replyTextToWrite: 'hello',
    writeMode: 'update_content',
    selectionText: 'old text',
  });

  assert.equal(updatePayload.writeMode, 'update_content');

  assert.throws(() => {
    parseJobRequest({
      action: 'write_reply_to_notion',
      pageUrl: 'https://www.notion.so/example',
      pageTitle: 'Example',
      replyTextToWrite: 'hello',
      writeMode: 'update_content',
      selectionText: '',
    });
  }, /selectionText is required for update_content/);
});

test('codex input items prepend local images before prompt text', () => {
  const items = buildCodexInputItems({
    prompt: 'hello',
    images: [
      { cachePath: '/tmp/a.png' },
      { cachePath: '/tmp/b.png' },
    ],
  });

  assert.deepEqual(items, [
    { type: 'localImage', path: '/tmp/a.png' },
    { type: 'localImage', path: '/tmp/b.png' },
    { type: 'text', text: 'hello', text_elements: [] },
  ]);
});

test('parseClaudeMcpList detects configured and unauthenticated claude MCP states', () => {
  assert.deepEqual(
    parseClaudeMcpList(`
Checking MCP server health…

notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected
    `),
    {
      status: 'configured',
      detail: '检测到 Claude Code 已配置并可使用 Notion MCP。',
    },
  );

  assert.deepEqual(
    parseClaudeMcpList(`
Checking MCP server health…

notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication
    `),
    {
      status: 'unauthenticated',
      detail: '已检测到 Claude Code 的 Notion MCP 配置，但当前还没有完成授权。',
    },
  );
});

test('parseClaudeSessionInitNotionStatus uses the runtime session view of Claude MCP state', () => {
  assert.deepEqual(
    parseClaudeSessionInitNotionStatus({
      mcp_servers: [
        { name: 'notion', status: 'connected' },
      ],
    }),
    {
      status: 'configured',
      detail: '检测到 Claude Code 已配置并可使用 Notion MCP。',
    },
  );

  assert.deepEqual(
    parseClaudeSessionInitNotionStatus({
      mcp_servers: [
        { name: 'notion', status: 'needs-auth' },
      ],
    }),
    {
      status: 'unauthenticated',
      detail: 'Claude Code 运行时仍需要先完成一次 Notion 浏览器授权。',
    },
  );
});

test('claude write-back prompt uses the shared structured action rules', () => {
  const prompt = buildClaudePrompt({
    action: 'write_reply_to_notion',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    selectionText: '',
    replyTextToWrite: 'hello',
    writeMode: 'append_markdown_section',
    writeSectionTitle: 'notion2CLI',
    sourceReplyJobId: 'job-123',
    installPrompt: '',
    officialDocUrl: '',
    source: 'test',
    createdAt: '2026-04-20T00:00:00.000Z',
    inputBundle: {
      images: [],
      warnings: [],
      artifactSource: 'none',
      pageBundle: null,
    },
  }, {
    notionMcpHint: 'Use the configured Notion MCP tools when the action requires full-page reading or write-back.',
  });

  assert.match(prompt, /You are handling a notion2cli browser action for the local Claude Code runtime\./);
  assert.match(prompt, /If action is "write_reply_to_notion", first resolve the target page from pageUrl using Notion MCP/);
  assert.match(prompt, /For "write_reply_to_notion" with writeMode "append_markdown_section", append replyTextToWrite/);
  assert.match(prompt, /"writeSectionTitle": "notion2CLI"/);
  assert.match(prompt, /Return only the final user-facing reply text\./);
});

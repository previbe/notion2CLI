import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeMcpList, parseClaudeSessionInitNotionStatus } from '../server/runtimes/claude-runtime.mjs';
import { buildClaudeChannelPrompt, buildClaudePrompt } from '../server/core/codex-prompt.mjs';
import { buildClaudeChannelName } from '../server/runtimes/claude-channel-runtime.mjs';
import { buildCodexAppServerArgs, parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { buildCodexInputItems } from '../server/runtimes/codex-app-server-session.mjs';
import { CodexLiveSession, buildCodexAppServerWsArgs, buildCodexThreadName } from '../server/runtimes/codex-live-session.mjs';
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
    buildCodexThreadName('/workspace/notion2CLI'),
    'notion2CLI - notion2CLI',
  );
});

test('codex live session interrupts an active turn when cancelled', async () => {
  const calls = [];
  const session = new CodexLiveSession({
    cwd: '/tmp/notion2cli',
    log: () => {},
  });
  session.threadId = 'thread-1';
  session.activeTask = {
    jobId: 'job-1',
    turnId: 'turn-1',
  };
  session.request = async (method, params) => {
    calls.push({ method, params });
    return {};
  };

  const result = await session.cancelTurn('job-1');

  assert.equal(result.mode, 'hard');
  assert.equal(session.activeTask.cancelled, true);
  assert.deepEqual(calls, [
    {
      method: 'turn/interrupt',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    },
  ]);
});

test('codex live session auto-cancels approval requests after cancellation', async () => {
  const sent = [];
  let approvalRequests = 0;
  const session = new CodexLiveSession({
    cwd: '/tmp/notion2cli',
    log: () => {},
  });
  session.threadId = 'thread-1';
  session.activeTask = {
    jobId: 'job-1',
    turnId: 'turn-1',
    cancelled: true,
    onApprovalRequested: () => {
      approvalRequests += 1;
    },
  };
  session.send = (message) => {
    sent.push(message);
  };

  await session.handleServerRequest({
    jsonrpc: '2.0',
    id: 9,
    method: 'mcpServer/elicitation/request',
    params: {
      message: 'Allow the notion MCP server to run tool "notion-update-page"?',
    },
  });

  assert.equal(approvalRequests, 0);
  assert.equal(session.pendingApproval, null);
  assert.deepEqual(sent, [
    {
      jsonrpc: '2.0',
      id: 9,
      result: {
        action: 'cancel',
        content: null,
        _meta: null,
      },
    },
  ]);
});

test('codex live session fails queued turns when the websocket disconnects', () => {
  const failures = [];
  const session = new CodexLiveSession({
    cwd: '/tmp/notion2cli',
    log: () => {},
  });
  session.connected = true;
  session.threadId = 'thread-1';
  session.activeTask = {
    jobId: 'active-job',
    turnId: 'turn-1',
    onFailed: (message, meta) => failures.push({ jobId: 'active-job', message, meta }),
  };
  session.turnQueue.push({
    jobId: 'queued-job',
    onFailed: (message, meta) => failures.push({ jobId: 'queued-job', message, meta }),
  });

  session.handleConnectionFailure('socket closed');

  assert.equal(session.connected, false);
  assert.equal(session.activeTask, null);
  assert.equal(session.turnQueue.length, 0);
  assert.deepEqual(failures, [
    {
      jobId: 'active-job',
      message: 'socket closed',
      meta: {
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    },
    {
      jobId: 'queued-job',
      message: 'socket closed',
      meta: {
        threadId: 'thread-1',
        turnId: null,
      },
    },
  ]);
});

test('claude channel uses a stable user-facing session name', () => {
  assert.equal(
    buildClaudeChannelName('/workspace/notion2CLI'),
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
      detail: 'Codex CLI is configured and can use Notion MCP.',
    },
  );

  assert.deepEqual(
    parseNotionMcpList(`
Name        Url                        Bearer Token Env Var   Status   Auth
notion      https://mcp.notion.com/mcp -                      enabled  Not logged in
    `),
    {
      status: 'unauthenticated',
      detail: 'Codex CLI Notion MCP configuration was detected, but login authorization is not complete.',
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
  assert.equal(payload.promptProfileId, 'raw');
  assert.equal(Object.hasOwn(payload, 'promptProfile'), false);

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

test('job schema normalizes prompt profile ids without resolving storage', () => {
  const buildPayload = parseJobRequest({
    action: 'forward_full_page_via_mcp',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    promptProfileId: 'Build',
  });

  assert.equal(buildPayload.promptProfileId, 'build');

  const customPayload = parseJobRequest({
    action: 'forward_full_page_via_mcp',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    promptProfileId: 'CUSTOM-123',
  });

  assert.equal(customPayload.promptProfileId, 'custom-123');
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
Checking MCP server health...

notion: https://mcp.notion.com/mcp (HTTP) - ✓ Connected
    `),
    {
      status: 'configured',
      detail: 'Claude Code is configured and can use Notion MCP.',
    },
  );

  assert.deepEqual(
    parseClaudeMcpList(`
Checking MCP server health...

notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication
    `),
    {
      status: 'unauthenticated',
      detail: 'Claude Code Notion MCP configuration was detected, but authorization is not complete.',
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
      detail: 'Claude Code is configured and can use Notion MCP.',
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
      detail: 'Claude Code runtime still needs one Notion browser authorization.',
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
    promptProfileId: 'raw',
    promptProfile: {
      id: 'raw',
      name: 'Raw',
      instruction: '',
    },
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
  assert.match(prompt, /Resolve the target page from pageUrl using Notion MCP before writing/);
  assert.match(prompt, /writeMode=append_markdown_section: append replyTextToWrite/);
  assert.match(prompt, /"writeSectionTitle":"notion2CLI"/);
  assert.match(prompt, /Profile: raw \(Raw\)\./);
  assert.match(prompt, /Return only final Brief text\./);
  assert.doesNotMatch(prompt, /action=forward_selection_text/);
  assert.doesNotMatch(prompt, /action=forward_full_page_via_mcp/);
  assert.doesNotMatch(prompt, /install_notion_mcp/);
});

test('claude channel prompt asks the session to reply through the browser tool', () => {
  const prompt = buildClaudeChannelPrompt({
    id: 'job-456',
    action: 'forward_selection_text',
    pageUrl: 'https://www.notion.so/example',
    pageTitle: 'Example',
    selectionText: 'Reply only OK',
    replyTextToWrite: '',
    writeMode: 'append_markdown_section',
    writeSectionTitle: 'notion2CLI',
    sourceReplyJobId: '',
    installPrompt: '',
    officialDocUrl: '',
    promptProfileId: 'raw',
    promptProfile: {
      id: 'raw',
      name: 'Raw',
      instruction: '',
    },
    source: 'test',
    createdAt: '2026-04-20T00:00:00.000Z',
    inputBundle: {
      images: [],
      warnings: [],
      artifactSource: 'none',
      pageBundle: null,
    },
  }, {
    notionMcpHint: 'Use the configured Notion MCP tools when the action requires write-back.',
  });

  assert.match(prompt, /the active Claude Code channel session/);
  assert.match(prompt, /Reply tool: call "reply" exactly once/);
  assert.match(prompt, /call "reply" exactly once with chat_id "job-456"/);
  assert.match(prompt, /"jobId":"job-456"/);
  assert.match(prompt, /action=forward_selection_text: selectionText is authoritative/);
  assert.match(prompt, /Return only final Brief text\./);
  assert.doesNotMatch(prompt, /replyTextToWrite/);
  assert.doesNotMatch(prompt, /writeMode=/);
  assert.doesNotMatch(prompt, /install_notion_mcp/);
  assert.doesNotMatch(prompt, /PageBundle markdown/);
});

test('Build prompt profile is injected as task intent', () => {
  const prompt = buildClaudeChannelPrompt({
    id: 'job-build',
    action: 'forward_full_page_via_mcp',
    pageUrl: 'https://www.notion.so/build-page',
    pageTitle: 'Build Page',
    selectionText: '',
    replyTextToWrite: '',
    writeMode: 'append_markdown_section',
    writeSectionTitle: 'notion2CLI',
    sourceReplyJobId: '',
    installPrompt: '',
    officialDocUrl: '',
    promptProfileId: 'build',
    promptProfile: {
      id: 'build',
      name: 'Build',
      instruction: 'Turn the requirements in the input document into concrete changes in the current codebase, then finish with a Brief.',
    },
    source: 'test',
    createdAt: '2026-04-20T00:00:00.000Z',
    inputBundle: {
      images: [],
      warnings: [],
      artifactSource: 'none',
      pageBundle: {
        provider: 'test',
        runtimeId: 'test',
        truncated: false,
        warnings: [],
        stats: {},
        markdown: '# Build Page\n\nImplement a feature.',
      },
    },
  }, {
    notionMcpHint: 'Use the configured Notion MCP tools when the action requires write-back.',
  });

  assert.match(prompt, /Profile: build \(Build\)\. Instruction:/);
  assert.match(prompt, /<<<N2C_PROMPT_PROFILE_INSTRUCTION/);
  assert.match(prompt, /Turn the requirements in the input document into concrete changes/);
  assert.match(prompt, /promptProfile\.id is not "raw": use the prompt profile instruction as the task intent/);
  assert.match(prompt, /"promptProfile":\{"id":"build","name":"Build"\}/);
  assert.match(prompt, /<<<N2C_PAGE_BUNDLE_MARKDOWN/);
  assert.doesNotMatch(prompt, /replyTextToWrite/);
  assert.doesNotMatch(prompt, /writeMode=/);
  assert.doesNotMatch(prompt, /install_notion_mcp/);
});

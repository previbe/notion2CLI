import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaudeRuntime, parseClaudeMcpList } from '../server/runtimes/claude-runtime.mjs';
import { buildClaudeChannelPrompt, buildClaudePrompt } from '../server/core/codex-prompt.mjs';
import { buildClaudeChannelName } from '../server/runtimes/claude-channel-runtime.mjs';
import { buildCodexAppServerArgs, parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { buildCodexInputItems } from '../server/runtimes/codex-app-server-session.mjs';
import {
  CodexLiveSession,
  buildCodexAppServerWsArgs,
  buildCodexThreadName,
  shouldStartFreshThreadForPermissionMode,
} from '../server/runtimes/codex-live-session.mjs';
import {
  buildClaudeLaunchCommand,
  buildClaudePermissionArgs,
  buildCodexAuxiliaryThreadPermissionParams,
  buildCodexLaunchCommand,
  buildCodexThreadPermissionParams,
  buildCodexTurnPermissionParams,
  inferClaudePermissionModeFromArgs,
  normalizePermissionMode,
} from '../server/core/permission-mode.mjs';
import { parseJobRequest } from '../server/core/schemas.mjs';

function setupFakeClaude(scriptLines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'claude-runtime-'));
  const binDir = path.join(dir, 'bin');
  const claudePath = path.join(binDir, 'claude');
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  mkdirSync(binDir, { recursive: true });
  writeFileSync(claudePath, [...scriptLines, ''].join('\n'));
  chmodSync(claudePath, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
  process.env.HOME = dir;

  return {
    dir,
    cleanup() {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

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

test('permission mode helpers map startup modes to runtime settings', () => {
  assert.equal(normalizePermissionMode('auto'), 'auto-review');
  assert.equal(buildCodexLaunchCommand('default'), 'notion2cli daemon start --runtime codex');
  assert.equal(
    buildCodexLaunchCommand('full-access'),
    'notion2cli daemon start --runtime codex --permission-mode full-access',
  );
  assert.equal(
    buildClaudeLaunchCommand('auto-review'),
    'notion2cli claude launch --permission-mode auto-review',
  );
  assert.deepEqual(buildCodexThreadPermissionParams('auto-review'), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'workspace-write',
  });
  assert.deepEqual(buildCodexAuxiliaryThreadPermissionParams('auto-review'), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'auto_review',
    sandbox: 'read-only',
  });
  assert.deepEqual(buildCodexTurnPermissionParams('full-access'), {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
  });
  assert.deepEqual(buildClaudePermissionArgs('full-access'), ['--dangerously-skip-permissions']);
});

test('claude passthrough permission flags infer the status mode', () => {
  assert.equal(inferClaudePermissionModeFromArgs(['--permission-mode', 'auto']), 'auto-review');
  assert.equal(inferClaudePermissionModeFromArgs(['--permission-mode=bypassPermissions']), 'full-access');
  assert.equal(inferClaudePermissionModeFromArgs(['--dangerously-skip-permissions']), 'full-access');
  assert.equal(inferClaudePermissionModeFromArgs([], 'auto'), 'auto-review');
});

test('codex live session detects persisted permission mode changes', () => {
  assert.equal(
    shouldStartFreshThreadForPermissionMode({ threadId: 'thread-1', permissionMode: 'default' }, 'full-access'),
    true,
  );
  assert.equal(
    shouldStartFreshThreadForPermissionMode({ threadId: 'thread-1', permissionMode: 'full-access' }, 'danger'),
    false,
  );
  assert.equal(shouldStartFreshThreadForPermissionMode(null, 'full-access'), false);
});

test('codex live session starts fresh instead of resuming when permission mode changes', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'notion2cli-home-'));
  const cwd = mkdtempSync(path.join(tmpdir(), 'notion2cli-cwd-'));
  const originalHome = process.env.NOTION2CLI_HOME;
  const calls = [];
  const logs = [];
  process.env.NOTION2CLI_HOME = home;
  mkdirSync(path.join(home, 'state'), { recursive: true });
  writeFileSync(path.join(home, 'state', 'codex-session.json'), JSON.stringify({
    cwd,
    threadId: 'thread-old',
    permissionMode: 'default',
  }));

  const session = new CodexLiveSession({
    cwd,
    permissionMode: 'full-access',
    log: (message, meta) => logs.push({ message, meta }),
  });
  session.request = async (method, params) => {
    calls.push({ method, params });
    throw new Error(`unexpected request: ${method}`);
  };
  session.startFreshThread = async () => {
    calls.push({ method: 'startFreshThread' });
    session.threadId = 'thread-new';
  };

  try {
    await session.resumeOrStartThread();

    assert.deepEqual(calls, [{ method: 'startFreshThread' }]);
    assert.equal(session.threadId, 'thread-new');
    assert.equal(logs[0]?.message, 'codex live session permission mode changed, starting a fresh thread');
  } finally {
    if (originalHome === undefined) {
      delete process.env.NOTION2CLI_HOME;
    } else {
      process.env.NOTION2CLI_HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('codex live session persists permission mode in the local snapshot', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'notion2cli-home-'));
  const originalHome = process.env.NOTION2CLI_HOME;
  process.env.NOTION2CLI_HOME = home;

  const session = new CodexLiveSession({
    cwd: '/tmp/notion2cli',
    permissionMode: 'full-access',
    log: () => {},
  });
  session.threadId = 'thread-1';

  try {
    await session.persistSnapshot();
    const raw = readFileSync(path.join(home, 'state', 'codex-session.json'), 'utf8');
    assert.equal(JSON.parse(raw).permissionMode, 'full-access');
  } finally {
    if (originalHome === undefined) {
      delete process.env.NOTION2CLI_HOME;
    } else {
      process.env.NOTION2CLI_HOME = originalHome;
    }
    rmSync(home, { recursive: true, force: true });
  }
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

test('ClaudeRuntime reports unknown when claude mcp list exits non-zero', async () => {
  const fakeClaude = setupFakeClaude([
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    '  echo "Claude fake 1.0.0"',
    '  exit 0',
    'fi',
    'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
    '  echo "failed to read Claude MCP config" >&2',
    '  exit 2',
    'fi',
    'exit 99',
  ]);

  const runtime = new ClaudeRuntime(() => {}, { cwd: fakeClaude.dir });
  try {
    await runtime.start({});
    const status = await runtime.getNotionMcpStatus();

    assert.equal(status.status, 'unknown');
    assert.match(status.detail, /failed to read Claude MCP config/);
  } finally {
    await runtime.stop();
    fakeClaude.cleanup();
  }
});

test('ClaudeRuntime reports unknown without creating watcher when claude is unavailable', async () => {
  const fakeClaude = setupFakeClaude([
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    '  echo "Claude fake is unavailable" >&2',
    '  exit 2',
    'fi',
    'exit 99',
  ]);

  const runtime = new ClaudeRuntime(() => {}, { cwd: fakeClaude.dir });
  try {
    await runtime.start({});
    const status = await runtime.getNotionMcpStatus();

    assert.equal(runtime.ready, false);
    assert.equal(runtime.mcpConfigWatcher, null);
    assert.equal(status.status, 'unknown');
    assert.match(status.detail, /Claude fake is unavailable/);
  } finally {
    await runtime.stop();
    fakeClaude.cleanup();
  }
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

test('PreVibe prompt profile is injected as task intent', () => {
  const prompt = buildClaudeChannelPrompt({
    id: 'job-previbe',
    action: 'forward_full_page_via_mcp',
    pageUrl: 'https://www.notion.so/previbe-page',
    pageTitle: 'PreVibe Page',
    selectionText: '',
    replyTextToWrite: '',
    writeMode: 'append_markdown_section',
    writeSectionTitle: 'notion2CLI',
    sourceReplyJobId: '',
    installPrompt: '',
    officialDocUrl: '',
    promptProfileId: 'previbe',
    promptProfile: {
      id: 'previbe',
      name: 'PreVibe',
      instruction: 'Move the input document toward a development-ready brief without losing useful information.',
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
        markdown: '# PreVibe Page\n\nMeeting notes and open questions.',
      },
    },
  }, {
    notionMcpHint: 'Use the configured Notion MCP tools when the action requires write-back.',
  });

  assert.match(prompt, /Profile: previbe \(PreVibe\)\. Instruction:/);
  assert.match(prompt, /Move the input document toward a development-ready brief/);
  assert.match(prompt, /promptProfile\.id is not "raw": use the prompt profile instruction as the task intent/);
  assert.match(prompt, /"promptProfile":\{"id":"previbe","name":"PreVibe"\}/);
  assert.match(prompt, /<<<N2C_PAGE_BUNDLE_MARKDOWN/);
});

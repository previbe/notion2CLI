import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexExecArgs, parseNotionMcpList } from '../server/runtimes/codex-runtime.mjs';
import { parseJobRequest } from '../server/core/schemas.mjs';
import { parseClaudeMcpList } from '../cli/doctor.mjs';

test('codex exec args stay read-only for normal content actions', () => {
  const args = buildCodexExecArgs({
    cwd: '/tmp/notion2cli',
    outputFile: '/tmp/notion2cli/result.md',
    model: 'gpt-5.4',
    profile: 'default',
    extraArgs: ['--progress-cursor'],
  });

  assert.deepEqual(args, [
    'exec',
    '--ephemeral',
    '-C',
    '/tmp/notion2cli',
    '-o',
    '/tmp/notion2cli/result.md',
    '-p',
    'default',
    '-m',
    'gpt-5.4',
    '-s',
    'read-only',
    '--progress-cursor',
  ]);
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

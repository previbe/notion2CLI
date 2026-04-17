#!/usr/bin/env node

import http from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.NOTION2CLI_PORT || 43821);
const HOST = '127.0.0.1';
const PAIR_TTL_MS = 5 * 60 * 1000;
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const standalone = process.env.NOTION2CLI_STANDALONE === '1' || process.argv.includes('--standalone');

const state = {
  startedAt: new Date().toISOString(),
  pairCode: null,
  pairExpiresAt: 0,
  clientToken: null,
  clientLabel: null,
  jobs: new Map(),
};

function logToStderr(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stderr.write(`[notion2cli] ${message}${suffix}\n`);
}

const instructions = [
  'Events from notion2cli arrive as <channel source="notion2cli_bridge" chat_id="..." ...>JSON</channel>.',
  'Treat each event as a browser user action that originated from a Notion page on the local machine.',
  'The JSON body includes page metadata, optional selected text, and a rough DOM snapshot.',
  'Treat selectionText as the user input when it is non-empty. Otherwise treat snapshotText as the user input.',
  'Use the Notion page metadata only as context. Do not ignore the actual text payload.',
  'Answer the selected text or page text directly in Chinese as if the user had typed that content into the current Claude Code session.',
  'If the payload is a question, answer it directly. If it is an instruction, execute it within the limits of the current session. If it is reference material without a direct question, give a short helpful response that acknowledges what was received and what you can do next.',
  'After producing the answer for the current Claude Code conversation, call the reply tool exactly once with the same chat_id so the browser panel receives the result too.',
  'The reply text should be the same substantive answer the user would want to read in Claude Code, not a transport receipt.',
  'Keep the reply compact and readable in a small browser panel unless the request clearly needs more detail.',
].join(' ');

const mcp = new Server(
  { name: 'notion2cli-bridge', version: '0.1.0' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions,
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Reply back to the notion2cli browser panel for a specific job.',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: {
            type: 'string',
            description: 'The job id from the channel tag.',
          },
          text: {
            type: 'string',
            description: 'The markdown reply to show in the browser panel.',
          },
          status: {
            type: 'string',
            enum: ['completed', 'failed'],
            description: 'Optional terminal status for the job.',
          },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'reply') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments ?? {};
  const jobId = String(args.chat_id || '').trim();
  const text = String(args.text || '').trim();
  const status = args.status === 'failed' ? 'failed' : 'completed';

  if (!jobId) {
    throw new Error('reply.chat_id is required');
  }

  const job = state.jobs.get(jobId);
  if (!job) {
    throw new Error(`Unknown job id: ${jobId}`);
  }

  job.status = status;
  job.replyText = text;
  job.error = status === 'failed' ? text : null;
  job.updatedAt = nowIso();
  job.history.push({
    at: job.updatedAt,
    type: 'reply',
    status,
    text,
  });
  logToStderr('reply stored', { jobId, status });

  return {
    content: [
      {
        type: 'text',
        text: `Stored ${status} reply for ${jobId}`,
      },
    ],
  };
});

await maybeConnectMcp();
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      return sendEmpty(res, 204);
    }

    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    pruneJobs();

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, publicStatus(readBearer(req)));
    }

    if (req.method === 'POST' && url.pathname === '/api/pair/create') {
      const pair = createPairCode();
      return sendJson(res, 200, pair);
    }

    if (req.method === 'POST' && url.pathname === '/api/pair/confirm') {
      const body = await readJson(req);
      return handlePairConfirm(res, body);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const token = requireToken(req);
      const body = await readJson(req);
      return handleCreateJob(res, token, body);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const token = requireToken(req);
      const jobId = url.pathname.replace('/api/jobs/', '').trim();
      return handleReadJob(res, token, jobId);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    const status = error.statusCode || 500;
    return sendJson(res, status, {
      ok: false,
      error: error.message || 'Unknown error',
    });
  }
});

server.on('error', (error) => {
  logToStderr('bridge server error', {
    code: error?.code || 'UNKNOWN',
    message: error?.message || 'Unknown error',
  });
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  logToStderr(`bridge listening on http://${HOST}:${PORT}`);
  if (standalone) {
    logToStderr('standalone mode enabled');
  }
});

function nowIso() {
  return new Date().toISOString();
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [jobId, job] of state.jobs.entries()) {
    if (new Date(job.createdAt).getTime() < cutoff) {
      state.jobs.delete(jobId);
    }
  }
}

async function maybeConnectMcp() {
  if (standalone) {
    return;
  }

  await mcp.connect(new StdioServerTransport());
}

function publicStatus(token) {
  const authenticated = Boolean(token && token === state.clientToken);
  return {
    ok: true,
    bridgeRunning: true,
    standalone,
    claudeSessionAttached: !standalone,
    startedAt: state.startedAt,
    paired: authenticated,
    clientLabel: authenticated ? state.clientLabel : null,
    awaitingPairCode: Boolean(state.pairCode && state.pairExpiresAt > Date.now()),
    pairExpiresAt: state.pairExpiresAt ? new Date(state.pairExpiresAt).toISOString() : null,
    pendingJobs: Array.from(state.jobs.values()).filter((job) => !['completed', 'failed'].includes(job.status)).length,
  };
}

function createPairCode() {
  const code = String(randomInt(100000, 999999));
  const expiresAt = Date.now() + PAIR_TTL_MS;
  state.pairCode = code;
  state.pairExpiresAt = expiresAt;
  return {
    ok: true,
    code,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function handlePairConfirm(res, body) {
  const code = String(body?.code || '').trim();
  const clientLabel = String(body?.clientLabel || 'Chrome Extension').trim();

  if (!state.pairCode || state.pairExpiresAt < Date.now()) {
    throw httpError(400, 'No active pairing code. Run notion2cli-connect in Claude Code first.');
  }

  if (code !== state.pairCode) {
    throw httpError(401, 'Invalid pairing code.');
  }

  state.clientToken = randomBytes(24).toString('hex');
  state.clientLabel = clientLabel;
  state.pairCode = null;
  state.pairExpiresAt = 0;
  logToStderr('browser paired', { clientLabel: state.clientLabel, standalone });

  return sendJson(res, 200, {
    ok: true,
    token: state.clientToken,
    clientLabel: state.clientLabel,
  });
}

async function handleCreateJob(res, token, body) {
  assertToken(token);

  const action = normalizeAction(body?.action);
  const pageUrl = String(body?.pageUrl || '').trim();
  const pageTitle = String(body?.pageTitle || 'Untitled Notion Page').trim();
  const selectionText = String(body?.selectionText || '').trim();
  const snapshotText = String(body?.snapshotText || '').trim();
  const source = String(body?.source || 'browser-extension').trim();

  if (!pageUrl) {
    throw httpError(400, 'pageUrl is required');
  }

  const jobId = randomUUID();
  const job = {
    id: jobId,
    action,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    pageUrl,
    pageTitle,
    selectionText,
    snapshotText,
    source,
    replyText: '',
    error: null,
    history: [
      {
        at: nowIso(),
        type: 'created',
      },
    ],
  };

  state.jobs.set(jobId, job);
  logToStderr('job created', {
    jobId,
    action,
    standalone,
    selectionChars: selectionText.length,
    snapshotChars: snapshotText.length,
    pageTitle: safeMetaValue(pageTitle, 80),
  });

  if (standalone) {
    simulateStandaloneReply(job);
  } else {
    const payload = JSON.stringify(
      {
        action,
        pageUrl,
        pageTitle,
        selectionText,
        snapshotText,
        source,
        requestedAt: job.createdAt,
      },
      null,
      2,
    );

    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: payload,
        meta: {
          chat_id: jobId,
          action,
          has_selection: selectionText ? 'true' : 'false',
          page_title: safeMetaValue(pageTitle, 80),
          page_url: safeMetaValue(pageUrl, 240),
        },
      },
    });

    job.status = 'sent';
    job.updatedAt = nowIso();
    job.history.push({
      at: job.updatedAt,
      type: 'sent_to_claude',
    });
    logToStderr('job sent to claude', { jobId });
  }

  return sendJson(res, 200, {
    ok: true,
    jobId,
    status: job.status,
  });
}

function handleReadJob(res, token, jobId) {
  assertToken(token);
  const job = state.jobs.get(jobId);

  if (!job) {
    throw httpError(404, 'Unknown job id');
  }

  return sendJson(res, 200, {
    ok: true,
    job: {
      id: job.id,
      action: job.action,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      pageUrl: job.pageUrl,
      pageTitle: job.pageTitle,
      replyText: job.replyText,
      error: job.error,
      selectionPreview: truncate(job.selectionText, 320),
      history: job.history,
    },
  });
}

function simulateStandaloneReply(job) {
  job.status = 'sent';
  job.updatedAt = nowIso();
  job.history.push({
    at: job.updatedAt,
    type: 'sent_to_standalone_simulator',
  });

  setTimeout(() => {
    const prompt = job.selectionText || job.snapshotText || '(空文本)';
    job.status = 'completed';
    job.updatedAt = nowIso();
    job.replyText = [
      '当前是 standalone 本地调试模式，下面是模拟回复。',
      '',
      `我收到的内容是：${prompt}`,
    ].join('\n');
    job.history.push({
      at: job.updatedAt,
      type: 'standalone_reply',
    });
    logToStderr('standalone reply generated', { jobId: job.id });
  }, 1200);
}

function normalizeAction(value) {
  const action = String(value || '').trim();
  const allowed = new Set(['forward_raw_text']);
  return allowed.has(action) ? action : 'forward_raw_text';
}

function safeMetaValue(value, maxLength) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function requireToken(req) {
  const token = readBearer(req);
  if (!token) {
    throw httpError(401, 'Missing bearer token');
  }
  return token;
}

function assertToken(token) {
  if (!state.clientToken || token !== state.clientToken) {
    throw httpError(403, 'Bridge is not paired with this browser client');
  }
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim();
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end(JSON.stringify(body));
}

function sendEmpty(res, statusCode) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(httpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

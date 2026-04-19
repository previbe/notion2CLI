import { spawn } from 'node:child_process';
import readline from 'node:readline';

const CLIENT_INFO = {
  name: 'notion2cli',
  title: 'notion2cli bridge',
  version: '0.1.0',
};

export class CodexAppServerSession {
  constructor({
    jobId,
    cwd,
    inputItems,
    model,
    profile,
    extraArgs,
    log,
    onRunning,
    onApprovalRequested,
    onCompleted,
    onFailed,
    onClosed,
  }) {
    this.jobId = jobId;
    this.cwd = cwd;
    this.inputItems = Array.isArray(inputItems) ? inputItems : [];
    this.model = model || null;
    this.profile = profile || '';
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs : [];
    this.log = log;
    this.onRunning = onRunning;
    this.onApprovalRequested = onApprovalRequested;
    this.onCompleted = onCompleted;
    this.onFailed = onFailed;
    this.onClosed = onClosed;

    this.child = null;
    this.reader = null;
    this.stderr = '';
    this.threadId = null;
    this.turnId = null;
    this.finalMessage = '';
    this.pendingRequests = new Map();
    this.nextRequestId = 1;
    this.pendingApproval = null;
    this.closed = false;
    this.finished = false;
  }

  async start() {
    const args = buildCodexAppServerArgs({
      profile: this.profile,
      extraArgs: this.extraArgs,
    });
    this.child = spawn('codex', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.reader = readline.createInterface({ input: this.child.stdout });

    this.reader.on('line', (line) => {
      this.handleLine(line).catch((error) => {
        this.fail(error?.message || 'Failed to process Codex app-server event');
      });
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });

    this.child.on('error', (error) => {
      this.fail(error?.message || 'Failed to start codex app-server');
    });

    this.child.on('close', (code, signal) => {
      this.closed = true;
      this.rejectPendingRequests(new Error(`codex app-server closed (${signal || code || 'unknown'})`));

      if (!this.finished) {
        const reason = this.stderr.trim() || `codex app-server exited with code ${code ?? 'unknown'}`;
        this.fail(reason, {
          exitCode: code ?? null,
          signal: signal || null,
        });
      }

      this.onClosed?.();
    });

    try {
      await this.sendRequest('initialize', {
        clientInfo: CLIENT_INFO,
        capabilities: {
          experimentalApi: true,
        },
      });
      this.writeMessage({
        method: 'initialized',
      });

      const threadResponse = await this.sendRequest('thread/start', {
        cwd: this.cwd,
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
        ...(this.model ? { model: this.model } : {}),
      });
      this.threadId = threadResponse?.thread?.id || null;

      const turnResponse = await this.sendRequest('turn/start', {
        threadId: this.threadId,
        input: this.inputItems,
        approvalPolicy: 'on-request',
      });
      this.turnId = turnResponse?.turn?.id || null;

      this.onRunning?.({
        threadId: this.threadId,
        turnId: this.turnId,
      });
    } catch (error) {
      this.fail(error?.message || 'Failed to start Codex app-server turn');
    }
  }

  async respondToApproval(resolution) {
    if (!this.pendingApproval) {
      throw new Error('No pending approval request');
    }

    const pendingApproval = this.pendingApproval;
    this.pendingApproval = null;
    this.writeMessage({
      jsonrpc: '2.0',
      id: pendingApproval.requestId,
      result: {
        action: resolution.action,
        content: buildApprovalContent(resolution, pendingApproval.params),
        _meta: Object.hasOwn(resolution, '_meta') ? resolution._meta : null,
      },
    });
  }

  shutdown() {
    if (this.closed || !this.child) {
      return;
    }

    this.closed = true;
    this.child.kill('SIGTERM');
  }

  async handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.log('codex app-server emitted invalid JSON', {
        jobId: this.jobId,
        line,
      });
      return;
    }

    if (Object.hasOwn(message, 'id') && !Object.hasOwn(message, 'method')) {
      this.handleResponse(message);
      return;
    }

    if (!message.method) {
      return;
    }

    if (Object.hasOwn(message, 'id')) {
      await this.handleServerRequest(message);
      return;
    }

    this.handleNotification(message);
  }

  handleResponse(message) {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);
    if (message.error) {
      pending.reject(new Error(normalizeRpcError(message.error)));
      return;
    }

    pending.resolve(message.result);
  }

  async handleServerRequest(message) {
    if (message.method !== 'mcpServer/elicitation/request') {
      this.writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported server request: ${message.method}`,
        },
      });
      this.fail(`Codex requested an unsupported approval flow: ${message.method}`);
      return;
    }

    this.pendingApproval = {
      requestId: message.id,
      params: message.params || {},
    };

    this.onApprovalRequested?.({
      threadId: this.threadId,
      turnId: this.turnId,
      requestId: message.id,
      pendingApproval: buildPendingApproval(message.params || {}),
    });
  }

  handleNotification(message) {
    if (message.method === 'item/completed') {
      const item = message.params?.item;
      if (item?.type === 'agentMessage' && item.phase === 'final_answer') {
        this.finalMessage = String(item.text || '').trim();
      }
      return;
    }

    if (message.method === 'turn/completed') {
      const turn = message.params?.turn || {};
      if (turn.status === 'completed') {
        const finalMessage = this.finalMessage || extractFinalMessageFromTurn(turn);
        if (finalMessage) {
          this.complete(finalMessage, {
            threadId: this.threadId,
            turnId: this.turnId,
          });
        } else {
          this.fail('Codex completed without returning a final reply', {
            threadId: this.threadId,
            turnId: this.turnId,
          });
        }
        return;
      }

      const errorText = turn?.error?.message
        || turn?.error?.additionalDetails
        || this.stderr.trim()
        || `Codex turn ended with status ${turn.status || 'unknown'}`;
      this.fail(errorText, {
        threadId: this.threadId,
        turnId: this.turnId,
        turnStatus: turn.status || 'unknown',
      });
    }
  }

  async sendRequest(method, params) {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.writeMessage({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  writeMessage(message) {
    if (!this.child || this.closed) {
      throw new Error('codex app-server session is not writable');
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  complete(replyText, meta = {}) {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.onCompleted?.(replyText, meta);
    this.shutdown();
  }

  fail(message, meta = {}) {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.onFailed?.(message, meta);
    this.shutdown();
  }
}

export function buildCodexInputItems({ prompt, images = [] }) {
  const items = [];

  for (const image of images) {
    if (!image?.cachePath) {
      continue;
    }

    items.push({
      type: 'localImage',
      path: image.cachePath,
    });
  }

  items.push({
    type: 'text',
    text: prompt,
    text_elements: [],
  });

  return items;
}

export function buildCodexAppServerArgs({ profile, extraArgs }) {
  const args = ['app-server', '--listen', 'stdio://'];

  if (profile) {
    args.push('-c', `profile="${escapeTomlString(profile)}"`);
  }

  if (Array.isArray(extraArgs) && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

function escapeTomlString(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function normalizeRpcError(error) {
  if (!error) {
    return 'Unknown JSON-RPC error';
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return JSON.stringify(error);
}

function extractFinalMessageFromTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'agentMessage' && item.phase === 'final_answer') {
      return String(item.text || '').trim();
    }
  }

  return '';
}

function buildPendingApproval(params) {
  const message = String(params?.message || 'Codex 需要你的确认才能继续。').trim();
  const mode = params?.mode === 'url' ? 'url' : 'form';

  return {
    kind: 'mcp_elicitation',
    serverName: String(params?.serverName || '').trim() || 'unknown',
    mode,
    message,
    url: mode === 'url' ? String(params?.url || '').trim() : '',
    requestedSchema: mode === 'form' ? params?.requestedSchema || null : null,
  };
}

function buildApprovalContent(resolution, params) {
  if (resolution.action !== 'accept') {
    return null;
  }

  if (Object.hasOwn(resolution, 'content')) {
    return resolution.content ?? null;
  }

  return params?.mode === 'form' ? {} : null;
}

import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class ClaudeCliSession {
  constructor({
    jobId,
    cwd,
    prompt,
    resumePromptAfterApproval,
    model,
    extraArgs,
    addDirs,
    log,
    onRunning,
    onApprovalRequested,
    onCompleted,
    onFailed,
    onClosed,
  }) {
    this.jobId = jobId;
    this.cwd = cwd;
    this.prompt = prompt;
    this.resumePromptAfterApproval = String(resumePromptAfterApproval || '').trim();
    this.model = model || '';
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs : [];
    this.addDirs = Array.isArray(addDirs) ? addDirs : [];
    this.log = log;
    this.onRunning = onRunning;
    this.onApprovalRequested = onApprovalRequested;
    this.onCompleted = onCompleted;
    this.onFailed = onFailed;
    this.onClosed = onClosed;

    this.child = null;
    this.reader = null;
    this.stderr = '';
    this.closed = false;
    this.finished = false;
    this.sessionId = null;
    this.currentTurn = null;
    this.pendingApproval = null;
    this.nextApprovalId = 1;
    this.runningAnnounced = false;
  }

  async start() {
    const args = buildClaudeCliArgs({
      model: this.model,
      extraArgs: this.extraArgs,
      addDirs: this.addDirs,
    });
    this.child = spawn('claude', args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.reader = readline.createInterface({ input: this.child.stdout });

    this.reader.on('line', (line) => {
      this.handleLine(line).catch((error) => {
        this.fail(error?.message || 'Failed to process Claude Code stream event');
      });
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });

    this.child.on('error', (error) => {
      this.fail(error?.message || 'Failed to start Claude Code');
    });

    this.child.on('close', (code, signal) => {
      this.closed = true;

      if (!this.finished) {
        this.fail(buildClaudeExitMessage({
          stderr: this.stderr,
          code,
          signal,
        }), {
          sessionId: this.sessionId,
          exitCode: code ?? null,
          signal: signal || null,
        });
      }

      this.onClosed?.();
    });

    this.sendUserPrompt(this.prompt);
  }

  async respondToApproval(resolution) {
    if (!this.pendingApproval) {
      throw new Error('No pending Claude approval request');
    }

    if (resolution.action !== 'accept') {
      this.fail('The user cancelled Notion authorization.', {
        sessionId: this.sessionId,
      });
      return;
    }

    const followUpPrompt = buildApprovalContinuationPrompt({
      resolution,
      pendingApproval: this.pendingApproval,
      resumePromptAfterApproval: this.resumePromptAfterApproval,
    });
    this.pendingApproval = null;
    this.resumePromptAfterApproval = '';
    this.sendUserPrompt(followUpPrompt);
  }

  shutdown() {
    if (!this.child || this.closed) {
      return;
    }

    this.closed = true;
    this.child.kill('SIGTERM');
  }

  cancel(reason = 'The user stopped the task.') {
    if (this.finished) {
      return;
    }

    this.fail(reason, {
      sessionId: this.sessionId,
      cancelled: true,
    });
  }

  async handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.log?.('claude cli emitted invalid JSON', {
        jobId: this.jobId,
        line,
      });
      return;
    }

    if (message?.session_id && !this.sessionId) {
      this.sessionId = String(message.session_id);
    }

    switch (message?.type) {
      case 'system':
        this.handleSystemMessage(message);
        break;
      case 'assistant':
        this.handleAssistantMessage(message);
        break;
      case 'user':
        this.handleUserMessage(message);
        break;
      case 'result':
        this.handleResultMessage(message);
        break;
      default:
        break;
    }
  }

  handleSystemMessage(message) {
    if (message?.subtype !== 'init') {
      return;
    }

    this.sessionId = String(message.session_id || this.sessionId || '').trim() || this.sessionId;
    this.announceRunning();
  }

  handleAssistantMessage(message) {
    if (!this.currentTurn) {
      return;
    }

    this.announceRunning();
    const chunks = Array.isArray(message?.message?.content) ? message.message.content : [];
    for (const chunk of chunks) {
      if (chunk?.type === 'text' && chunk.text) {
        this.currentTurn.assistantText += String(chunk.text);
      }
    }
  }

  handleUserMessage(message) {
    if (!this.currentTurn) {
      return;
    }

    this.announceRunning();
    const toolUseResult = message?.tool_use_result;
    if (toolUseResult?.status !== 'auth_url') {
      return;
    }

    const authUrl = String(toolUseResult.authUrl || '').trim();
    const pendingApproval = {
      requestId: `claude-auth-${this.nextApprovalId}`,
      kind: 'mcp_auth',
      serverName: 'notion',
      mode: 'url',
      url: authUrl,
      message: 'Claude Code needs Notion browser authorization. Open the authorization page, complete the browser flow, then click Allow again.',
    };
    this.nextApprovalId += 1;

    this.currentTurn.pendingApproval = pendingApproval;
    this.pendingApproval = pendingApproval;
    this.onApprovalRequested?.({
      sessionId: this.sessionId,
      pendingApproval,
    });
  }

  handleResultMessage(message) {
    const turn = this.currentTurn;
    this.currentTurn = null;
    this.announceRunning();

    if (turn?.pendingApproval) {
      return;
    }

    const resultText = normalizeClaudeResultText(message, turn?.assistantText || '');
    if (message?.is_error) {
      this.fail(resultText || 'Claude request failed', {
        sessionId: this.sessionId,
      });
      return;
    }

    this.complete(resultText, {
      sessionId: String(message?.session_id || this.sessionId || '').trim() || null,
    });
  }

  sendUserPrompt(promptText) {
    if (!this.child || this.closed) {
      throw new Error('Claude Code session is not writable');
    }

    if (this.currentTurn) {
      throw new Error('Claude Code session is already processing a turn');
    }

    this.currentTurn = {
      assistantText: '',
      pendingApproval: null,
    };
    this.child.stdin.write(`${JSON.stringify(buildStreamJsonUserMessage(promptText))}\n`);
  }

  announceRunning() {
    if (this.runningAnnounced) {
      return;
    }

    this.runningAnnounced = true;
    this.onRunning?.({
      sessionId: this.sessionId || null,
    });
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

export function buildClaudeCliArgs({ model, extraArgs, addDirs }) {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ];

  if (model) {
    args.push('--model', model);
  }

  for (const dir of dedupeStrings(addDirs)) {
    args.push('--add-dir', dir);
  }

  if (Array.isArray(extraArgs) && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

export function parseClaudeJsonOutput(stdout) {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed?.type === 'result') {
        return {
          ok: !parsed.is_error,
          result: String(parsed.result || '').trim(),
          error: parsed.is_error ? String(parsed.result || parsed.subtype || 'Claude request failed') : '',
          sessionId: parsed.session_id || null,
        };
      }
    } catch {}
  }

  return null;
}

export function buildStreamJsonUserMessage(text) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: String(text || ''),
        },
      ],
    },
  };
}

function normalizeClaudeResultText(message, assistantText) {
  const resultText = String(message?.result || '').trim();
  if (resultText) {
    return resultText;
  }

  return String(assistantText || '').trim();
}

function buildClaudeExitMessage({ stderr, code, signal }) {
  return String(stderr || '').trim() || `Claude Code exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
}

function buildApprovalContinuationPrompt({ resolution, pendingApproval, resumePromptAfterApproval }) {
  const content = normalizeApprovalResolutionContent(resolution?.content);
  const resumePrompt = String(resumePromptAfterApproval || '').trim();
  if (resumePrompt) {
    return [
      'The user has completed the browser authorization flow for the notion2cli task.',
      content ? `If a callback URL is needed to finish authentication, use this exact URL first: ${content}` : null,
      'Then perform the original notion2cli task below in this same session.',
      'Return only the normal notion2cli output for that original task.',
      '',
      'Original notion2cli task prompt:',
      resumePrompt,
    ].filter(Boolean).join('\n\n');
  }

  if (content) {
    return [
      'The user completed the browser authorization flow for the notion2cli task.',
      `If this callback URL is needed, use it now: ${content}`,
      'Then continue the previous notion2cli task in this same session.',
      'If authorization is still incomplete, explain briefly what is still missing instead of inventing a result.',
    ].join('\n\n');
  }

  return [
    `The user has completed the browser authorization flow for ${pendingApproval.serverName || 'the required MCP server'}.`,
    'Continue the previous notion2cli task in this same session.',
    'If authorization is still incomplete, explain briefly what is still missing instead of inventing a result.',
  ].join('\n\n');
}

function normalizeApprovalResolutionContent(content) {
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  if (content && typeof content === 'object') {
    const callbackUrl = String(content.callbackUrl || content.redirectUrl || '').trim();
    if (callbackUrl) {
      return callbackUrl;
    }
  }

  return '';
}

function dedupeStrings(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values || []) {
    const candidate = String(value || '').trim();
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    deduped.push(candidate);
  }

  return deduped;
}

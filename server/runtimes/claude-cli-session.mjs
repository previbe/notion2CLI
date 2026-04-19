import { spawn } from 'node:child_process';

export class ClaudeCliSession {
  constructor({
    jobId,
    cwd,
    prompt,
    model,
    extraArgs,
    addDirs,
    log,
    onRunning,
    onCompleted,
    onFailed,
    onClosed,
  }) {
    this.jobId = jobId;
    this.cwd = cwd;
    this.prompt = prompt;
    this.model = model || '';
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs : [];
    this.addDirs = Array.isArray(addDirs) ? addDirs : [];
    this.log = log;
    this.onRunning = onRunning;
    this.onCompleted = onCompleted;
    this.onFailed = onFailed;
    this.onClosed = onClosed;

    this.child = null;
    this.stdout = '';
    this.stderr = '';
    this.closed = false;
    this.finished = false;
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

    this.child.stdout.on('data', (chunk) => {
      this.stdout += chunk.toString('utf8');
    });
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });

    this.child.on('error', (error) => {
      this.fail(error?.message || 'Failed to start Claude Code');
    });

    this.child.on('close', (code, signal) => {
      this.closed = true;
      const parsed = parseClaudeJsonOutput(this.stdout);

      if (!this.finished) {
        if ((code === 0 || code === null) && parsed?.ok) {
          this.complete(parsed.result, {
            sessionId: parsed.sessionId,
          });
        } else {
          const errorText = parsed?.error
            || this.stderr.trim()
            || this.stdout.trim()
            || `Claude Code exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
          this.fail(errorText, {
            sessionId: parsed?.sessionId || null,
            exitCode: code ?? null,
            signal: signal || null,
          });
        }
      }

      this.onClosed?.();
    });

    this.child.stdin.write(this.prompt);
    this.child.stdin.end();
    this.onRunning?.();
  }

  shutdown() {
    if (!this.child || this.closed) {
      return;
    }

    this.closed = true;
    this.child.kill('SIGTERM');
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
  const args = ['-p', '--output-format', 'json'];

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

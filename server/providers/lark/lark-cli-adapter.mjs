import { createRequire } from 'node:module';
import process from 'node:process';
import { spawnCommand } from '../../runtimes/exec-utils.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const FLOW_URL_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const require = createRequire(import.meta.url);

export class LarkCliAdapter {
  constructor({
    command = '',
    baseArgs = null,
    spawnImpl = spawnCommand,
    env = process.env,
    cwd = process.cwd(),
    log = () => {},
  } = {}) {
    this.command = String(command || '').trim();
    this.baseArgs = Array.isArray(baseArgs) ? baseArgs.map(String) : null;
    this.spawnImpl = spawnImpl;
    this.env = env;
    this.cwd = cwd;
    this.log = log;
  }

  async getVersion() {
    const result = await this.run(['--version'], { timeoutMs: 10000 });
    return String(result.stdout || result.stderr || '').trim();
  }

  async authStatus() {
    return this.runJson(['auth', 'status'], { timeoutMs: 15000 });
  }

  async requestUserAuthorization({ scopes }) {
    return this.runJson([
      'auth',
      'login',
      '--scope',
      String(scopes || '').trim(),
      '--no-wait',
      '--json',
    ], { timeoutMs: 30000 });
  }

  startDeviceCodePolling(deviceCode) {
    return this.start(['auth', 'login', '--device-code', String(deviceCode || '').trim()], {
      timeoutMs: 10 * 60 * 1000,
    });
  }

  startAppRegistration({ brand = 'feishu' } = {}) {
    return this.start(['config', 'init', '--new', '--brand', normalizeBrand(brand)], {
      timeoutMs: 10 * 60 * 1000,
      urlTimeoutMs: FLOW_URL_TIMEOUT_MS,
    });
  }

  async apiRequest(method, path, { params = null, data = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const args = [
      'api',
      String(method || '').trim().toUpperCase(),
      String(path || '').trim(),
      '--as',
      'user',
      '--format',
      'json',
    ];

    if (params && Object.keys(params).length) {
      args.push('--params', JSON.stringify(params));
    }
    if (data != null) {
      args.push('--data', JSON.stringify(data));
    }

    return this.runJson(args, { timeoutMs });
  }

  async getWikiNode(token) {
    return this.apiRequest('GET', '/open-apis/wiki/v2/spaces/get_node', {
      params: {
        token: String(token || '').trim(),
      },
    });
  }

  async getDocument(documentId) {
    return this.apiRequest('GET', `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}`);
  }

  async getDocumentRawContent(documentId) {
    return this.apiRequest('GET', `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/raw_content`);
  }

  async listDocumentBlocks(documentId, { pageToken = '', pageSize = 500 } = {}) {
    return this.apiRequest('GET', `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/blocks`, {
      params: compactParams({
        document_revision_id: -1,
        page_size: pageSize,
        page_token: pageToken,
      }),
    });
  }

  async listDocumentChildren(documentId, blockId, { pageToken = '', pageSize = 500 } = {}) {
    return this.apiRequest(
      'GET',
      `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/blocks/${encodePathSegment(blockId)}/children`,
      {
        params: compactParams({
          document_revision_id: -1,
          page_size: pageSize,
          page_token: pageToken,
        }),
      },
    );
  }

  async createDocumentChildren(documentId, blockId, { index = -1, children = [] } = {}) {
    return this.apiRequest(
      'POST',
      `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/blocks/${encodePathSegment(blockId)}/children`,
      {
        params: {
          document_revision_id: -1,
        },
        data: {
          index,
          children,
        },
      },
    );
  }

  async batchDeleteDocumentChildren(documentId, blockId, { startIndex = 0, endIndex = 0 } = {}) {
    return this.apiRequest(
      'DELETE',
      `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/blocks/${encodePathSegment(blockId)}/children/batch_delete`,
      {
        params: {
          document_revision_id: -1,
        },
        data: {
          start_index: startIndex,
          end_index: endIndex,
        },
      },
    );
  }

  async patchDocumentBlock(documentId, blockId, block) {
    return this.apiRequest(
      'PATCH',
      `/open-apis/docx/v1/documents/${encodePathSegment(documentId)}/blocks/${encodePathSegment(blockId)}`,
      {
        params: {
          document_revision_id: -1,
        },
        data: block,
      },
    );
  }

  async downloadMedia({ token, outputPath }) {
    return this.runJson([
      'docs',
      '+media-download',
      '--token',
      String(token || '').trim(),
      '--output',
      String(outputPath || '').trim(),
      '--overwrite',
      '--as',
      'user',
    ]);
  }

  async runJson(args, options = {}) {
    const result = await this.run(args, options);
    if (result.exitCode !== 0) {
      throw createLarkCliError(args, result);
    }

    return parseLarkCliJson(result.stdout);
  }

  run(args, options = {}) {
    const invocation = this.resolveInvocation();
    const finalArgs = [...invocation.baseArgs, ...args.map(String)];
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    const input = options.input == null ? null : String(options.input);

    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnImpl(invocation.command, finalArgs, {
          cwd: this.cwd,
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        });
      } catch (error) {
        reject(error);
        return;
      }

      const output = createOutputCollector();
      let settled = false;
      let timedOut = false;
      let killTimer = null;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (child.exitCode == null) {
            child.kill('SIGKILL');
          }
        }, 1000);
        killTimer.unref?.();
      }, timeoutMs);
      timer.unref?.();

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        fn(value);
      };

      child.stdout?.on('data', (chunk) => output.pushStdout(chunk));
      child.stderr?.on('data', (chunk) => output.pushStderr(chunk));
      child.on('error', (error) => finish(reject, error));
      child.on('close', (exitCode, signal) => {
        const result = {
          exitCode: timedOut ? 124 : Number(exitCode || 0),
          signal: signal || '',
          timedOut,
          stdout: output.stdout(),
          stderr: output.stderr(),
          args,
        };
        finish(resolve, result);
      });

      if (input != null) {
        child.stdin?.end(input);
      } else {
        child.stdin?.end();
      }
    });
  }

  start(args, options = {}) {
    const invocation = this.resolveInvocation();
    const finalArgs = [...invocation.baseArgs, ...args.map(String)];
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10 * 60 * 1000;
    const urlTimeoutMs = Number.isFinite(options.urlTimeoutMs) ? options.urlTimeoutMs : FLOW_URL_TIMEOUT_MS;
    const output = createOutputCollector();
    const child = this.spawnImpl(invocation.command, finalArgs, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdin?.end();

    let resolvedUrl = '';
    let urlResolve;
    let urlReject;
    const waitForUrl = new Promise((resolve, reject) => {
      urlResolve = resolve;
      urlReject = reject;
    });
    const urlTimer = setTimeout(() => {
      if (!resolvedUrl) {
        urlReject(new Error('lark-cli did not print an authorization URL in time.'));
      }
    }, urlTimeoutMs);

    const inspectUrl = () => {
      if (resolvedUrl) {
        return;
      }
      const found = extractVerificationUrl(`${output.stdout()}\n${output.stderr()}`);
      if (found) {
        resolvedUrl = found;
        clearTimeout(urlTimer);
        urlResolve(found);
      }
    };

    child.stdout?.on('data', (chunk) => {
      output.pushStdout(chunk);
      inspectUrl();
    });
    child.stderr?.on('data', (chunk) => {
      output.pushStderr(chunk);
      inspectUrl();
    });

    let timedOut = false;
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode == null) {
          child.kill('SIGKILL');
        }
      }, 1000);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    const done = new Promise((resolve) => {
      child.on('error', (error) => {
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        clearTimeout(urlTimer);
        if (!resolvedUrl) {
          urlReject(error);
        }
        resolve({
          exitCode: 1,
          signal: '',
          timedOut: false,
          stdout: output.stdout(),
          stderr: output.stderr() || error.message,
          args,
        });
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        clearTimeout(urlTimer);
        if (!resolvedUrl) {
          const found = extractVerificationUrl(`${output.stdout()}\n${output.stderr()}`);
          if (found) {
            resolvedUrl = found;
            urlResolve(found);
          } else {
            urlReject(new Error('lark-cli exited before printing an authorization URL.'));
          }
        }
        resolve({
          exitCode: timedOut ? 124 : Number(exitCode || 0),
          signal: signal || '',
          timedOut,
          stdout: output.stdout(),
          stderr: output.stderr(),
          args,
        });
      });
    });

    return {
      child,
      done,
      waitForUrl,
      getOutput() {
        return {
          stdout: output.stdout(),
          stderr: output.stderr(),
        };
      },
    };
  }

  resolveInvocation() {
    if (this.command) {
      return {
        command: this.command,
        baseArgs: this.baseArgs || [],
      };
    }

    if (this.env.NOTION2CLI_LARK_CLI) {
      return {
        command: this.env.NOTION2CLI_LARK_CLI,
        baseArgs: [],
      };
    }

    try {
      const runScript = require.resolve('@larksuite/cli/scripts/run.js');
      return {
        command: process.execPath,
        baseArgs: [runScript],
      };
    } catch {
      return {
        command: 'lark-cli',
        baseArgs: [],
      };
    }
  }
}

export function parseLarkCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {}

  const candidates = extractJsonCandidates(text);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(candidates[index]);
    } catch {}
  }

  throw new Error('lark-cli returned non-JSON output.');
}

export function extractVerificationUrl(text) {
  const raw = String(text || '');
  const parsed = tryParseVerificationUrlFromJson(raw);
  if (parsed) {
    return parsed;
  }

  const matches = raw.match(/https?:\/\/[^\s"'<>]+/g) || [];
  const selected = matches.find((url) => /\/page\/cli|device|oauth|accounts|open\.feishu|open\.larksuite/i.test(url))
    || matches[0]
    || '';
  return selected.replace(/[),.;\]]+$/g, '');
}

function tryParseVerificationUrlFromJson(raw) {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const payload = JSON.parse(candidate);
      const url = payload?.verification_url
        || payload?.verification_uri_complete
        || payload?.verificationUriComplete
        || payload?.data?.verification_url
        || payload?.data?.verification_uri_complete;
      if (url) {
        return String(url).trim();
      }
    } catch {}
  }
  return '';
}

function extractJsonCandidates(text) {
  const candidates = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function createOutputCollector() {
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  return {
    pushStdout(chunk) {
      const buffer = Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdoutChunks.push(buffer);
      }
    },
    pushStderr(chunk) {
      const buffer = Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes <= MAX_OUTPUT_BYTES) {
        stderrChunks.push(buffer);
      }
    },
    stdout() {
      return Buffer.concat(stdoutChunks).toString('utf8');
    },
    stderr() {
      return Buffer.concat(stderrChunks).toString('utf8');
    },
  };
}

function createLarkCliError(args, result) {
  const detail = String(result.stderr || result.stdout || '').trim();
  const timedOut = result.timedOut ? ' timed out' : '';
  const message = detail
    ? `lark-cli ${args.join(' ')} failed${timedOut}: ${detail}`
    : `lark-cli ${args.join(' ')} failed${timedOut} with exit code ${result.exitCode}`;
  const error = new Error(message);
  error.exitCode = result.exitCode;
  error.stderr = result.stderr;
  error.stdout = result.stdout;
  return error;
}

function normalizeBrand(brand) {
  return String(brand || '').toLowerCase() === 'lark' ? 'lark' : 'feishu';
}

function compactParams(params) {
  const output = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === '' || value == null) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || '').trim());
}

import http from 'node:http';
import { URL } from 'node:url';
import { DEFAULT_PORT, HOST, createHttpError, readBearer } from './constants.mjs';

const MAX_JSON_BODY_BYTES = 4 * 1024 * 1024;

export function createBridgeHttpServer(app, log, options = {}) {
  const host = options.host ?? HOST;
  const port = options.port ?? DEFAULT_PORT;

  const server = http.createServer(async (req, res) => {
    try {
      if (!isAllowedRequestOrigin(req)) {
        return sendJson(res, 403, { ok: false, error: 'Origin not allowed' }, req);
      }

      if (req.method === 'OPTIONS') {
        return sendEmpty(res, 204, req);
      }

      const url = new URL(req.url || '/', `http://${host}:${port}`);

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(res, 200, await app.getPublicStatus(readBearer(req)), req);
      }

      if (req.method === 'POST' && url.pathname === '/api/pair/create') {
        return sendJson(res, 200, await app.createPairCode(), req);
      }

      if (req.method === 'POST' && url.pathname === '/api/pair/confirm') {
        return sendJson(res, 200, app.confirmPairCode(await readJson(req)), req);
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        return sendJson(res, 200, await app.createJob(readBearer(req), await readJson(req)), req);
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel')) {
        const jobId = url.pathname.replace('/api/jobs/', '').replace('/cancel', '').trim();
        return sendJson(res, 200, await app.cancelJob(readBearer(req), jobId), req);
      }

      if (req.method === 'GET' && url.pathname === '/api/prompt-profiles') {
        return sendJson(res, 200, await app.listPromptProfiles(readBearer(req)), req);
      }

      if (req.method === 'POST' && url.pathname === '/api/prompt-profiles') {
        return sendJson(res, 200, await app.createPromptProfile(readBearer(req), await readJson(req)), req);
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/prompt-profiles/')) {
        const profileId = readPromptProfileId(url.pathname);
        return sendJson(res, 200, await app.updatePromptProfile(readBearer(req), profileId, await readJson(req)), req);
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/prompt-profiles/')) {
        const profileId = readPromptProfileId(url.pathname);
        return sendJson(res, 200, await app.deletePromptProfile(readBearer(req), profileId), req);
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/prompt-profiles/') && url.pathname.endsWith('/reset')) {
        const profileId = readPromptProfileId(url.pathname.replace(/\/reset$/, ''));
        return sendJson(res, 200, await app.resetPromptProfile(readBearer(req), profileId), req);
      }

      if (req.method === 'POST' && url.pathname === '/api/session/open') {
        return sendJson(res, 200, await app.openCodexApp(readBearer(req)), req);
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/approval')) {
        const jobId = url.pathname.replace('/api/jobs/', '').replace('/approval', '').trim();
        return sendJson(res, 200, await app.resolveJobApproval(readBearer(req), jobId, await readJson(req)), req);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const jobId = url.pathname.replace('/api/jobs/', '').trim();
        return sendJson(res, 200, app.readJob(readBearer(req), jobId), req);
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' }, req);
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      return sendJson(res, statusCode, {
        ok: false,
        error: error?.message || 'Unknown error',
      }, req);
    }
  });

  server.on('error', (error) => {
    log('bridge server error', {
      code: error?.code || 'UNKNOWN',
      message: error?.message || 'Unknown error',
    });
    process.exit(1);
  });

  return {
    server,
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          const actualPort = typeof address === 'object' && address ? address.port : port;
          log(`bridge listening on http://${host}:${actualPort}`);
          resolve({ host, port: actualPort });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export function sendJson(res, statusCode, body, req = null) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...createCorsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function sendEmpty(res, statusCode, req = null) {
  res.writeHead(statusCode, createCorsHeaders(req));
  res.end();
}

function readPromptProfileId(pathname) {
  return decodeURIComponent(pathname.replace('/api/prompt-profiles/', '').trim());
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let bodyTooLarge = false;
    let settled = false;

    const finish = (fn, value) => {
      if (settled) {
        return;
      }

      settled = true;
      fn(value);
    };

    req.on('data', (chunk) => {
      if (bodyTooLarge) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        bodyTooLarge = true;
        chunks.length = 0;
        return;
      }

      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) {
        return;
      }

      if (bodyTooLarge) {
        finish(reject, createHttpError(413, `JSON body exceeds ${MAX_JSON_BODY_BYTES} bytes`));
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        finish(resolve, {});
        return;
      }

      try {
        finish(resolve, JSON.parse(raw));
      } catch {
        finish(reject, createHttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', (error) => {
      finish(reject, error);
    });
  });
}

function isAllowedRequestOrigin(req) {
  const origin = getRequestOrigin(req);
  return !origin || isAllowedCorsOrigin(origin);
}

function createCorsHeaders(req) {
  const origin = getRequestOrigin(req);
  const headers = {
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'Origin',
  };

  if (origin && isAllowedCorsOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
  }

  return headers;
}

function getRequestOrigin(req) {
  return String(req?.headers?.origin || '').trim();
}

function isAllowedCorsOrigin(origin) {
  if (/^chrome-extension:\/\/[a-z]{32}$/i.test(origin)) {
    return true;
  }

  const configured = String(process.env.NOTION2CLI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.includes(origin);
}

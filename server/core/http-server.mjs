import http from 'node:http';
import { URL } from 'node:url';
import { DEFAULT_PORT, HOST, createHttpError, readBearer } from './constants.mjs';

export function createBridgeHttpServer(app, log, options = {}) {
  const host = options.host ?? HOST;
  const port = options.port ?? DEFAULT_PORT;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        return sendEmpty(res, 204);
      }

      const url = new URL(req.url || '/', `http://${host}:${port}`);

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return sendJson(res, 200, await app.getPublicStatus(readBearer(req)));
      }

      if (req.method === 'POST' && url.pathname === '/api/pair/create') {
        return sendJson(res, 200, await app.createPairCode());
      }

      if (req.method === 'POST' && url.pathname === '/api/pair/confirm') {
        return sendJson(res, 200, app.confirmPairCode(await readJson(req)));
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        return sendJson(res, 200, await app.createJob(readBearer(req), await readJson(req)));
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel')) {
        const jobId = url.pathname.replace('/api/jobs/', '').replace('/cancel', '').trim();
        return sendJson(res, 200, await app.cancelJob(readBearer(req), jobId));
      }

      if (req.method === 'GET' && url.pathname === '/api/prompt-profiles') {
        return sendJson(res, 200, await app.listPromptProfiles(readBearer(req)));
      }

      if (req.method === 'POST' && url.pathname === '/api/prompt-profiles') {
        return sendJson(res, 200, await app.createPromptProfile(readBearer(req), await readJson(req)));
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/prompt-profiles/')) {
        const profileId = readPromptProfileId(url.pathname);
        return sendJson(res, 200, await app.updatePromptProfile(readBearer(req), profileId, await readJson(req)));
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/prompt-profiles/')) {
        const profileId = readPromptProfileId(url.pathname);
        return sendJson(res, 200, await app.deletePromptProfile(readBearer(req), profileId));
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/prompt-profiles/') && url.pathname.endsWith('/reset')) {
        const profileId = readPromptProfileId(url.pathname.replace(/\/reset$/, ''));
        return sendJson(res, 200, await app.resetPromptProfile(readBearer(req), profileId));
      }

      if (req.method === 'POST' && url.pathname === '/api/session/open') {
        return sendJson(res, 200, await app.openCodexApp(readBearer(req)));
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/approval')) {
        const jobId = url.pathname.replace('/api/jobs/', '').replace('/approval', '').trim();
        return sendJson(res, 200, await app.resolveJobApproval(readBearer(req), jobId, await readJson(req)));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const jobId = url.pathname.replace('/api/jobs/', '').trim();
        return sendJson(res, 200, app.readJob(readBearer(req), jobId));
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      return sendJson(res, statusCode, {
        ok: false,
        error: error?.message || 'Unknown error',
      });
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

export function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end(JSON.stringify(body));
}

function sendEmpty(res, statusCode) {
  res.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  });
  res.end();
}

function readPromptProfileId(pathname) {
  return decodeURIComponent(pathname.replace('/api/prompt-profiles/', '').trim());
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
        reject(createHttpError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

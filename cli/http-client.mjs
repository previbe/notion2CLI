import { DEFAULT_PORT, HOST } from '../server/core/constants.mjs';

export function getBridgeBaseUrl(options = {}) {
  const host = options.host || HOST;
  const port = Number(options.port || DEFAULT_PORT);
  return `http://${host}:${port}`;
}

export async function fetchBridgeStatus(options = {}) {
  return requestBridge('GET', '/api/status', options);
}

export async function createPairCode(options = {}) {
  return requestBridge('POST', '/api/pair/create', options);
}

export async function requestBridge(method, pathname, options = {}) {
  const headers = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(`${getBridgeBaseUrl(options)}${pathname}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw new Error(error?.message || `Unable to connect to ${getBridgeBaseUrl(options)}`);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`bridge returned an invalid response (HTTP ${response.status})`);
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `bridge request failed (HTTP ${response.status})`);
  }

  return payload;
}

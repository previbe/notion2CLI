const BRIDGE_ORIGIN = 'http://127.0.0.1:43821';
const STORAGE_KEY = 'notion2cli.bridge.token';
const LABEL_KEY = 'notion2cli.bridge.label';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Unknown error' }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'getBridgeStatus':
      return getBridgeStatus();
    case 'pairBridge':
      return pairBridge(message.code);
    case 'clearPairing':
      return clearPairing();
    case 'submitNotionAction':
      return submitNotionAction(message.payload);
    case 'getJobStatus':
      return getJobStatus(message.jobId);
    case 'resolveJobApproval':
      return resolveJobApproval(message.jobId, message.resolution);
    case 'openCodexApp':
      return openCodexApp();
    default:
      throw new Error(`Unknown message type: ${message?.type || 'undefined'}`);
  }
}

async function getBridgeStatus() {
  const token = await getStoredToken();
  const response = await fetchJson('/api/status', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  return {
    ...response,
    paired: Boolean(response.paired && token),
  };
}

async function pairBridge(code) {
  if (!code) {
    throw new Error('请输入 6 位配对码');
  }

  const payload = {
    code: String(code).trim(),
    clientLabel: 'Chrome Extension',
  };

  const response = await fetchJson('/api/pair/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  await chrome.storage.local.set({
    [STORAGE_KEY]: response.token,
    [LABEL_KEY]: response.clientLabel,
  });

  return response;
}

async function clearPairing() {
  await chrome.storage.local.remove([STORAGE_KEY, LABEL_KEY]);
  return { ok: true };
}

async function submitNotionAction(payload) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('浏览器尚未和本地 bridge 配对');
  }

  return fetchJson('/api/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function getJobStatus(jobId) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('浏览器尚未和本地 bridge 配对');
  }

  return fetchJson(`/api/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function resolveJobApproval(jobId, resolution) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('浏览器尚未和本地 bridge 配对');
  }

  return fetchJson(`/api/jobs/${jobId}/approval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resolution || {}),
  });
}

async function openCodexApp() {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('浏览器尚未和本地 bridge 配对');
  }

  return fetchJson('/api/session/open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function getStoredToken() {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return data[STORAGE_KEY] || null;
}

async function fetchJson(pathname, options = {}) {
  let response;

  try {
    response = await fetch(`${BRIDGE_ORIGIN}${pathname}`, options);
  } catch {
    throw new Error('无法连接本地 bridge。请确认 notion2CLI bridge 已启动。');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('bridge 返回了不可识别的数据');
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `bridge 请求失败（${response.status}）`);
  }

  return payload;
}

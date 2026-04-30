const BRIDGE_ORIGIN = 'http://127.0.0.1:43821';
const STORAGE_KEY = 'notion2cli.bridge.token';
const LABEL_KEY = 'notion2cli.bridge.label';

const BADGE_BG = {
  completed: '#16a34a',
  failed: '#dc2626',
  authorization_needed: '#f59e0b',
};
const BADGE_TEXT = {
  completed: 'OK',
  failed: '!',
  authorization_needed: '?',
};
const NOTIFICATION_TITLE = {
  completed: 'notion2CLI · Task completed',
  failed: 'notion2CLI · Task failed',
  authorization_needed: 'notion2CLI · Authorization needed',
};

const notificationTargets = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Unknown error' }));

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case 'getBridgeStatus':
      return getBridgeStatus();
    case 'pairBridge':
      return pairBridge(message.code);
    case 'clearPairing':
      return clearPairing();
    case 'submitNotionAction':
      return submitNotionAction(message.payload);
    case 'getPromptProfiles':
      return getPromptProfiles();
    case 'createPromptProfile':
      return createPromptProfile(message.profile);
    case 'updatePromptProfile':
      return updatePromptProfile(message.profileId, message.profile);
    case 'deletePromptProfile':
      return deletePromptProfile(message.profileId);
    case 'resetPromptProfile':
      return resetPromptProfile(message.profileId);
    case 'getJobStatus':
      return getJobStatus(message.jobId);
    case 'cancelJob':
      return cancelJob(message.jobId);
    case 'resolveJobApproval':
      return resolveJobApproval(message.jobId, message.resolution);
    case 'openCodexApp':
      return openCodexApp();
    case 'notifyJobEvent':
      return notifyJobEvent(message, sender);
    case 'clearJobBadge':
      return clearJobBadge(sender?.tab?.id);
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
    throw new Error('Enter the 6-digit pairing code');
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

async function getPromptProfiles() {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson('/api/prompt-profiles', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function createPromptProfile(profile) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson('/api/prompt-profiles', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profile || {}),
  });
}

async function updatePromptProfile(profileId, profile) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson(`/api/prompt-profiles/${encodeURIComponent(profileId || '')}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profile || {}),
  });
}

async function deletePromptProfile(profileId) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson(`/api/prompt-profiles/${encodeURIComponent(profileId || '')}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function resetPromptProfile(profileId) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson(`/api/prompt-profiles/${encodeURIComponent(profileId || '')}/reset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function submitNotionAction(payload) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
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
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson(`/api/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function cancelJob(jobId) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson(`/api/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function resolveJobApproval(jobId, resolution) {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('The browser is not paired with the local bridge');
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
    throw new Error('The browser is not paired with the local bridge');
  }

  return fetchJson('/api/session/open', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function notifyJobEvent(msg, sender) {
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  const event = msg?.event;

  if (event !== 'completed' && event !== 'failed' && event !== 'authorization_needed') {
    return { ok: false, reason: 'unknown_event' };
  }

  let hasPermission = false;
  try {
    hasPermission = await chrome.permissions.contains({ permissions: ['notifications'] });
  } catch {
    hasPermission = false;
  }

  const triedSystemNotification = Boolean(msg.shouldShowSystemNotification && hasPermission);
  let notificationShown = false;

  if (triedSystemNotification && chrome.notifications?.create) {
    const id = `n2c:${msg.jobId || 'unknown'}:${event}:${Date.now()}`;
    const message = `${msg.pageTitle || ''} - ${msg.summary || ''}`.slice(0, 200).trim();
    try {
      await new Promise((resolve, reject) => {
        chrome.notifications.create(
          id,
          {
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: NOTIFICATION_TITLE[event],
            message: message || NOTIFICATION_TITLE[event],
            priority: event === 'failed' ? 2 : 1,
            requireInteraction: event === 'authorization_needed',
          },
          () => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              reject(new Error(lastError.message));
              return;
            }
            resolve();
          },
        );
      });
      notificationTargets.set(id, { tabId, windowId, jobId: msg.jobId });
      notificationShown = true;
    } catch {
      notificationShown = false;
    }
  }

  const notificationFailed = triedSystemNotification && !notificationShown;
  const needBadge = Boolean(msg.pageHidden) || notificationFailed;

  if (tabId != null && needBadge) {
    try {
      await chrome.action.setBadgeText({ tabId, text: BADGE_TEXT[event] || '' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BG[event] || '#888' });
    } catch {}
  }

  return { ok: true, notificationShown, badgeSet: tabId != null && needBadge };
}

async function clearJobBadge(tabId) {
  if (tabId == null) {
    return { ok: true };
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch {}
  return { ok: true };
}

if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    const target = notificationTargets.get(id);
    if (target?.tabId != null) {
      try {
        if (target.windowId != null) {
          await chrome.windows.update(target.windowId, { focused: true });
        }
        await chrome.tabs.update(target.tabId, { active: true });
      } catch {
        try {
          const tabs = await chrome.tabs.query({
            url: ['*://www.notion.so/*', '*://notion.so/*'],
          });
          if (tabs[0]) {
            await chrome.tabs.update(tabs[0].id, { active: true });
          }
        } catch {}
      }
      await clearJobBadge(target.tabId);
    }
    notificationTargets.delete(id);
    try {
      chrome.notifications.clear(id);
    } catch {}
  });
}

if (chrome.notifications?.onClosed) {
  chrome.notifications.onClosed.addListener((id) => {
    notificationTargets.delete(id);
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
    throw new Error('Unable to connect to the local bridge. Make sure the notion2CLI bridge is running.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('bridge returned unrecognized data');
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `bridge request failed (${response.status})`);
  }

  return payload;
}

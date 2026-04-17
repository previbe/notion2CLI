const statusDot = document.querySelector('[data-status-dot]');
const statusValue = document.querySelector('[data-status-value]');
const statusHint = document.querySelector('[data-status-hint]');
const codeInput = document.querySelector('[data-code-input]');
const connectButton = document.querySelector('[data-connect-button]');
const clearButton = document.querySelector('[data-clear-button]');

connectButton.addEventListener('click', connectBridge);
clearButton.addEventListener('click', clearBridge);

refreshStatus();

async function refreshStatus() {
  try {
    const status = await sendMessage({ type: 'getBridgeStatus' });
    const paired = Boolean(status.paired);
    const standalone = Boolean(status.standalone);
    const connectedToClaude = paired && !standalone;

    statusDot.classList.toggle('ready', connectedToClaude);
    statusValue.textContent = connectedToClaude
      ? '已连接当前 Claude 会话'
      : paired && standalone
        ? '已连接本地调试模式'
        : status.awaitingPairCode
          ? '等待输入配对码'
          : '尚未连接';
    statusHint.textContent = connectedToClaude
      ? 'bridge 已就绪，可回到 Notion 页面直接点击按钮。'
      : paired && standalone
        ? '当前连到的是 standalone 模拟器。它不会把内容送进当前 Claude 会话。请先关闭 dev:standalone。'
        : status.awaitingPairCode
          ? 'Claude 已生成配对码。请把 6 位数字贴到下面。'
          : '先在 Claude Code 里运行 /notion2cli-connect。';
  } catch (error) {
    statusDot.classList.remove('ready');
    statusValue.textContent = '无法连接本地 bridge';
    statusHint.textContent = error.message || '请确认 Claude Code 会话或 standalone bridge 已启动。';
  }
}

async function connectBridge() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    statusValue.textContent = '配对码格式不正确';
    statusHint.textContent = '请输入 Claude Code 返回的 6 位数字。';
    return;
  }

  connectButton.disabled = true;
  connectButton.textContent = '连接中…';

  try {
    await sendMessage({ type: 'pairBridge', code });
    codeInput.value = '';
    await refreshStatus();
  } catch (error) {
    statusDot.classList.remove('ready');
    statusValue.textContent = '连接失败';
    statusHint.textContent = error.message || '请重新生成配对码后再试一次。';
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = '连接当前 Claude 会话';
  }
}

async function clearBridge() {
  await sendMessage({ type: 'clearPairing' });
  await refreshStatus();
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || '扩展通信失败'));
        return;
      }

      resolve(response.result);
    });
  });
}

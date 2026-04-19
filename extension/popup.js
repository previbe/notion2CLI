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
    const runtime = status.runtime || {};
    const paired = Boolean(status.paired);
    const runtimeReady = Boolean(runtime.ready);
    const connected = paired && runtimeReady;
    const runtimeLabel = runtime.label || '本地 runtime';

    statusDot.classList.toggle('ready', connected);
    statusValue.textContent = connected
      ? runtime.standalone
        ? `已连接 ${runtimeLabel}（调试）`
        : runtime.sessionAttached
          ? `已连接 ${runtimeLabel} 当前会话`
          : `已连接 ${runtimeLabel} bridge`
      : status.awaitingPairCode
        ? '等待输入配对码'
        : runtimeReady
          ? `尚未连接 ${runtimeLabel}`
          : runtime.statusMessage || '本地 runtime 未就绪';

    statusHint.textContent = connected
      ? runtime.standalone
        ? '当前连到的是 standalone 模拟器。浏览器会收到模拟结果，不会调用真实 Claude/Codex 运行时。'
        : runtime.sessionAttached
          ? 'bridge 已就绪，可回到 Notion 页面直接点击按钮。'
          : `bridge 已就绪，后续动作会通过 ${runtimeLabel} 的后台任务模式处理。`
      : status.awaitingPairCode
        ? 'bridge 已生成配对码。请把 6 位数字贴到下面。'
        : runtimeReady
          ? `先运行 ${runtime.pairingCommand || 'notion2cli pair'} 生成配对码。`
          : runtime.launchCommand
            ? `先启动 bridge：${runtime.launchCommand}`
            : (runtime.statusMessage || '请先启动 notion2CLI bridge。');
  } catch (error) {
    statusDot.classList.remove('ready');
    statusValue.textContent = '无法连接本地 bridge';
    statusHint.textContent = error.message || '请确认 notion2CLI bridge 已启动。';
  }
}

async function connectBridge() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    statusValue.textContent = '配对码格式不正确';
    statusHint.textContent = '请输入 bridge 返回的 6 位数字。';
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
    connectButton.textContent = '连接当前 bridge';
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

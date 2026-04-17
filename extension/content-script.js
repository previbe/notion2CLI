const state = {
  bridgeReady: false,
  bridgeMessage: '检查连接中',
  bridgeStandalone: false,
  currentJobId: null,
  pollTimer: null,
  latestReply: '',
};

const root = document.createElement('div');
root.id = 'n2c-root';
document.documentElement.appendChild(root);

root.innerHTML = `
  <div class="n2c-shell">
    <button class="n2c-fab" type="button">
      <span class="n2c-dot"></span>
      <span class="n2c-fab-text">
        <span class="n2c-fab-title">Run with Claude</span>
        <span class="n2c-fab-subtitle">正在检查连接…</span>
      </span>
    </button>

    <section class="n2c-menu n2c-hidden">
      <div class="n2c-card-header">
        <div class="n2c-kicker">Notion → Claude</div>
        <div class="n2c-card-title">把内容发给 Claude</div>
      </div>
      <div class="n2c-card-body">
        <div class="n2c-context" data-context>未选中文本，将默认按整页处理。</div>
        <button class="n2c-send" type="button" data-send>发送到 Claude</button>
        <div class="n2c-send-hint">Claude 会把选中文本或整页内容当作当前会话输入来回答。</div>
        <div class="n2c-meta">
          <span>当前页面：<strong data-page-title>读取中…</strong></span>
        </div>
      </div>
    </section>

    <section class="n2c-panel n2c-hidden">
      <div class="n2c-card-header">
        <div class="n2c-kicker">Claude Result</div>
        <div class="n2c-card-title">本次执行结果</div>
      </div>
      <div class="n2c-card-body">
        <div class="n2c-meta">
          <span class="n2c-status" data-run-status>
            <span class="n2c-spinner"></span>
            <span>等待执行</span>
          </span>
          <span data-job-id></span>
        </div>
        <div class="n2c-output n2c-empty" data-output>点击上面的动作后，Claude 的结果会显示在这里。</div>
        <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
      </div>
    </section>
  </div>
`;

const fab = root.querySelector('.n2c-fab');
const dot = root.querySelector('.n2c-dot');
const fabSubtitle = root.querySelector('.n2c-fab-subtitle');
const menu = root.querySelector('.n2c-menu');
const panel = root.querySelector('.n2c-panel');
const contextNode = root.querySelector('[data-context]');
const pageTitleNode = root.querySelector('[data-page-title]');
const sendButton = root.querySelector('[data-send]');
const runStatusNode = root.querySelector('[data-run-status]');
const jobIdNode = root.querySelector('[data-job-id]');
const outputNode = root.querySelector('[data-output]');
const copyButton = root.querySelector('[data-copy]');

bindEvents();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 15000);

function bindEvents() {
  fab.addEventListener('click', () => {
    updateContextText();
    menu.classList.toggle('n2c-hidden');
    panel.classList.remove('n2c-hidden');
  });

  sendButton.addEventListener('click', () => startAction());

  document.addEventListener('selectionchange', updateContextText);

  copyButton.addEventListener('click', async () => {
    if (!state.latestReply) {
      return;
    }

    await navigator.clipboard.writeText(state.latestReply);
    copyButton.textContent = '已复制';
    setTimeout(() => {
      copyButton.textContent = '复制结果';
    }, 1400);
  });
}

async function refreshBridgeStatus() {
  try {
    const response = await sendMessage({ type: 'getBridgeStatus' });
    state.bridgeStandalone = Boolean(response.standalone);
    state.bridgeReady = Boolean(response.paired) && !state.bridgeStandalone;
    state.bridgeMessage = response.paired
      ? state.bridgeStandalone
        ? '当前连接的是本地调试模式'
        : '已连接当前 Claude 会话'
      : response.awaitingPairCode
        ? '等待浏览器输入配对码'
        : '未连接';
  } catch (error) {
    state.bridgeReady = false;
    state.bridgeStandalone = false;
    state.bridgeMessage = error.message || '无法连接 bridge';
  }

  dot.classList.toggle('ready', state.bridgeReady);
  fabSubtitle.textContent = state.bridgeMessage;
  pageTitleNode.textContent = getPageTitle();
  updateContextText();
}

function updateContextText() {
  const selected = getSelectionText();

  if (state.bridgeStandalone) {
    contextNode.textContent = '当前浏览器连到的是 standalone 本地调试模式。它只会返回模拟结果，不会把内容送进当前 Claude 会话。请先关闭 dev:standalone。';
    return;
  }

  if (!state.bridgeReady) {
    contextNode.textContent = '浏览器还没有和当前 Claude 会话连接。先在 Claude 里运行 /notion2cli-connect，再去扩展弹窗输入配对码。';
    return;
  }

  if (selected) {
    contextNode.textContent = `将按选中文本执行，当前选中 ${selected.length} 个字符。`;
    return;
  }

  contextNode.textContent = '未选中文本，将默认按整页处理。';
}

async function startAction() {
  if (state.bridgeStandalone) {
    menu.classList.add('n2c-hidden');
    panel.classList.remove('n2c-hidden');
    renderJobState({
      status: 'failed',
      text: '当前连接的是 standalone 本地调试模式。它不会把消息送进当前 Claude 会话。请先关闭 dev:standalone 后重新配对。',
      jobId: '',
    });
    return;
  }

  menu.classList.add('n2c-hidden');
  panel.classList.remove('n2c-hidden');
  renderJobState({
    status: 'sending',
    text: '正在把内容发送给 Claude…',
    jobId: '',
  });

  try {
    const payload = {
      action: 'forward_raw_text',
      pageUrl: window.location.href,
      pageTitle: getPageTitle(),
      selectionText: getSelectionText(),
      snapshotText: getPageSnapshot(),
      source: 'chrome-extension',
    };

    const response = await sendMessage({
      type: 'submitNotionAction',
      payload,
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: '内容已发出，等待 Claude 回复…',
      jobId: response.jobId,
    });
    pollJob(response.jobId);
  } catch (error) {
    renderJobState({
      status: 'failed',
      text: error.message || '发送失败',
      jobId: '',
    });
  }
}

function pollJob(jobId) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const response = await sendMessage({
        type: 'getJobStatus',
        jobId,
      });

      const job = response.job;
      const statusText = statusLabel(job.status);
      renderJobState({
        status: job.status,
        text: job.replyText || job.error || statusText,
        jobId: job.id,
      });

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(state.pollTimer);
      }
    } catch (error) {
      renderJobState({
        status: 'failed',
        text: error.message || '读取任务状态失败',
        jobId,
      });
      clearInterval(state.pollTimer);
    }
  }, 1800);
}

function renderJobState({ status, text, jobId }) {
  jobIdNode.textContent = jobId ? `#${jobId.slice(0, 8)}` : '';

  const isTerminal = status === 'completed' || status === 'failed';
  const isFailure = status === 'failed';
  const statusMarkup = isTerminal
    ? `<span>${isFailure ? '执行失败' : '执行完成'}</span>`
    : `<span class="n2c-spinner"></span><span>${statusLabel(status)}</span>`;
  runStatusNode.innerHTML = statusMarkup;

  outputNode.textContent = text;
  outputNode.classList.toggle('n2c-empty', !text);
  state.latestReply = isFailure ? '' : text;
  copyButton.disabled = !state.latestReply;
}

function statusLabel(status) {
  switch (status) {
    case 'queued':
      return '已排队';
    case 'sent':
      return '等待 Claude 接收';
    case 'sending':
      return '发送中';
    case 'completed':
      return '执行完成';
    case 'failed':
      return '执行失败';
    default:
      return '处理中';
  }
}

function getSelectionText() {
  return window.getSelection()?.toString().trim() || '';
}

function getPageTitle() {
  return document.title.replace(/\s+\|\s+Notion$/, '').trim() || 'Untitled Notion Page';
}

function getPageSnapshot() {
  const source =
    document.querySelector('[role="main"]') ||
    document.querySelector('.notion-page-content') ||
    document.body;

  return normalizeText(source?.innerText || '').slice(0, 8000);
}

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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

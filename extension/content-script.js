const state = {
  bridgeReady: false,
  bridgeMessage: '检查连接中',
  bridgeStandalone: false,
  currentJobId: null,
  pollTimer: null,
  busy: false,
  latestReply: '',
  latestReplyJobId: null,
};

const NOTION_MCP_DOC_URL = 'https://developers.notion.com/guides/mcp/get-started-with-mcp';

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
        <div class="n2c-context" data-context>未选中文本，将通过 Notion MCP 读取整页。</div>
        <button class="n2c-send" type="button" data-send>发送整页（MCP）</button>
        <div class="n2c-send-hint" data-send-hint>选中文本时直接发送选区；未选中时，Claude 会通过 Notion MCP 读取当前页面全文。</div>
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
        <div class="n2c-actions">
          <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
          <button class="n2c-write" type="button" data-write disabled>写回 Notion</button>
        </div>
        <div class="n2c-write-hint">写回会通过 Notion MCP 追加一个新的 Markdown section，默认不覆盖页面原文。</div>
        <div class="n2c-install-card">
          <div class="n2c-install-title">Notion 官方 MCP</div>
          <a class="n2c-install-link" data-install-link href="${NOTION_MCP_DOC_URL}" target="_blank" rel="noreferrer">官方安装文档</a>
          <button class="n2c-install" type="button" data-install>安装</button>
        </div>
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
const sendHintNode = root.querySelector('[data-send-hint]');
const runStatusNode = root.querySelector('[data-run-status]');
const jobIdNode = root.querySelector('[data-job-id]');
const outputNode = root.querySelector('[data-output]');
const copyButton = root.querySelector('[data-copy]');
const writeButton = root.querySelector('[data-write]');
const installLinkNode = root.querySelector('[data-install-link]');
const installButton = root.querySelector('[data-install]');

bindEvents();
updateControls();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 15000);

function bindEvents() {
  fab.addEventListener('click', () => {
    updateContextText();
    menu.classList.toggle('n2c-hidden');
    panel.classList.remove('n2c-hidden');
  });

  sendButton.addEventListener('click', () => startAction());
  writeButton.addEventListener('click', () => writeLatestReply());
  installButton.addEventListener('click', () => sendInstallRequest());

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
  installLinkNode.href = NOTION_MCP_DOC_URL;
  updateContextText();
  updateControls();
}

function updateContextText() {
  const selected = getSelectionText();

  if (state.bridgeStandalone) {
    contextNode.textContent = '当前浏览器连到的是 standalone 本地调试模式。它只会返回模拟结果，不会把内容送进当前 Claude 会话。请先关闭 dev:standalone。';
    sendButton.textContent = '发送整页（MCP）';
    sendHintNode.textContent = 'standalone 模式不会调用 Claude，也不会通过 Notion MCP 读取或写回页面。';
    return;
  }

  if (!state.bridgeReady) {
    contextNode.textContent = '浏览器还没有和当前 Claude 会话连接。先在 Claude 里运行 /notion2cli-connect，再去扩展弹窗输入配对码。';
    sendButton.textContent = '发送整页（MCP）';
    sendHintNode.textContent = '整页读取和写回都依赖当前 Claude 会话中的 Notion MCP 连接。';
    return;
  }

  if (selected) {
    contextNode.textContent = `将按选中文本执行，当前选中 ${selected.length} 个字符。`;
    sendButton.textContent = '发送选中内容';
    sendHintNode.textContent = '选中文本直接来自浏览器选区；如果没有选区，Claude 会改为通过 Notion MCP 读取整页。';
    return;
  }

  contextNode.textContent = '未选中文本，将通过 Notion MCP 读取整页。';
  sendButton.textContent = '发送整页（MCP）';
  sendHintNode.textContent = '整页内容不再通过 DOM 抓取，而是由 Claude 使用 Notion MCP 读取当前页面。';
}

async function startAction() {
  if (state.bridgeStandalone) {
    menu.classList.add('n2c-hidden');
    panel.classList.remove('n2c-hidden');
    renderJobState({
      status: 'failed',
      text: '当前连接的是 standalone 本地调试模式。它不会把消息送进当前 Claude 会话。请先关闭 dev:standalone 后重新配对。',
      jobId: '',
      action: 'forward_full_page_via_mcp',
    });
    return;
  }

  const selectionText = getSelectionText();
  const action = selectionText ? 'forward_selection_text' : 'forward_full_page_via_mcp';

  menu.classList.add('n2c-hidden');
  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: selectionText
      ? '正在把选中文本发送给 Claude…'
      : '正在请求 Claude 通过 Notion MCP 读取当前页面…',
    jobId: '',
    action,
  });

  try {
    const payload = {
      action,
      pageUrl: window.location.href,
      pageTitle: getPageTitle(),
      selectionText,
      source: 'chrome-extension',
    };

    const response = await sendMessage({
      type: 'submitNotionAction',
      payload,
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: selectionText
        ? '选中文本已发出，等待 Claude 回复…'
        : '页面读取请求已发出，等待 Claude 通过 Notion MCP 完成处理…',
      jobId: response.jobId,
      action,
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    updateControls();
    renderJobState({
      status: 'failed',
      text: error.message || '发送失败',
      jobId: '',
      action,
    });
  }
}

async function writeLatestReply() {
  if (!state.latestReply || state.busy) {
    return;
  }

  if (state.bridgeStandalone) {
    panel.classList.remove('n2c-hidden');
    renderJobState({
      status: 'failed',
      text: 'standalone 本地调试模式不支持通过 Notion MCP 写回页面。',
      jobId: '',
      action: 'write_reply_to_notion',
    });
    return;
  }

  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: '正在请求 Claude 通过 Notion MCP 把结果写回当前页面…',
    jobId: '',
    action: 'write_reply_to_notion',
  });

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action: 'write_reply_to_notion',
        pageUrl: window.location.href,
        pageTitle: getPageTitle(),
        replyTextToWrite: state.latestReply,
        writeMode: 'append_markdown_section',
        writeSectionTitle: 'Claude Code',
        sourceReplyJobId: state.latestReplyJobId,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: '写回请求已发出，等待 Claude 通过 Notion MCP 完成追加…',
      jobId: response.jobId,
      action: 'write_reply_to_notion',
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    updateControls();
    renderJobState({
      status: 'failed',
      text: error.message || '写回失败',
      jobId: '',
      action: 'write_reply_to_notion',
    });
  }
}

async function sendInstallRequest() {
  if (state.busy || !state.bridgeReady || state.bridgeStandalone) {
    return;
  }

  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: '正在把 Notion MCP 安装请求发送到当前 Claude 会话…',
    jobId: '',
    action: 'install_notion_mcp',
  });

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action: 'install_notion_mcp',
        pageUrl: window.location.href,
        pageTitle: getPageTitle(),
        installPrompt: `按照以下 notion 官方文档完成 notion MCP 的安装与授权：${NOTION_MCP_DOC_URL}`,
        officialDocUrl: NOTION_MCP_DOC_URL,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: '安装请求已发出，等待 Claude 会话处理…',
      jobId: response.jobId,
      action: 'install_notion_mcp',
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    updateControls();
    renderJobState({
      status: 'failed',
      text: error.message || '发送安装请求失败',
      jobId: '',
      action: 'install_notion_mcp',
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
        action: job.action,
      });

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(state.pollTimer);
        state.busy = false;
        updateControls();
      }
    } catch (error) {
      renderJobState({
        status: 'failed',
        text: error.message || '读取任务状态失败',
        jobId,
        action: 'forward_full_page_via_mcp',
      });
      clearInterval(state.pollTimer);
      state.busy = false;
      updateControls();
    }
  }, 1800);
}

function renderJobState({ status, text, jobId, action }) {
  jobIdNode.textContent = jobId ? `#${jobId.slice(0, 8)}` : '';

  const isTerminal = status === 'completed' || status === 'failed';
  const isFailure = status === 'failed';
  const statusMarkup = isTerminal
    ? `<span>${isFailure ? '执行失败' : '执行完成'}</span>`
    : `<span class="n2c-spinner"></span><span>${statusLabel(status)}</span>`;
  runStatusNode.innerHTML = statusMarkup;

  outputNode.textContent = text;
  outputNode.classList.toggle('n2c-empty', !text);

  if (status === 'completed' && !isFailure && isReplyAction(action)) {
    state.latestReply = text;
    state.latestReplyJobId = jobId || null;
  }

  updateControls();
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

function updateControls() {
  sendButton.disabled = state.busy || !state.bridgeReady || state.bridgeStandalone;
  copyButton.disabled = !state.latestReply;
  writeButton.disabled = state.busy || !state.latestReply || !state.bridgeReady || state.bridgeStandalone;
  installButton.disabled = state.busy || !state.bridgeReady || state.bridgeStandalone;
}

function isReplyAction(action) {
  return action === 'forward_selection_text' || action === 'forward_full_page_via_mcp';
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

const state = {
  bridgeReady: false,
  bridgeMessage: '检查连接中',
  currentJobId: null,
  pollTimer: null,
  busy: false,
  approvalBusy: false,
  pendingApproval: null,
  latestReply: '',
  latestReplyJobId: null,
  writeMode: 'append_markdown_section',
  runtime: {
    id: 'unknown',
    label: 'Agent Runtime',
    ready: false,
    standalone: false,
    pairingCommand: 'notion2cli pair',
    launchCommand: '',
    statusMessage: '',
  },
  notionMcp: {
    status: 'unknown',
    detail: '',
  },
};

const NOTION_MCP_DOC_URL = 'https://developers.notion.com/guides/mcp/get-started-with-mcp';
const WRITE_MODE_STORAGE_KEY = 'notion2cli.writeMode';
const WRITE_MODE_APPEND_SECTION = 'append_markdown_section';
const WRITE_MODE_UPDATE_CONTENT = 'update_content';
const WRITE_MODE_REPLACE_CONTENT = 'replace_content';

const root = document.createElement('div');
root.id = 'n2c-root';
document.documentElement.appendChild(root);

root.innerHTML = `
  <div class="n2c-shell">
    <button class="n2c-fab" type="button">
      <span class="n2c-dot"></span>
      <span class="n2c-fab-text">
        <span class="n2c-fab-title">Run with notion2CLI</span>
        <span class="n2c-fab-subtitle">正在检查连接…</span>
      </span>
    </button>

    <section class="n2c-menu n2c-hidden">
      <div class="n2c-card-header">
        <div class="n2c-kicker">Notion → Local Agent</div>
        <div class="n2c-card-title">把内容发给本地 runtime</div>
      </div>
      <div class="n2c-card-body">
        <div class="n2c-context" data-context>未选中文本，将通过 Notion MCP 读取整页。</div>
        <button class="n2c-send" type="button" data-send>发送整页（MCP）</button>
        <div class="n2c-send-hint" data-send-hint>选中文本时直接发送选区；未选中时，本地 runtime 会通过 Notion MCP 读取当前页面全文。</div>
        <div class="n2c-meta">
          <span>当前页面：<strong data-page-title>读取中…</strong></span>
        </div>
      </div>
    </section>

    <section class="n2c-panel n2c-hidden">
      <div class="n2c-card-header">
        <div class="n2c-kicker">Agent Result</div>
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
        <div class="n2c-output n2c-empty" data-output>点击上面的动作后，本地 runtime 的结果会显示在这里。</div>
        <div class="n2c-approval n2c-hidden" data-approval>
          <div class="n2c-approval-title">需要你的确认</div>
          <div class="n2c-approval-message" data-approval-message>Codex 需要确认后才能继续。</div>
          <div class="n2c-approval-actions">
            <button class="n2c-approve" type="button" data-approve>允许继续</button>
            <button class="n2c-decline" type="button" data-decline>拒绝</button>
          </div>
        </div>
        <div class="n2c-actions">
          <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
          <button class="n2c-write" type="button" data-write disabled>写回 Notion</button>
        </div>
        <div class="n2c-write-config">
          <label class="n2c-write-label" for="n2c-write-mode">写回模式</label>
          <select class="n2c-write-select" id="n2c-write-mode" data-write-mode>
            <option value="append_markdown_section">追加为新 section</option>
            <option value="update_content">替换当前选中文本</option>
            <option value="replace_content">覆盖整页正文</option>
          </select>
        </div>
        <div class="n2c-write-hint" data-write-hint>写回会通过 Notion MCP 追加一个新的 Markdown section，默认不覆盖页面原文。</div>
        <div class="n2c-install-card">
          <div class="n2c-install-title" data-install-title>Notion MCP</div>
          <a class="n2c-install-link" data-install-link href="${NOTION_MCP_DOC_URL}" target="_blank" rel="noreferrer">官方安装文档</a>
          <div class="n2c-install-detail" data-install-detail>根据当前 runtime 选择安装方式。</div>
          <button class="n2c-install" type="button" data-install>安装</button>
        </div>
      </div>
    </section>
  </div>
`;

const dot = root.querySelector('.n2c-dot');
const fab = root.querySelector('.n2c-fab');
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
const approvalNode = root.querySelector('[data-approval]');
const approvalMessageNode = root.querySelector('[data-approval-message]');
const approveButton = root.querySelector('[data-approve]');
const declineButton = root.querySelector('[data-decline]');
const copyButton = root.querySelector('[data-copy]');
const writeButton = root.querySelector('[data-write]');
const writeModeSelect = root.querySelector('[data-write-mode]');
const writeHintNode = root.querySelector('[data-write-hint]');
const installTitleNode = root.querySelector('[data-install-title]');
const installLinkNode = root.querySelector('[data-install-link]');
const installDetailNode = root.querySelector('[data-install-detail]');
const installButton = root.querySelector('[data-install]');

bindEvents();
loadWriteModePreference();
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
  approveButton.addEventListener('click', () => submitApproval('accept'));
  declineButton.addEventListener('click', () => submitApproval('decline'));
  writeModeSelect.addEventListener('change', handleWriteModeChange);

  document.addEventListener('selectionchange', () => {
    updateContextText();
    updateWriteModeUi();
    updateControls();
  });

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
    state.runtime = response.runtime || state.runtime;
    state.notionMcp = response.notionMcp || state.notionMcp;
    state.bridgeReady = Boolean(response.paired) && Boolean(state.runtime.ready);
    state.bridgeMessage = formatBridgeMessage(response);
  } catch (error) {
    state.bridgeReady = false;
    state.runtime = {
      ...state.runtime,
      ready: false,
      standalone: false,
    };
    state.bridgeMessage = error.message || '无法连接 bridge';
  }

  dot.classList.toggle('ready', state.bridgeReady);
  fabSubtitle.textContent = state.bridgeMessage;
  pageTitleNode.textContent = getPageTitle();
  installLinkNode.href = NOTION_MCP_DOC_URL;
  updateInstallCard();
  updateContextText();
  updateWriteModeUi();
  updateControls();
}

function updateContextText() {
  const selected = getSelectionText();
  const runtimeLabel = state.runtime.label || '本地 runtime';
  const mcpHint = buildNotionMcpHint();

  if (!state.runtime.ready) {
    contextNode.textContent = state.runtime.statusMessage || '本地 runtime 还没有就绪。';
    sendButton.textContent = '发送整页（MCP）';
    sendHintNode.textContent = state.runtime.launchCommand
      ? `先启动 bridge：${state.runtime.launchCommand}`
      : '先启动 notion2CLI bridge。';
    return;
  }

  if (!state.bridgeReady) {
    contextNode.textContent = `浏览器还没有和 ${runtimeLabel} bridge 连接。先运行 ${state.runtime.pairingCommand || 'notion2cli pair'}，再去扩展弹窗输入配对码。`;
    sendButton.textContent = '发送整页（MCP）';
    sendHintNode.textContent = `整页读取和写回都依赖当前 runtime 里的 Notion MCP 连接。${mcpHint}`;
    return;
  }

  if (state.runtime.standalone) {
    contextNode.textContent = '当前连接的是 standalone 调试 runtime。动作会返回模拟结果，不会调用真实 Claude/Codex 或 Notion MCP。';
    sendButton.textContent = selected ? '发送选中内容（模拟）' : '发送整页（模拟）';
    sendHintNode.textContent = '这个模式只用于浏览器侧联调。';
    return;
  }

  if (selected) {
    contextNode.textContent = `将按选中文本执行，当前选中 ${selected.length} 个字符。`;
    sendButton.textContent = '发送选中内容';
    sendHintNode.textContent = `选中文本直接来自浏览器选区；如果没有选区，bridge 会改为通过 Notion MCP 读取整页。${mcpHint}`;
    return;
  }

  contextNode.textContent = '未选中文本，将通过 Notion MCP 读取整页。';
  sendButton.textContent = '发送整页（MCP）';
  sendHintNode.textContent = `整页内容不再通过 DOM 抓取，而是由 bridge 借当前 runtime 的 Notion MCP 预取统一的页面 bundle。${mcpHint}`;
}

async function startAction() {
  const selectionText = getSelectionText();
  const action = selectionText ? 'forward_selection_text' : 'forward_full_page_via_mcp';
  const runtimeLabel = state.runtime.label || '本地 runtime';

  menu.classList.add('n2c-hidden');
  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: selectionText
      ? `正在把选中文本发送给 ${runtimeLabel}…`
      : `正在请求 ${runtimeLabel} 通过 Notion MCP 读取当前页面…`,
    jobId: '',
    action,
  });

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action,
        pageUrl: window.location.href,
        pageTitle: getPageTitle(),
        selectionText,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: selectionText
        ? `选中文本已发出，等待 ${runtimeLabel} 回复…`
        : `页面读取请求已发出，等待 ${runtimeLabel} 通过 Notion MCP 完成处理…`,
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

  const writeMode = normalizeWriteMode(state.writeMode);
  const selectionText = getSelectionText();
  if (writeMode === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    renderJobState({
      status: 'failed',
      text: '“替换当前选中文本”模式需要你先在页面里选中要替换的原文。',
      jobId: '',
      action: 'write_reply_to_notion',
    });
    updateWriteModeUi();
    updateControls();
    return;
  }

  const runtimeLabel = state.runtime.label || '本地 runtime';
  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: buildWritePendingText(writeMode, runtimeLabel),
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
        selectionText,
        replyTextToWrite: state.latestReply,
        writeMode,
        writeSectionTitle: 'notion2CLI',
        sourceReplyJobId: state.latestReplyJobId,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: buildWriteWaitingText(writeMode, runtimeLabel),
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
  if (state.busy || !state.bridgeReady) {
    return;
  }

  const installCopy = getInstallCopy();
  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: installCopy.pendingText,
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
      text: installCopy.waitText,
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
        text: job.replyText || job.error || job.runtimeMeta?.pendingApproval?.message || statusText,
        jobId: job.id,
        action: job.action,
        runtimeMeta: job.runtimeMeta || {},
      });

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(state.pollTimer);
        state.busy = false;
        state.approvalBusy = false;
        updateControls();
      }
    } catch (error) {
      renderJobState({
        status: 'failed',
        text: error.message || '读取任务状态失败',
        jobId,
        action: 'forward_full_page_via_mcp',
        runtimeMeta: {},
      });
      clearInterval(state.pollTimer);
      state.busy = false;
      state.approvalBusy = false;
      updateControls();
    }
  }, 1800);
}

function renderJobState({ status, text, jobId, action, runtimeMeta = {} }) {
  jobIdNode.textContent = jobId ? `#${jobId.slice(0, 8)}` : '';

  const isTerminal = status === 'completed' || status === 'failed';
  const isFailure = status === 'failed';
  const isWaitingForApproval = status === 'waiting_for_approval';
  const statusMarkup = isTerminal
    ? `<span>${isFailure ? '执行失败' : '执行完成'}</span>`
    : isWaitingForApproval
      ? `<span>${statusLabel(status)}</span>`
      : `<span class="n2c-spinner"></span><span>${statusLabel(status)}</span>`;
  runStatusNode.innerHTML = statusMarkup;

  outputNode.textContent = text;
  outputNode.classList.toggle('n2c-empty', !text);
  syncApprovalState(status, runtimeMeta.pendingApproval || null);

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
    case 'dispatched':
      return '已发出';
    case 'running':
      return '处理中';
    case 'waiting_for_approval':
      return '等待确认';
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
  const requiresSelectionForWrite = state.writeMode === WRITE_MODE_UPDATE_CONTENT;
  const hasSelectionForWrite = Boolean(getSelectionText());
  sendButton.disabled = state.busy || !state.bridgeReady;
  copyButton.disabled = !state.latestReply;
  writeButton.disabled = state.busy
    || !state.latestReply
    || !state.bridgeReady
    || (requiresSelectionForWrite && !hasSelectionForWrite);
  installButton.disabled = state.busy || !state.bridgeReady || isInstallSatisfied();
  approveButton.disabled = !state.pendingApproval || state.approvalBusy;
  declineButton.disabled = !state.pendingApproval || state.approvalBusy;
}

function isReplyAction(action) {
  return action === 'forward_selection_text' || action === 'forward_full_page_via_mcp';
}

function formatBridgeMessage(response) {
  const runtime = response.runtime || {};
  const runtimeLabel = runtime.label || '本地 runtime';

  if (response.paired && runtime.ready) {
    if (runtime.standalone) {
      return '已连接 standalone 调试 runtime';
    }

    return `已连接 ${runtimeLabel} bridge`;
  }

  if (response.awaitingPairCode) {
    return '等待浏览器输入配对码';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || '本地 runtime 未就绪';
  }

  return '未连接';
}

function buildNotionMcpHint() {
  switch (state.notionMcp.status) {
    case 'configured':
      return '';
    case 'unauthenticated':
      return ' 当前 runtime 还没有完成 Notion MCP 授权。';
    case 'missing':
      return ' 当前 runtime 还没检测到 Notion MCP 配置。';
    case 'unavailable':
      return ' 当前模式不会调用真实 Notion MCP。';
    default:
      return ' Notion MCP 状态暂时无法自动确认。';
  }
}

function updateInstallCard() {
  const copy = getInstallCopy();
  installTitleNode.textContent = copy.title;
  installDetailNode.textContent = copy.detail;
  installButton.textContent = copy.button;
}

function getInstallCopy() {
  const runtimeLabel = state.runtime.label || '当前 runtime';

  if (state.runtime.id === 'claude') {
    return {
      title: '安装到 Claude Code',
      detail: '点击后 bridge 会直接检查并执行 Claude Code 所需的 Notion MCP 配置与授权步骤。',
      button: '安装到 Claude Code',
      pendingText: '正在为 Claude Code 配置 Notion MCP…',
      waitText: '安装请求已发出，等待 Claude Code 完成配置…',
    };
  }

  if (state.runtime.id === 'codex') {
    if (state.notionMcp.status === 'configured') {
      return {
        title: '安装到 Codex CLI',
        detail: state.notionMcp.detail || 'Codex CLI 已配置 Notion MCP。',
        button: 'Codex 已配置',
        pendingText: 'Codex CLI 的 Notion MCP 已就绪。',
        waitText: 'Codex CLI 的 Notion MCP 已就绪。',
      };
    }

    if (state.notionMcp.status === 'unauthenticated') {
      return {
        title: '登录 Codex CLI 的 Notion MCP',
        detail: state.notionMcp.detail || '点击后会直接执行 codex mcp login notion，完成授权后结果会回传到这里。',
        button: '登录到 Codex CLI',
        pendingText: '正在为 Codex CLI 执行 Notion MCP 登录…',
        waitText: '登录请求已发出，等待 Codex CLI 完成授权…',
      };
    }

    return {
      title: '安装到 Codex CLI',
      detail: '点击后 bridge 会直接执行 codex mcp add notion；如果需要 OAuth，会按 Codex CLI 的流程继续授权。',
      button: '安装到 Codex CLI',
      pendingText: '正在为 Codex CLI 安装 Notion MCP…',
      waitText: '安装请求已发出，等待 Codex CLI 完成配置…',
    };
  }

  if (state.runtime.standalone) {
    return {
      title: 'Notion MCP（调试模式）',
      detail: 'standalone 调试模式不会调用真实 Notion MCP。',
      button: '调试模式不可用',
      pendingText: 'standalone 调试模式不会执行真实安装。',
      waitText: 'standalone 调试模式不会执行真实安装。',
    };
  }

  return {
    title: `安装到 ${runtimeLabel}`,
    detail: '根据当前 runtime 选择安装方式。',
    button: '安装',
    pendingText: `正在把 Notion MCP 安装请求发送到 ${runtimeLabel}…`,
    waitText: `安装请求已发出，等待 ${runtimeLabel} 处理…`,
  };
}

function isInstallSatisfied() {
  return state.runtime.id === 'codex' && state.notionMcp.status === 'configured';
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

async function submitApproval(action) {
  if (!state.pendingApproval || !state.currentJobId || state.approvalBusy) {
    return;
  }

  state.approvalBusy = true;
  updateControls();

  try {
    await sendMessage({
      type: 'resolveJobApproval',
      jobId: state.currentJobId,
      resolution: {
        action,
      },
    });

    state.pendingApproval = null;
    state.approvalBusy = false;
    renderJobState({
      status: 'running',
      text: action === 'accept'
        ? '已允许 Codex 继续执行，等待最终结果…'
        : '已拒绝当前请求，等待 Codex 结束本次执行…',
      jobId: state.currentJobId,
      action: 'write_reply_to_notion',
      runtimeMeta: {},
    });
  } catch (error) {
    state.approvalBusy = false;
    renderJobState({
      status: 'failed',
      text: error.message || '提交确认失败',
      jobId: state.currentJobId,
      action: 'write_reply_to_notion',
      runtimeMeta: {},
    });
  }
}

function syncApprovalState(status, pendingApproval) {
  if (status === 'waiting_for_approval' && pendingApproval) {
    state.pendingApproval = pendingApproval;
    approvalNode.classList.remove('n2c-hidden');
    approvalMessageNode.textContent = buildApprovalMessage(pendingApproval);
    updateControls();
    return;
  }

  state.pendingApproval = null;
  approvalNode.classList.add('n2c-hidden');
  approvalMessageNode.textContent = 'Codex 需要确认后才能继续。';
  updateControls();
}

function buildApprovalMessage(pendingApproval) {
  const base = pendingApproval.message || 'Codex 需要你的确认才能继续。';
  if (pendingApproval.mode === 'url' && pendingApproval.url) {
    return `${base} 如有需要，请在新标签页打开：${pendingApproval.url}`;
  }

  return base;
}

async function loadWriteModePreference() {
  try {
    const data = await chrome.storage.local.get([WRITE_MODE_STORAGE_KEY]);
    state.writeMode = normalizeWriteMode(data[WRITE_MODE_STORAGE_KEY]);
  } catch {
    state.writeMode = WRITE_MODE_APPEND_SECTION;
  }

  updateWriteModeUi();
  updateControls();
}

async function handleWriteModeChange() {
  state.writeMode = normalizeWriteMode(writeModeSelect.value);
  updateWriteModeUi();
  updateControls();

  try {
    await chrome.storage.local.set({
      [WRITE_MODE_STORAGE_KEY]: state.writeMode,
    });
  } catch {}
}

function normalizeWriteMode(mode) {
  switch (mode) {
    case WRITE_MODE_UPDATE_CONTENT:
    case WRITE_MODE_REPLACE_CONTENT:
      return mode;
    default:
      return WRITE_MODE_APPEND_SECTION;
  }
}

function updateWriteModeUi() {
  state.writeMode = normalizeWriteMode(state.writeMode);
  writeModeSelect.value = state.writeMode;
  const selectionText = getSelectionText();
  const copy = getWriteModeCopy(state.writeMode, selectionText);
  writeHintNode.textContent = copy.hint;
  writeHintNode.classList.toggle('n2c-write-hint-danger', copy.tone === 'danger');
}

function getWriteModeCopy(mode, selectionText) {
  if (mode === WRITE_MODE_UPDATE_CONTENT) {
    return {
      tone: selectionText ? 'default' : 'warning',
      hint: selectionText
        ? `会通过 Notion MCP 把你当前选中的原文替换为新的结果。当前已选中 ${selectionText.length} 个字符。`
        : '会通过 Notion MCP 精确替换你当前选中的原文。请先在页面里选中要替换的文本。',
    };
  }

  if (mode === WRITE_MODE_REPLACE_CONTENT) {
    return {
      tone: 'danger',
      hint: '会通过 Notion MCP 覆盖整页正文内容。这是破坏性操作，请确认你真的想整页重写。',
    };
  }

  return {
    tone: 'default',
    hint: '会通过 Notion MCP 在当前页面末尾追加一个新的 Markdown section，默认不覆盖页面原文。',
  };
}

function buildWritePendingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `正在请求 ${runtimeLabel} 通过 Notion MCP 替换当前选中的原文…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `正在请求 ${runtimeLabel} 通过 Notion MCP 覆盖当前页面正文…`;
    default:
      return `正在请求 ${runtimeLabel} 通过 Notion MCP 把结果追加回当前页面…`;
  }
}

function buildWriteWaitingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `替换请求已发出，等待 ${runtimeLabel} 通过 Notion MCP 完成精确替换…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `整页替换请求已发出，等待 ${runtimeLabel} 通过 Notion MCP 完成覆盖…`;
    default:
      return `写回请求已发出，等待 ${runtimeLabel} 通过 Notion MCP 完成追加…`;
  }
}

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
    label: '本地 Agent',
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
        <span class="n2c-fab-title">发送到本地 Agent</span>
        <span class="n2c-fab-subtitle">正在检查连接…</span>
      </span>
    </button>

    <section class="n2c-menu n2c-hidden">
      <div class="n2c-card-header">
        <div class="n2c-kicker">Current Page</div>
        <div class="n2c-card-title">发送与结果</div>
      </div>
      <div class="n2c-card-body">
        <div class="n2c-context" data-context>正在检查当前页面状态。</div>
        <div class="n2c-page-meta">
          <div class="n2c-meta-label">当前页面</div>
          <div class="n2c-page-title" data-page-title>读取中…</div>
        </div>
        <button class="n2c-send" type="button" data-send>发送当前页</button>
        <div class="n2c-send-hint" data-send-hint>未选中时会发送当前页；选中后会优先发送选中内容。</div>
        <div class="n2c-setup-tip n2c-hidden" data-setup-tip>连接、授权和修复都在浏览器工具栏里的 notion2CLI 弹窗里完成。</div>
        <div class="n2c-section-divider"></div>
        <div class="n2c-meta">
          <span class="n2c-status" data-run-status>
            <span class="n2c-spinner"></span>
            <span>还没有开始</span>
          </span>
          <span data-job-id></span>
        </div>
        <div class="n2c-output n2c-empty" data-output>发送后，这次结果会显示在这里。你可以复制结果，或直接写回当前 Notion 页面。</div>
        <div class="n2c-approval n2c-hidden" data-approval>
          <div class="n2c-approval-title">需要你的确认</div>
          <div class="n2c-approval-message" data-approval-message>Codex 需要确认后才能继续。</div>
          <div class="n2c-approval-actions">
            <button class="n2c-approve" type="button" data-approve>允许继续</button>
            <button class="n2c-decline" type="button" data-decline>拒绝</button>
          </div>
        </div>
        <div class="n2c-actions">
          <button class="n2c-write" type="button" data-write disabled>写回 Notion</button>
          <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
        </div>
        <div class="n2c-write-config">
          <label class="n2c-write-label" for="n2c-write-mode">写回模式</label>
          <select class="n2c-write-select" id="n2c-write-mode" data-write-mode>
            <option value="append_markdown_section">追加到页面末尾</option>
            <option value="update_content">替换当前选中内容</option>
            <option value="replace_content">覆盖页面正文</option>
          </select>
        </div>
        <div class="n2c-write-hint" data-write-hint>会把结果追加到当前页末尾，不会改动原文。</div>
      </div>
    </section>
  </div>
`;

const dot = root.querySelector('.n2c-dot');
const fab = root.querySelector('.n2c-fab');
const fabSubtitle = root.querySelector('.n2c-fab-subtitle');
const menu = root.querySelector('.n2c-menu');
const panel = menu;
const contextNode = root.querySelector('[data-context]');
const pageTitleNode = root.querySelector('[data-page-title]');
const sendButton = root.querySelector('[data-send]');
const sendHintNode = root.querySelector('[data-send-hint]');
const setupTipNode = root.querySelector('[data-setup-tip]');
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

bindEvents();
loadWriteModePreference();
updateControls();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 15000);

function bindEvents() {
  fab.addEventListener('click', () => {
    updateContextText();
    menu.classList.toggle('n2c-hidden');
  });

  sendButton.addEventListener('click', () => startAction());
  writeButton.addEventListener('click', () => writeLatestReply());
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
  updateContextText();
  updateWriteModeUi();
  updateControls();
}

function updateContextText() {
  const selected = getSelectionText();
  const runtimeLabel = state.runtime.label || '本地 Agent';
  const setupTip = buildSetupTip();

  setupTipNode.textContent = setupTip || '';
  setupTipNode.classList.toggle('n2c-hidden', !setupTip);

  if (!state.runtime.ready) {
    contextNode.textContent = state.runtime.statusMessage || '本地 Agent 还没有准备好。';
    sendButton.textContent = '发送当前页';
    sendHintNode.textContent = state.runtime.launchCommand
      ? `先在工具栏弹窗里启动：${state.runtime.launchCommand}`
      : '先在工具栏弹窗里完成启动。';
    return;
  }

  if (!state.bridgeReady) {
    contextNode.textContent = `这个页面还没有连到 ${runtimeLabel}。`;
    sendButton.textContent = '完成连接后可发送';
    sendHintNode.textContent = '先在工具栏弹窗里输入 6 位配对码，连接完成后再回来发送。';
    return;
  }

  if (state.runtime.standalone) {
    contextNode.textContent = '当前是调试模式。发送与写回都会返回模拟结果，不会调用真实 Notion MCP。';
    sendButton.textContent = selected ? '发送选中内容（调试）' : '发送当前页（调试）';
    sendHintNode.textContent = '适合联调流程，不适合正式写回。';
    return;
  }

  if (selected) {
    contextNode.textContent = `将发送你当前选中的内容（${selected.length} 个字符）。`;
    sendButton.textContent = '发送选中内容';
    sendHintNode.textContent = canUseNotionAccess()
      ? '这次只处理选中内容；如果你取消选中，这里会自动改为发送当前页。'
      : '选中内容现在就能发送；要发送整页或写回结果，还需要先在弹窗里启用 Notion MCP。';
    return;
  }

  if (!canUseNotionAccess()) {
    contextNode.textContent = '当前页还不能直接发送。';
    sendButton.textContent = '发送当前页';
    sendHintNode.textContent = '先在弹窗里启用 Notion MCP，或者先选中一段文字再发送。';
    return;
  }

  contextNode.textContent = '将发送当前页，让本地 Agent 阅读页面正文与相关图片。';
  sendButton.textContent = '发送当前页';
  sendHintNode.textContent = '如果你先选中内容，这里会自动改为只发送选中部分。';
}

async function startAction() {
  const selectionText = getSelectionText();
  const action = selectionText ? 'forward_selection_text' : 'forward_full_page_via_mcp';
  const runtimeLabel = state.runtime.label || '本地 Agent';

  menu.classList.add('n2c-hidden');
  panel.classList.remove('n2c-hidden');
  state.busy = true;
  updateControls();
  renderJobState({
    status: 'sending',
    text: selectionText
      ? `正在把选中内容交给 ${runtimeLabel}…`
      : `正在把当前页交给 ${runtimeLabel}…`,
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
        ? `选中内容已发出，等待 ${runtimeLabel} 返回结果…`
        : `当前页已发出，等待 ${runtimeLabel} 返回结果…`,
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

  const runtimeLabel = state.runtime.label || '本地 Agent';
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
  const selectionText = getSelectionText();
  const requiresSelectionForWrite = state.writeMode === WRITE_MODE_UPDATE_CONTENT;
  const hasSelectionForWrite = Boolean(selectionText);
  const canSendCurrentState = Boolean(selectionText) || canUseNotionAccess();

  sendButton.disabled = state.busy || !state.bridgeReady || !canSendCurrentState;
  copyButton.disabled = !state.latestReply;
  writeButton.disabled = state.busy
    || !state.latestReply
    || !state.bridgeReady
    || !canUseNotionAccess()
    || (requiresSelectionForWrite && !hasSelectionForWrite);
  approveButton.disabled = !state.pendingApproval || state.approvalBusy;
  declineButton.disabled = !state.pendingApproval || state.approvalBusy;
}

function isReplyAction(action) {
  return action === 'forward_selection_text' || action === 'forward_full_page_via_mcp';
}

function formatBridgeMessage(response) {
  const runtime = response.runtime || {};
  const runtimeLabel = runtime.label || '本地 Agent';

  if (response.paired && runtime.ready) {
    if (runtime.standalone) {
      return '已连接调试模式';
    }

    return `已连接 ${runtimeLabel}`;
  }

  if (response.awaitingPairCode) {
    return '等待输入 6 位配对码';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || '本地 Agent 未就绪';
  }

  return '打开扩展完成连接';
}

function canUseNotionAccess() {
  if (state.runtime.standalone) {
    return true;
  }

  return !['missing', 'unauthenticated', 'unavailable'].includes(state.notionMcp.status);
}

function buildSetupTip() {
  if (!state.runtime.ready) {
    return state.runtime.launchCommand
      ? `连接、授权和修复都在浏览器工具栏里的 notion2CLI 弹窗里完成。先启动：${state.runtime.launchCommand}`
      : '连接、授权和修复都在浏览器工具栏里的 notion2CLI 弹窗里完成。';
  }

  if (!state.bridgeReady) {
    return '先去浏览器工具栏里的 notion2CLI 弹窗输入 6 位配对码。';
  }

  if (state.runtime.standalone) {
    return '';
  }

  switch (state.notionMcp.status) {
    case 'missing':
      return '要发送当前页或写回结果，请先在工具栏弹窗里启用 Notion MCP。';
    case 'unauthenticated':
      return '要发送当前页或写回结果，请先在工具栏弹窗里完成 Notion MCP 授权。';
    case 'unavailable':
      return '当前模式不会调用真实 Notion MCP。切换到真实 runtime 后再继续。';
    default:
      return '';
  }
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
  const gatedHint = buildWriteAccessHint();
  writeHintNode.textContent = gatedHint ? `${copy.hint} ${gatedHint}` : copy.hint;
  writeHintNode.classList.toggle('n2c-write-hint-danger', copy.tone === 'danger' || Boolean(gatedHint));
}

function getWriteModeCopy(mode, selectionText) {
  if (mode === WRITE_MODE_UPDATE_CONTENT) {
    return {
      tone: selectionText ? 'default' : 'warning',
      hint: selectionText
        ? `会把你当前选中的内容替换为新的结果。当前已选中 ${selectionText.length} 个字符。`
        : '会精确替换你当前选中的内容。请先在页面里选中要替换的文本。',
    };
  }

  if (mode === WRITE_MODE_REPLACE_CONTENT) {
    return {
      tone: 'danger',
      hint: '会用新的结果覆盖页面正文。这是高风险操作，请确认你真的想整页重写。',
    };
  }

  return {
    tone: 'default',
    hint: '会把结果追加到当前页末尾，不会改动原文。',
  };
}

function buildWriteAccessHint() {
  if (state.runtime.standalone || canUseNotionAccess()) {
    return '';
  }

  if (state.notionMcp.status === 'unauthenticated') {
    return '写回前请先在工具栏弹窗里完成 Notion MCP 授权。';
  }

  if (state.notionMcp.status === 'missing') {
    return '写回前请先在工具栏弹窗里启用 Notion MCP。';
  }

  return '写回能力当前不可用，请先在工具栏弹窗里修复连接。';
}

function buildWritePendingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `正在请求 ${runtimeLabel} 替换当前选中的内容…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `正在请求 ${runtimeLabel} 覆盖当前页面正文…`;
    default:
      return `正在请求 ${runtimeLabel} 把结果追加回当前页面…`;
  }
}

function buildWriteWaitingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `替换请求已发出，等待 ${runtimeLabel} 完成精确替换…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `整页替换请求已发出，等待 ${runtimeLabel} 完成覆盖…`;
    default:
      return `写回请求已发出，等待 ${runtimeLabel} 完成追加…`;
  }
}

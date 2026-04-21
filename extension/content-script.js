const WRITE_MODE_STORAGE_KEY = 'notion2cli.writeMode';
const WRITE_MODE_APPEND_SECTION = 'append_markdown_section';
const WRITE_MODE_UPDATE_CONTENT = 'update_content';
const WRITE_MODE_REPLACE_CONTENT = 'replace_content';

const ACTION_FORWARD_SELECTION = 'forward_selection_text';
const ACTION_FORWARD_FULL_PAGE = 'forward_full_page_via_mcp';
const ACTION_WRITE_REPLY = 'write_reply_to_notion';

const state = {
  bridgeReady: false,
  bridgeMessage: '检查连接中',
  expanded: false,
  currentJobId: null,
  currentAction: '',
  pollTimer: null,
  busy: false,
  approvalBusy: false,
  pendingApproval: null,
  latestReply: '',
  latestBrief: '',
  latestReplyJobId: null,
  writeMode: WRITE_MODE_APPEND_SECTION,
  lastSubmission: {
    action: '',
    pageUrl: '',
    pageTitle: '',
    selectionText: '',
  },
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

const root = document.createElement('div');
root.id = 'n2c-root';
document.documentElement.appendChild(root);

root.innerHTML = `
  <div class="n2c-shell">
    <section class="n2c-menu" aria-hidden="true">
      <div class="n2c-sheet-header">
        <div class="n2c-strip-status">
          <span class="n2c-dot" data-bridge-dot></span>
          <span class="n2c-strip-label" data-strip-label>未连接本地 CLI</span>
        </div>
        <button class="n2c-strip-toggle" type="button" data-close-sheet aria-label="收起 Activity">
          <span class="n2c-chevron n2c-chevron-down"></span>
        </button>
      </div>
      <div class="n2c-sheet-paper">
        <div class="n2c-card-body">
          <div class="n2c-page-meta">
            <div class="n2c-meta-label">当前页面</div>
            <div class="n2c-page-title" data-page-title>读取中…</div>
          </div>
          <button class="n2c-send" type="button" data-send>发送当前页</button>
          <div class="n2c-send-hint" data-send-hint>会先处理当前页，完成后自动写回当前 Notion 页面。</div>
          <div class="n2c-section-divider"></div>
          <div class="n2c-meta">
            <span class="n2c-status" data-run-status>
              <span class="n2c-spinner"></span>
              <span>还没有开始</span>
            </span>
            <span class="n2c-job-id" data-job-id></span>
          </div>
          <div class="n2c-activity-note n2c-empty" data-activity-note>发送后，执行进度、授权请求和自动写回状态会显示在这里。</div>
          <div class="n2c-approval n2c-hidden" data-approval>
            <div class="n2c-approval-title">需要你的确认</div>
            <div class="n2c-approval-message" data-approval-message>Codex 需要确认后才能继续。</div>
            <div class="n2c-approval-actions">
              <button class="n2c-approve" type="button" data-approve>允许继续</button>
              <button class="n2c-decline" type="button" data-decline>拒绝</button>
            </div>
          </div>
          <div class="n2c-brief-head">
            <div class="n2c-meta-label">BRIEF</div>
            <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
          </div>
          <div class="n2c-output n2c-empty" data-output>运行完成后，这里的 brief 会保留刚刚完成动作的总结。</div>
        </div>
      </div>
    </section>

    <button class="n2c-fab" type="button" aria-expanded="false" aria-controls="n2c-activity-sheet">
      <span class="n2c-strip-status">
        <span class="n2c-dot" data-bridge-dot></span>
        <span class="n2c-strip-label" data-strip-label>未连接本地 CLI</span>
      </span>
      <span class="n2c-strip-toggle" aria-hidden="true">
        <span class="n2c-chevron n2c-chevron-up"></span>
      </span>
    </button>
  </div>
`;

const shell = root.querySelector('.n2c-shell');
const statusDots = [...root.querySelectorAll('[data-bridge-dot]')];
const stripLabelNodes = [...root.querySelectorAll('[data-strip-label]')];
const fab = root.querySelector('.n2c-fab');
const menu = root.querySelector('.n2c-menu');
menu.id = 'n2c-activity-sheet';
const closeSheetButton = root.querySelector('[data-close-sheet]');
const pageTitleNode = root.querySelector('[data-page-title]');
const sendButton = root.querySelector('[data-send]');
const sendHintNode = root.querySelector('[data-send-hint]');
const runStatusNode = root.querySelector('[data-run-status]');
const jobIdNode = root.querySelector('[data-job-id]');
const activityNoteNode = root.querySelector('[data-activity-note]');
const outputNode = root.querySelector('[data-output]');
const approvalNode = root.querySelector('[data-approval]');
const approvalMessageNode = root.querySelector('[data-approval-message]');
const approveButton = root.querySelector('[data-approve]');
const declineButton = root.querySelector('[data-decline]');
const copyButton = root.querySelector('[data-copy]');

bindEvents();
pageTitleNode.textContent = getPageTitle();
renderBrief();
loadWriteModePreference();
updateActionCopy();
updateControls();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 15000);

function bindEvents() {
  fab.addEventListener('click', () => {
    pageTitleNode.textContent = getPageTitle();
    updateActionCopy();
    renderBrief();
    setExpanded(!state.expanded);
  });

  closeSheetButton.addEventListener('click', () => setExpanded(false));
  sendButton.addEventListener('click', () => startAction());
  approveButton.addEventListener('click', () => submitApproval('accept'));
  declineButton.addEventListener('click', () => submitApproval('decline'));

  document.addEventListener('selectionchange', () => {
    updateActionCopy();
    updateControls();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !Object.hasOwn(changes, WRITE_MODE_STORAGE_KEY)) {
      return;
    }

    state.writeMode = normalizeWriteMode(changes[WRITE_MODE_STORAGE_KEY].newValue);
    updateActionCopy();
    updateControls();
  });

  copyButton.addEventListener('click', async () => {
    const text = state.latestBrief || state.latestReply;
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    copyButton.textContent = '已复制';
    setTimeout(() => {
      copyButton.textContent = '复制结果';
    }, 1400);
  });
}

function setExpanded(nextExpanded) {
  state.expanded = Boolean(nextExpanded);
  shell.classList.toggle('n2c-shell-expanded', state.expanded);
  menu.setAttribute('aria-hidden', state.expanded ? 'false' : 'true');
  fab.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
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

  statusDots.forEach((node) => node.classList.toggle('ready', state.bridgeReady));
  const stripLabel = state.bridgeReady ? 'Activity' : '未连接本地 CLI';
  stripLabelNodes.forEach((node) => {
    node.textContent = stripLabel;
  });
  pageTitleNode.textContent = getPageTitle();
  updateActionCopy();
  updateControls();
}

function updateActionCopy() {
  const selected = getSelectionText();
  const writeMode = normalizeWriteMode(state.writeMode);

  if (!state.runtime.ready) {
    sendButton.textContent = '发送当前页';
    sendHintNode.textContent = state.runtime.launchCommand
      ? `先在扩展弹窗里启动 CLI：${state.runtime.launchCommand}`
      : '先在扩展弹窗里启动 CLI。';
    return;
  }

  if (!state.bridgeReady) {
    sendButton.textContent = '完成连接后可发送';
    sendHintNode.textContent = '先在扩展弹窗里生成并输入 6 位配对码，连接完成后再回来发送。';
    return;
  }

  if (writeMode === WRITE_MODE_UPDATE_CONTENT && !selected) {
    sendButton.textContent = '先选中要替换的内容';
    sendHintNode.textContent = '当前插件配置为“替换当前选中内容”。请先在页面里选中原文，再发送给本地 Agent。';
    return;
  }

  if (!canAttemptNotionFlow()) {
    sendButton.textContent = '发送当前页';
    sendHintNode.textContent = '自动写回需要 Notion MCP。请先在扩展弹窗里启用 Notion MCP，再回来发送。';
    return;
  }

  if (state.runtime.standalone) {
    sendButton.textContent = selected ? '发送选中内容（调试）' : '发送当前页（调试）';
    sendHintNode.textContent = selected
      ? '会先处理选中内容，生成模拟 brief，并模拟写回当前页面。'
      : '会先处理当前页，生成模拟 brief，并模拟写回当前页面。';
    return;
  }

  if (selected) {
    sendButton.textContent = '发送选中内容';
    sendHintNode.textContent = buildAutoWriteHint({
      hasSelection: true,
      writeMode,
      pendingAuth: state.notionMcp.status === 'unauthenticated',
    });
    return;
  }

  sendButton.textContent = '发送当前页';
  sendHintNode.textContent = buildAutoWriteHint({
    hasSelection: false,
    writeMode,
    pendingAuth: state.notionMcp.status === 'unauthenticated',
  });
}

function buildAutoWriteHint({ hasSelection, writeMode, pendingAuth }) {
  let hint;

  if (writeMode === WRITE_MODE_UPDATE_CONTENT) {
    hint = '会先处理你选中的内容，完成后自动替换这段原文。';
  } else if (writeMode === WRITE_MODE_REPLACE_CONTENT) {
    hint = hasSelection
      ? '会先处理你选中的内容，完成后自动覆盖当前页面正文。请谨慎操作。'
      : '会先处理当前页，完成后自动覆盖当前页面正文。请谨慎操作。';
  } else {
    hint = hasSelection
      ? '会先处理选中内容，完成后自动追加到当前 Notion 页面末尾。'
      : '会先处理当前页，完成后自动追加到当前 Notion 页面末尾。';
  }

  if (!pendingAuth) {
    return hint;
  }

  return `${hint} 如果写回前还需要授权，会继续在 ACTIVITY 里请求你确认。`;
}

async function startAction() {
  const selectionText = getSelectionText();
  const action = selectionText ? ACTION_FORWARD_SELECTION : ACTION_FORWARD_FULL_PAGE;
  const runtimeLabel = state.runtime.label || '本地 Agent';

  clearPolling();
  setExpanded(true);
  state.busy = true;
  state.approvalBusy = false;
  state.pendingApproval = null;
  state.currentAction = action;
  state.currentJobId = null;
  state.lastSubmission = {
    action,
    pageUrl: window.location.href,
    pageTitle: getPageTitle(),
    selectionText,
  };

  renderJobState({
    status: 'sending',
    text: selectionText
      ? `正在把选中内容交给 ${runtimeLabel}，完成后会自动写回 Notion…`
      : `正在把当前页交给 ${runtimeLabel}，完成后会自动写回 Notion…`,
    jobId: '',
    action,
  });

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action,
        pageUrl: state.lastSubmission.pageUrl,
        pageTitle: state.lastSubmission.pageTitle,
        selectionText,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: selectionText
        ? `选中内容已发出，正在等待 ${runtimeLabel} 生成 brief…`
        : `当前页已发出，正在等待 ${runtimeLabel} 生成 brief…`,
      jobId: response.jobId,
      action,
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: error.message || '发送失败',
      jobId: '',
      action,
    });
  }
}

async function startAutoWriteBack({ replyText, sourceReplyJobId }) {
  const writeMode = normalizeWriteMode(state.writeMode);
  const selectionText = state.lastSubmission.selectionText || '';

  if (writeMode === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: '当前插件配置为“替换当前选中内容”，但这次发送时没有捕获到可替换的原文。',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
    return;
  }

  const runtimeLabel = state.runtime.label || '本地 Agent';
  state.busy = true;
  state.currentAction = ACTION_WRITE_REPLY;
  renderJobState({
    status: 'sending',
    text: buildWritePendingText(writeMode, runtimeLabel),
    jobId: '',
    action: ACTION_WRITE_REPLY,
  });

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action: ACTION_WRITE_REPLY,
        pageUrl: state.lastSubmission.pageUrl || window.location.href,
        pageTitle: state.lastSubmission.pageTitle || getPageTitle(),
        selectionText,
        replyTextToWrite: replyText,
        writeMode,
        writeSectionTitle: 'notion2CLI',
        sourceReplyJobId,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: buildWriteWaitingText(writeMode, runtimeLabel),
      jobId: response.jobId,
      action: ACTION_WRITE_REPLY,
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: error.message || '自动写回失败',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
  }
}

function pollJob(jobId) {
  clearPolling();
  state.pollTimer = setInterval(async () => {
    try {
      const response = await sendMessage({
        type: 'getJobStatus',
        jobId,
      });

      const job = response.job;
      if (job.status === 'completed' && isReplyAction(job.action)) {
        clearPolling();
        state.approvalBusy = false;
        await handleForwardCompletion(job);
        return;
      }

      renderJobState({
        status: job.status,
        text: buildJobStateText(job),
        jobId: job.id,
        action: job.action,
        runtimeMeta: job.runtimeMeta || {},
      });

      if (job.status === 'completed' || job.status === 'failed') {
        clearPolling();
        state.busy = false;
        state.approvalBusy = false;
        updateControls();
      }
    } catch (error) {
      clearPolling();
      state.busy = false;
      state.approvalBusy = false;
      renderJobState({
        status: 'failed',
        text: error.message || '读取任务状态失败',
        jobId,
        action: state.currentAction || ACTION_FORWARD_FULL_PAGE,
        runtimeMeta: {},
      });
    }
  }, 1800);
}

async function handleForwardCompletion(job) {
  const replyText = String(job.replyText || '').trim();
  if (!replyText) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: '本地 Agent 已完成，但没有返回可展示或写回的结果。',
      jobId: job.id,
      action: job.action,
      runtimeMeta: job.runtimeMeta || {},
    });
    return;
  }

  state.latestReply = replyText;
  state.latestBrief = extractBrief(replyText);
  state.latestReplyJobId = job.id || null;
  renderBrief();

  await startAutoWriteBack({
    replyText,
    sourceReplyJobId: job.id || null,
  });
}

function buildJobStateText(job) {
  if (job.status === 'failed') {
    return job.error || (job.action === ACTION_WRITE_REPLY ? '自动写回失败。' : '执行失败。');
  }

  if (job.status === 'waiting_for_approval') {
    return job.runtimeMeta?.pendingApproval?.message || (job.action === ACTION_WRITE_REPLY
      ? '自动写回前需要你的确认。'
      : '继续执行前需要你的确认。');
  }

  if (job.action === ACTION_WRITE_REPLY) {
    return buildWriteStatusText(job.status, normalizeWriteMode(job.writeMode));
  }

  if (isReplyAction(job.action)) {
    return buildForwardStatusText(job.status, job.action);
  }

  return job.replyText || statusLabel(job.status, job.action);
}

function buildForwardStatusText(status, action) {
  const target = action === ACTION_FORWARD_SELECTION ? '选中内容' : '当前页';

  switch (status) {
    case 'queued':
      return `${target} 已发出，正在排队生成 brief…`;
    case 'dispatched':
      return `${target} 已送达本地 Agent，正在等待开始处理…`;
    case 'running':
      return `本地 Agent 正在处理${target}，准备生成 brief…`;
    case 'sending':
      return `正在提交${target}…`;
    default:
      return `${target} 处理中…`;
  }
}

function buildWriteStatusText(status, writeMode) {
  if (status === 'completed') {
    return buildWriteCompletedText(writeMode);
  }

  switch (status) {
    case 'queued':
      return '自动写回请求已发出，正在排队…';
    case 'dispatched':
      return '自动写回请求已送达本地 Agent，正在等待执行…';
    case 'running':
      return buildWriteRunningText(writeMode);
    case 'sending':
      return '正在提交自动写回请求…';
    default:
      return '自动写回处理中…';
  }
}

function buildWriteRunningText(writeMode) {
  if (state.runtime.standalone) {
    return '正在生成模拟写回结果，不会改动当前页面。';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return '正在把结果自动替换到刚才选中的原文位置…';
    case WRITE_MODE_REPLACE_CONTENT:
      return '正在用结果自动覆盖当前页面正文…';
    default:
      return '正在把结果自动追加到当前页面末尾…';
  }
}

function buildWriteCompletedText(writeMode) {
  if (state.runtime.standalone) {
    return '模拟写回已完成，不会改动当前页面。';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return '这次结果已经自动替换到刚才选中的原文位置。';
    case WRITE_MODE_REPLACE_CONTENT:
      return '这次结果已经自动覆盖当前页面正文。';
    default:
      return '这次结果已经自动追加到当前页面末尾。';
  }
}

function renderJobState({ status, text, jobId, action, runtimeMeta = {} }) {
  state.currentAction = action || state.currentAction;
  state.currentJobId = jobId || null;

  jobIdNode.textContent = jobId ? `#${jobId.slice(0, 8)}` : '';

  const isTerminal = status === 'completed' || status === 'failed';
  const isWaitingForApproval = status === 'waiting_for_approval';
  const statusMarkup = isTerminal
    ? `<span>${statusLabel(status, action)}</span>`
    : isWaitingForApproval
      ? `<span>${statusLabel(status, action)}</span>`
      : `<span class="n2c-spinner"></span><span>${statusLabel(status, action)}</span>`;
  runStatusNode.innerHTML = statusMarkup;

  activityNoteNode.textContent = text || '发送后，执行进度、授权请求和自动写回状态会显示在这里。';
  activityNoteNode.classList.toggle('n2c-empty', !text);
  syncApprovalState(status, runtimeMeta.pendingApproval || null);
  updateControls();
}

function renderBrief() {
  const brief = state.latestBrief || '';
  outputNode.textContent = brief || '运行完成后，这里的 brief 会保留刚刚完成动作的总结。';
  outputNode.classList.toggle('n2c-empty', !brief);
  copyButton.disabled = !brief && !state.latestReply;
}

function extractBrief(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.replace(/^Worked for[^\n]*\n+/i, '').trim() || trimmed;
}

function statusLabel(status, action) {
  switch (status) {
    case 'queued':
      return '已排队';
    case 'dispatched':
      return action === ACTION_WRITE_REPLY ? '准备写回' : '已发出';
    case 'running':
      return action === ACTION_WRITE_REPLY ? '写回中' : '处理中';
    case 'waiting_for_approval':
      return '等待确认';
    case 'sending':
      return action === ACTION_WRITE_REPLY ? '准备写回' : '发送中';
    case 'completed':
      return action === ACTION_WRITE_REPLY ? '已写回 Notion' : '执行完成';
    case 'failed':
      return action === ACTION_WRITE_REPLY ? '写回失败' : '执行失败';
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
  const canSendCurrentState = canStartAction(selectionText);

  sendButton.disabled = state.busy || !state.bridgeReady || !canSendCurrentState;
  copyButton.disabled = !(state.latestBrief || state.latestReply);
  approveButton.disabled = !state.pendingApproval || state.approvalBusy;
  declineButton.disabled = !state.pendingApproval || state.approvalBusy;
}

function canStartAction(selectionText) {
  if (normalizeWriteMode(state.writeMode) === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    return false;
  }

  if (state.runtime.standalone) {
    return true;
  }

  if (!canAttemptNotionFlow()) {
    return false;
  }

  if (selectionText) {
    return true;
  }

  return state.notionMcp.status === 'configured' || state.notionMcp.status === 'unauthenticated' || state.notionMcp.status === 'unknown';
}

function isReplyAction(action) {
  return action === ACTION_FORWARD_SELECTION || action === ACTION_FORWARD_FULL_PAGE;
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

function canAttemptNotionFlow() {
  if (state.runtime.standalone) {
    return true;
  }

  return !['missing', 'unavailable'].includes(state.notionMcp.status);
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
        ? '已允许继续执行，正在等待最新进度…'
        : '已拒绝当前请求，正在等待本地 Agent 结束本次执行…',
      jobId: state.currentJobId,
      action: state.currentAction,
      runtimeMeta: {},
    });
  } catch (error) {
    state.approvalBusy = false;
    renderJobState({
      status: 'failed',
      text: error.message || '提交确认失败',
      jobId: state.currentJobId,
      action: state.currentAction,
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

  updateActionCopy();
  updateControls();
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

function buildWritePendingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `正在请求 ${runtimeLabel} 自动替换刚才选中的原文…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `正在请求 ${runtimeLabel} 自动覆盖当前页面正文…`;
    default:
      return `正在请求 ${runtimeLabel} 自动把结果写回当前页面…`;
  }
}

function buildWriteWaitingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `自动替换请求已发出，等待 ${runtimeLabel} 完成写回…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `整页覆盖请求已发出，等待 ${runtimeLabel} 完成写回…`;
    default:
      return `自动写回请求已发出，等待 ${runtimeLabel} 完成追加…`;
  }
}

function clearPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

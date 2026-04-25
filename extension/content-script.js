const WRITE_MODE_STORAGE_KEY = 'notion2cli.writeMode';
const PANEL_POSITION_STORAGE_KEY = 'notion2cli.panelPosition';
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
  openAppBusy: false,
  pendingApproval: null,
  latestReply: '',
  latestBrief: '',
  latestReplyJobId: null,
  drag: null,
  panelPosition: null,
  panelClampFrame: null,
  suppressFabClick: false,
  writeMode: WRITE_MODE_APPEND_SECTION,
  lastSubmission: {
    action: '',
    pageUrl: '',
    pageTitle: '',
    selectionText: '',
  },
  session: null,
  runtime: {
    id: 'unknown',
    label: 'Codex CLI',
    ready: false,
    standalone: false,
    pairingCommand: 'notion2cli pair',
    launchCommand: '',
    attachCommand: 'notion2cli codex attach',
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
          <button class="n2c-send" type="button" data-send>作为新问题运行</button>
          <div class="n2c-send-hint" data-send-hint>会把当前页作为下一条用户输入发给 Codex，并直接开始处理。</div>
          <div class="n2c-session-bar">
            <div class="n2c-session-text" data-session-text>Codex App session 尚未准备好</div>
            <button class="n2c-open-app" type="button" data-open-app disabled>打开 Codex App</button>
          </div>
          <div class="n2c-section-divider"></div>
          <div class="n2c-meta">
            <span class="n2c-status" data-run-status>
              <span class="n2c-spinner"></span>
              <span>还没有开始</span>
            </span>
            <span class="n2c-job-id" data-job-id></span>
          </div>
          <div class="n2c-activity-note n2c-empty" data-activity-note>运行状态、Codex 回复和手动写回结果会显示在这里。</div>
          <div class="n2c-approval n2c-hidden" data-approval>
            <div class="n2c-approval-title">需要你的确认</div>
            <div class="n2c-approval-message" data-approval-message>Codex 需要确认后才能继续。</div>
            <div class="n2c-approval-actions">
              <button class="n2c-approve" type="button" data-approve>允许继续</button>
              <button class="n2c-decline" type="button" data-decline>拒绝</button>
            </div>
          </div>
          <div class="n2c-brief-head">
            <div class="n2c-meta-label">LATEST REPLY</div>
            <div class="n2c-brief-actions">
              <button class="n2c-copy" type="button" data-copy disabled>复制结果</button>
              <button class="n2c-writeback" type="button" data-write-back disabled>写回 Notion</button>
            </div>
          </div>
          <div class="n2c-output n2c-empty" data-output>最新 Codex 回复会显示在这里，写回时会使用这段内容。</div>
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
const sheetHeader = root.querySelector('.n2c-sheet-header');
const closeSheetButton = root.querySelector('[data-close-sheet]');
const pageTitleNode = root.querySelector('[data-page-title]');
const sendButton = root.querySelector('[data-send]');
const sendHintNode = root.querySelector('[data-send-hint]');
const sessionTextNode = root.querySelector('[data-session-text]');
const openAppButton = root.querySelector('[data-open-app]');
const runStatusNode = root.querySelector('[data-run-status]');
const jobIdNode = root.querySelector('[data-job-id]');
const activityNoteNode = root.querySelector('[data-activity-note]');
const outputNode = root.querySelector('[data-output]');
const approvalNode = root.querySelector('[data-approval]');
const approvalMessageNode = root.querySelector('[data-approval-message]');
const approveButton = root.querySelector('[data-approve]');
const declineButton = root.querySelector('[data-decline]');
const copyButton = root.querySelector('[data-copy]');
const writeBackButton = root.querySelector('[data-write-back]');
const shellResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => {
      schedulePanelViewportClamp();
    })
  : null;

shellResizeObserver?.observe(shell);

bindEvents();
pageTitleNode.textContent = getPageTitle();
renderBrief();
loadWriteModePreference();
loadPanelPositionPreference();
updateActionCopy();
updateControls();
refreshBridgeStatus();
setInterval(refreshBridgeStatus, 15000);

function bindEvents() {
  fab.addEventListener('click', (event) => {
    if (state.suppressFabClick) {
      state.suppressFabClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    pageTitleNode.textContent = getPageTitle();
    updateActionCopy();
    renderBrief();
    setExpanded(!state.expanded);
  });

  fab.addEventListener('pointerdown', (event) => startDrag(event, 'fab'));
  sheetHeader.addEventListener('pointerdown', (event) => startDrag(event, 'header'));
  closeSheetButton.addEventListener('click', () => setExpanded(false));
  sendButton.addEventListener('click', () => startAction());
  openAppButton.addEventListener('click', () => openCodexAppFromPanel());
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

  window.addEventListener('resize', () => {
    if (!state.panelPosition) {
      return;
    }

    schedulePanelViewportClamp();
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

  writeBackButton.addEventListener('click', () => startManualWriteBack());
}

function setExpanded(nextExpanded) {
  state.expanded = Boolean(nextExpanded);
  shell.classList.toggle('n2c-shell-expanded', state.expanded);
  menu.setAttribute('aria-hidden', state.expanded ? 'false' : 'true');
  fab.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');

  if (state.panelPosition) {
    schedulePanelViewportClamp();
  }
}

async function loadPanelPositionPreference() {
  try {
    const data = await chrome.storage.local.get([PANEL_POSITION_STORAGE_KEY]);
    const position = normalizePanelPosition(data[PANEL_POSITION_STORAGE_KEY]);
    if (!position) {
      return;
    }

    requestAnimationFrame(() => {
      applyPanelPosition(position, { persist: false });
    });
  } catch {}
}

function startDrag(event, source) {
  if (event.button !== 0) {
    return;
  }

  if (source === 'header' && event.target.closest('[data-close-sheet]')) {
    return;
  }

  event.preventDefault();

  const rect = shell.getBoundingClientRect();
  state.drag = {
    source,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originLeft: rect.left,
    originBottom: window.innerHeight - rect.bottom,
    moved: false,
  };

  shell.classList.add('n2c-shell-dragging');
  window.addEventListener('pointermove', handleDragMove);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
}

function handleDragMove(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) {
    return;
  }

  if (!state.drag.moved) {
    const delta = Math.abs(event.clientX - state.drag.startX) + Math.abs(event.clientY - state.drag.startY);
    if (delta <= 4) {
      return;
    }

    state.drag.moved = true;
  }

  const nextPosition = clampPanelPosition({
    left: state.drag.originLeft + (event.clientX - state.drag.startX),
    bottom: state.drag.originBottom - (event.clientY - state.drag.startY),
  });
  state.panelPosition = nextPosition;
  applyPanelPosition(nextPosition, { persist: false });
}

function stopDrag(event) {
  if (!state.drag || (event && event.pointerId !== state.drag.pointerId)) {
    return;
  }

  const drag = state.drag;
  state.drag = null;
  shell.classList.remove('n2c-shell-dragging');
  window.removeEventListener('pointermove', handleDragMove);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('pointercancel', stopDrag);

  if (!drag.moved) {
    return;
  }

  if (drag.source === 'fab') {
    state.suppressFabClick = true;
  }

  persistPanelPosition(state.panelPosition).catch(() => {});
}

function ensurePanelWithinViewport({ persist }) {
  const normalized = normalizePanelPosition(state.panelPosition);
  if (!normalized) {
    return;
  }

  applyPanelPosition(normalized, { persist });
}

function schedulePanelViewportClamp() {
  if (!state.panelPosition) {
    return;
  }

  if (state.panelClampFrame) {
    cancelAnimationFrame(state.panelClampFrame);
  }

  state.panelClampFrame = requestAnimationFrame(() => {
    state.panelClampFrame = null;
    ensurePanelWithinViewport({ persist: true });
  });
}

function applyPanelPosition(position, { persist }) {
  const normalized = normalizePanelPosition(position);
  if (!normalized) {
    shell.style.left = '';
    shell.style.top = '';
    shell.style.right = '';
    shell.style.bottom = '';
    state.panelPosition = null;
    if (persist) {
      persistPanelPosition(null).catch(() => {});
    }
    return;
  }

  const clamped = clampPanelPosition(normalized);
  shell.style.left = `${clamped.left}px`;
  shell.style.bottom = `${clamped.bottom}px`;
  shell.style.right = 'auto';
  shell.style.top = 'auto';
  state.panelPosition = clamped;

  if (persist) {
    persistPanelPosition(clamped).catch(() => {});
  }
}

function clampPanelPosition(position) {
  const margin = window.innerWidth <= 720 ? 12 : 24;
  const rect = shell.getBoundingClientRect();
  const projectedWidth = Math.max(rect.width, Math.min(360, Math.max(220, window.innerWidth - 24)));
  const projectedHeight = Math.max(rect.height, 60);
  const maxLeft = Math.max(margin, window.innerWidth - projectedWidth - margin);
  const maxBottom = Math.max(margin, window.innerHeight - projectedHeight - margin);

  return {
    left: Math.round(Math.min(Math.max(position.left, margin), maxLeft)),
    bottom: Math.round(Math.min(Math.max(position.bottom, margin), maxBottom)),
  };
}

function normalizePanelPosition(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const left = Number(value.left);
  const bottom = Number(value.bottom);
  if (Number.isFinite(left) && Number.isFinite(bottom)) {
    return {
      left,
      bottom,
    };
  }

  const top = Number(value.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  const rect = shell.getBoundingClientRect();
  return {
    left,
    bottom: Math.max(0, window.innerHeight - top - rect.height),
  };
}

async function persistPanelPosition(position) {
  if (!position) {
    await chrome.storage.local.remove([PANEL_POSITION_STORAGE_KEY]);
    return;
  }

  await chrome.storage.local.set({
    [PANEL_POSITION_STORAGE_KEY]: {
      left: position.left,
      bottom: position.bottom,
    },
  });
}

async function refreshBridgeStatus() {
  try {
    const response = await sendMessage({ type: 'getBridgeStatus' });
    state.runtime = response.runtime || state.runtime;
    state.session = response.session || null;
    state.notionMcp = response.notionMcp || state.notionMcp;
    state.bridgeReady = Boolean(response.paired) && Boolean(state.runtime.ready);
    state.bridgeMessage = formatBridgeMessage(response);
    syncLatestReplyFromSession(response.session || null);
  } catch (error) {
    state.bridgeReady = false;
    state.session = null;
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
  renderSessionState();
  updateActionCopy();
  updateControls();
}

function updateActionCopy() {
  const selected = getSelectionText();

  if (!state.runtime.ready) {
    sendButton.textContent = '作为新问题运行';
    sendHintNode.textContent = state.runtime.launchCommand
      ? `先在扩展弹窗里启动 CLI：${state.runtime.launchCommand}`
      : '先在扩展弹窗里启动 CLI。';
    return;
  }

  if (!state.bridgeReady) {
    sendButton.textContent = '连接后可运行';
    sendHintNode.textContent = '先在扩展弹窗里生成并输入 6 位配对码，连接完成后再回来运行。';
    return;
  }

  if (state.runtime.id !== 'codex' || state.runtime.standalone) {
    sendButton.textContent = '请切换到 Codex runtime';
    sendHintNode.textContent = '当前模式只支持 Codex。请在扩展弹窗里启动 Codex daemon，再回来运行。';
    return;
  }

  if (selected) {
    sendButton.textContent = '运行选中内容';
    sendHintNode.textContent = '会把选中内容作为下一条用户输入发给 Codex，并直接开始处理。';
    return;
  }

  if (!canAttemptFullPageDelivery()) {
    sendButton.textContent = '运行整页需要 Notion MCP';
    sendHintNode.textContent = '运行整页前需要先能读取 Notion 页面内容。请先在扩展弹窗里启用 Notion MCP。';
    return;
  }

  sendButton.textContent = '运行当前页';
  sendHintNode.textContent = '会把整页内容作为下一条用户输入发给 Codex，并直接开始处理。';
}

async function startAction() {
  const selectionText = getSelectionText();
  const action = selectionText ? ACTION_FORWARD_SELECTION : ACTION_FORWARD_FULL_PAGE;
  const runtimeLabel = state.runtime.label || 'Codex CLI';

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
      ? `正在把选中内容作为新问题提交给 ${runtimeLabel}…`
      : `正在把当前页作为新问题提交给 ${runtimeLabel}…`,
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
        ? `选中内容已作为新问题提交给 ${runtimeLabel}，正在等待处理结果。`
        : `当前页已作为新问题提交给 ${runtimeLabel}，正在等待处理结果。`,
      jobId: response.jobId,
      action,
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: error.message || '提交失败',
      jobId: '',
      action,
    });
  }
}

async function startManualWriteBack() {
  const writeMode = normalizeWriteMode(state.writeMode);
  const selectionText = getSelectionText();
  const replyText = String(state.latestReply || '').trim();

  if (!replyText) {
    renderJobState({
      status: 'failed',
      text: '当前没有可写回的 Codex 回复。',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
    return;
  }

  if (writeMode === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: '当前写回模式是“替换当前选中内容”。请先选中要替换的原文，再点击“写回 Notion”。',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
    return;
  }

  const runtimeLabel = state.runtime.label || 'Codex CLI';
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
        pageUrl: window.location.href,
        pageTitle: getPageTitle(),
        selectionText,
        replyTextToWrite: replyText,
        writeMode,
        writeSectionTitle: 'notion2CLI',
        sourceReplyJobId: state.latestReplyJobId || '',
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
      text: error.message || '写回失败',
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
        state.busy = false;
        state.latestReply = String(job.replyText || '').trim();
        state.latestBrief = extractBrief(state.latestReply);
        state.latestReplyJobId = job.id || null;
        renderBrief();
        renderJobState({
          status: 'completed',
          text: job.runtimeMeta?.appVisible
            ? '这条结果已经进入同一个 Codex App session，并显示在面板里。'
            : '这条结果已经显示在面板里，你可以继续手动写回 Notion。',
          jobId: job.id,
          action: job.action,
          runtimeMeta: job.runtimeMeta || {},
        });
        refreshBridgeStatus();
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

function buildJobStateText(job) {
  if (job.status === 'failed') {
    return job.error || (job.action === ACTION_WRITE_REPLY ? '写回失败。' : '执行失败。');
  }

  if (job.status === 'waiting_for_approval') {
    return job.runtimeMeta?.pendingApproval?.message || (job.action === ACTION_WRITE_REPLY
      ? '写回前需要你的确认。'
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
      return `${target} 已提交，正在排队处理…`;
    case 'dispatched':
      return `${target} 已送达 Codex，正在等待开始处理…`;
    case 'running':
      return `Codex 正在处理${target}…`;
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
      return '写回请求已发出，正在排队…';
    case 'dispatched':
      return '写回请求已送达 Codex，正在等待执行…';
    case 'running':
      return buildWriteRunningText(writeMode);
    case 'sending':
      return '正在提交写回请求…';
    default:
      return '写回处理中…';
  }
}

function buildWriteRunningText(writeMode) {
  if (state.runtime.standalone) {
    return '正在生成模拟写回结果，不会改动当前页面。';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return '正在把结果替换到刚才选中的原文位置…';
    case WRITE_MODE_REPLACE_CONTENT:
      return '正在用结果覆盖当前页面正文…';
    default:
      return '正在把结果追加到当前页面末尾…';
  }
}

function buildWriteCompletedText(writeMode) {
  if (state.runtime.standalone) {
    return '模拟写回已完成，不会改动当前页面。';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return '这次结果已经替换到刚才选中的原文位置。';
    case WRITE_MODE_REPLACE_CONTENT:
      return '这次结果已经覆盖当前页面正文。';
    default:
      return '这次结果已经追加到当前页面末尾。';
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

  activityNoteNode.textContent = text || '运行状态、Codex 回复和手动写回结果会显示在这里。';
  activityNoteNode.classList.toggle('n2c-empty', !text);
  syncApprovalState(status, runtimeMeta.pendingApproval || null);
  updateControls();

  if (state.expanded && state.panelPosition) {
    schedulePanelViewportClamp();
  }
}

function renderBrief() {
  const brief = state.latestBrief || '';
  outputNode.textContent = brief || '最新 Codex 回复会显示在这里，写回时会使用这段内容。';
  outputNode.classList.toggle('n2c-empty', !brief);
  copyButton.disabled = !brief && !state.latestReply;

  if (state.expanded && state.panelPosition) {
    schedulePanelViewportClamp();
  }
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
      return action === ACTION_WRITE_REPLY ? '准备写回' : '提交中';
    case 'completed':
      return action === ACTION_WRITE_REPLY ? '已写回 Notion' : '已完成';
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
  openAppButton.disabled = state.openAppBusy || !state.session?.threadId || state.runtime.id !== 'codex';
  copyButton.disabled = !(state.latestBrief || state.latestReply);
  writeBackButton.disabled = state.busy || !canWriteBack(selectionText);
  approveButton.disabled = !state.pendingApproval || state.approvalBusy;
  declineButton.disabled = !state.pendingApproval || state.approvalBusy;
  approveButton.textContent = state.pendingApproval?.mode === 'url' && !isUrlApprovalReadyToContinue()
    ? '打开授权页'
    : '允许继续';
}

async function openCodexAppFromPanel() {
  if (!state.session?.threadId || state.openAppBusy) {
    return;
  }

  state.openAppBusy = true;
  openAppButton.textContent = '打开中';
  updateControls();

  try {
    const response = await sendMessage({ type: 'openCodexApp' });
    activityNoteNode.textContent = response.message || '已打开 Codex App。';
    activityNoteNode.classList.remove('n2c-empty');
  } catch (error) {
    activityNoteNode.textContent = error.message || '无法打开 Codex App。';
    activityNoteNode.classList.remove('n2c-empty');
  } finally {
    state.openAppBusy = false;
    openAppButton.textContent = '打开 Codex App';
    updateControls();
  }
}

function isUrlApprovalReadyToContinue() {
  if (!state.pendingApproval || state.pendingApproval.mode !== 'url') {
    return false;
  }

  return Boolean(state.pendingApproval.opened) || state.notionMcp.status === 'configured';
}

function canStartAction(selectionText) {
  if (state.runtime.id !== 'codex' || state.runtime.standalone) {
    return false;
  }

  if (selectionText) {
    return true;
  }

  return canAttemptFullPageDelivery();
}

function isReplyAction(action) {
  return action === ACTION_FORWARD_SELECTION || action === ACTION_FORWARD_FULL_PAGE;
}

function formatBridgeMessage(response) {
  const runtime = response.runtime || {};
  const runtimeLabel = runtime.label || 'Codex CLI';

  if (response.paired && runtime.ready) {
    if (runtime.standalone) {
      return '已连接调试模式';
    }

    return response.session?.threadId ? `已连接 ${runtimeLabel} 会话` : `已连接 ${runtimeLabel}`;
  }

  if (response.awaitingPairCode) {
    return '等待输入 6 位配对码';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || 'Codex CLI 未就绪';
  }

  return '打开扩展完成连接';
}

function canAttemptFullPageDelivery() {
  return state.notionMcp.status === 'configured' || state.notionMcp.status === 'unknown';
}

function canAttemptWriteBack() {
  return !['missing', 'unavailable'].includes(state.notionMcp.status);
}

function canWriteBack(selectionText) {
  if (state.runtime.id !== 'codex' || state.runtime.standalone) {
    return false;
  }

  if (!String(state.latestReply || '').trim()) {
    return false;
  }

  if (!canAttemptWriteBack()) {
    return false;
  }

  if (normalizeWriteMode(state.writeMode) === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    return false;
  }

  return true;
}

function syncLatestReplyFromSession(session) {
  const latestReply = String(session?.latestSharableAssistantMessage || '').trim();
  if (!latestReply || latestReply === state.latestReply) {
    return;
  }

  state.latestReply = latestReply;
  state.latestBrief = extractBrief(latestReply);
  renderBrief();
}

function renderSessionState() {
  if (!state.runtime.ready || state.runtime.id !== 'codex') {
    sessionTextNode.textContent = 'Codex App session 尚未准备好';
    return;
  }

  const threadId = String(state.session?.threadId || '').trim();
  if (!threadId) {
    sessionTextNode.textContent = '正在准备 Codex App session';
    return;
  }

  const name = String(state.session?.threadName || '').trim() || 'notion2CLI';
  const turnCount = Number(state.session?.turnCount || 0);
  const visibility = state.session?.appVisible ? 'App 可见' : '等待 App 同步';
  sessionTextNode.textContent = `${name} · ${visibility} · ${turnCount} turns`;
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

  if (action === 'accept' && state.pendingApproval.mode === 'url' && state.pendingApproval.url && !isUrlApprovalReadyToContinue()) {
    const authWindow = window.open(state.pendingApproval.url, '_blank', 'noopener,noreferrer');
    if (!authWindow) {
      renderJobState({
        status: 'waiting_for_approval',
        text: '浏览器拦截了授权窗口。请允许弹窗后再试一次。',
        jobId: state.currentJobId,
        action: state.currentAction,
        runtimeMeta: {
          pendingApproval: state.pendingApproval,
        },
      });
      return;
    }

    state.pendingApproval = {
      ...state.pendingApproval,
      opened: true,
    };
    approvalMessageNode.textContent = buildApprovalMessage(state.pendingApproval);
    activityNoteNode.textContent = '授权页已打开。完成浏览器授权后，再点一次“允许继续”。';
    updateControls();
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
        : '已拒绝当前请求，正在等待 Codex 结束本次执行…',
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
    const previousKey = approvalRequestKey(state.pendingApproval);
    const nextKey = approvalRequestKey(pendingApproval);
    state.pendingApproval = {
      ...pendingApproval,
      opened: previousKey && previousKey === nextKey ? Boolean(state.pendingApproval?.opened) : false,
    };
    approvalNode.classList.remove('n2c-hidden');
    approvalMessageNode.textContent = buildApprovalMessage(state.pendingApproval);
    updateControls();
    return;
  }

  state.pendingApproval = null;
  approvalNode.classList.add('n2c-hidden');
  approvalMessageNode.textContent = '当前执行需要确认后才能继续。';
  updateControls();
}

function buildApprovalMessage(pendingApproval) {
  const base = pendingApproval.message || '当前执行需要你的确认才能继续。';
  if (pendingApproval.mode === 'url' && pendingApproval.url) {
    if (isUrlApprovalReadyToContinue()) {
      return `${base} 浏览器授权似乎已经完成，现在可以直接点“允许继续”。`;
    }

    if (pendingApproval.opened) {
      return `${base} 授权页已经打开。完成浏览器授权后，再点一次“允许继续”。`;
    }

    return `${base} 先点“打开授权页”，完成浏览器授权后，再回来继续。`;
  }

  return base;
}

function approvalRequestKey(pendingApproval) {
  if (!pendingApproval || typeof pendingApproval !== 'object') {
    return '';
  }

  return String(pendingApproval.requestId || pendingApproval.url || pendingApproval.message || '').trim();
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
      return `正在请求 ${runtimeLabel} 替换刚才选中的原文…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `正在请求 ${runtimeLabel} 覆盖当前页面正文…`;
    default:
      return `正在请求 ${runtimeLabel} 把结果写回当前页面…`;
  }
}

function buildWriteWaitingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `替换请求已发出，等待 ${runtimeLabel} 完成写回…`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `整页覆盖请求已发出，等待 ${runtimeLabel} 完成写回…`;
    default:
      return `写回请求已发出，等待 ${runtimeLabel} 完成追加…`;
  }
}

function clearPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

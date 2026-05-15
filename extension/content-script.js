const WRITE_MODE_STORAGE_KEY = 'notion2cli.writeMode';
const MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY = 'notion2cli.manualWritebackVisible';
const PANEL_POSITION_STORAGE_KEY = 'notion2cli.panelPosition';
const LAST_PROMPT_PROFILE_STORAGE_KEY = 'notion2cli.lastPromptProfileId';
const WRITE_MODE_APPEND_SECTION = 'append_markdown_section';
const WRITE_MODE_UPDATE_CONTENT = 'update_content';
const WRITE_MODE_REPLACE_CONTENT = 'replace_content';
const PROMPT_PROFILE_RAW = 'raw';
const PROMPT_EDITOR_NEW = '__new__';

const ACTION_FORWARD_SELECTION = 'forward_selection_text';
const ACTION_FORWARD_FULL_PAGE = 'forward_full_page_via_mcp';
const ACTION_WRITE_REPLY = 'write_reply_to_notion';
const ACTION_SELECTION_CACHE_MS = 1000;
const EXTENSION_MESSAGE_TIMEOUT_MS = 65000;
const PAGE_PROVIDER = detectPageProvider(window.location.href);

const state = {
  bridgeReady: false,
  pageProvider: PAGE_PROVIDER,
  bridgeMessage: 'Checking connection',
  expanded: false,
  currentJobId: null,
  currentAction: '',
  currentStatus: '',
  pollTimer: null,
  busy: false,
  stopBusy: false,
  approvalBusy: false,
  openAppBusy: false,
  pendingApproval: null,
  latestReply: '',
  latestBrief: '',
  latestReplyJobId: null,
  promptProfileId: PROMPT_PROFILE_RAW,
  promptProfiles: [
    {
      id: PROMPT_PROFILE_RAW,
      name: 'Raw',
      instruction: '',
      editable: false,
      deletable: false,
      resettable: false,
    },
    {
      id: 'previbe',
      name: 'PreVibe',
      instruction: '',
      editable: true,
      deletable: true,
      resettable: true,
    },
    {
      id: 'build',
      name: 'Build',
      instruction: '',
      editable: true,
      deletable: true,
      resettable: true,
    },
  ],
  promptEditorOpen: false,
  promptEditorProfileId: PROMPT_PROFILE_RAW,
  promptEditorBusy: false,
  promptEditorMessage: '',
  drag: null,
  panelPosition: null,
  panelClampFrame: null,
  suppressFabClick: false,
  lastSelectionText: '',
  lastSelectionCapturedAt: 0,
  pendingActionSelectionText: '',
  pendingActionSelectionCapturedAt: 0,
  writeMode: WRITE_MODE_APPEND_SECTION,
  manualWritebackVisible: false,
  lastSubmission: {
    action: '',
    pageUrl: '',
    pageTitle: '',
    providerId: '',
    selectionText: '',
    selectionContext: null,
  },
  session: null,
  runtime: {
    id: 'unknown',
    label: 'Local Agent',
    ready: false,
    standalone: false,
    pairingCommand: 'notion2cli pair',
    launchCommand: '',
    attachCommand: '',
    statusMessage: '',
  },
  notionMcp: {
    status: 'unknown',
    detail: '',
  },
  documentProviders: {
    providers: [],
  },
  notifiedJobEvents: new Set(),
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
          <span class="n2c-strip-label" data-strip-label>Local CLI disconnected</span>
        </div>
        <div class="n2c-page-meta">
          <div class="n2c-meta-label">Current page</div>
          <div class="n2c-page-title" data-page-title>Loading...</div>
        </div>
        <button class="n2c-strip-toggle" type="button" data-close-sheet aria-label="Collapse Activity">
          <span class="n2c-chevron n2c-chevron-down"></span>
        </button>
      </div>
      <div class="n2c-sheet-paper">
        <div class="n2c-card-body">
          <label class="n2c-task-picker">
            <span class="n2c-task-head">
              <span class="n2c-meta-label">Task</span>
              <button class="n2c-prompt-manage" type="button" data-manage-prompts>Manage</button>
            </span>
            <span class="n2c-task-list" data-prompt-list></span>
          </label>
          <div class="n2c-send-hint n2c-hidden" data-send-hint></div>
          <div class="n2c-section-divider"></div>
          <div class="n2c-meta">
            <span class="n2c-status" data-run-status>
              <span class="n2c-spinner"></span>
              <span>Not started</span>
            </span>
            <span class="n2c-job-actions">
              <button class="n2c-stop n2c-hidden" type="button" data-stop-job disabled aria-label="Stop task" title="Stop task">
                <svg class="n2c-stop-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="1.8"></rect>
                </svg>
              </button>
              <span class="n2c-job-id" data-job-id></span>
            </span>
          </div>
          <div class="n2c-activity-note n2c-empty" data-activity-note>Run status and agent replies appear here.</div>
          <div class="n2c-approval n2c-hidden" data-approval>
            <div class="n2c-approval-title">Confirmation required</div>
            <div class="n2c-approval-message" data-approval-message>This run needs confirmation before it can continue.</div>
            <div class="n2c-approval-actions">
              <button class="n2c-approve" type="button" data-approve>Allow</button>
              <button class="n2c-decline" type="button" data-decline>Decline</button>
            </div>
          </div>
          <div class="n2c-brief-head">
            <div class="n2c-meta-label">BRIEF</div>
          </div>
          <div class="n2c-output n2c-empty" data-output>The latest reply appears here.</div>
          <div class="n2c-footer-actions">
            <button class="n2c-copy" type="button" data-copy disabled aria-label="Copy result" title="Copy result">
              <svg class="n2c-copy-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="11" height="11" rx="2"></rect>
                <path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H15"></path>
              </svg>
            </button>
            <div class="n2c-footer-right">
              <button class="n2c-writeback" type="button" data-write-back disabled>Write back</button>
              <button class="n2c-open-app" type="button" data-open-app disabled>Open session</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <button class="n2c-fab" type="button" aria-expanded="false" aria-controls="n2c-activity-sheet">
      <span class="n2c-strip-status">
        <span class="n2c-dot" data-bridge-dot></span>
        <span class="n2c-strip-label" data-strip-label>Local CLI disconnected</span>
      </span>
      <span class="n2c-strip-toggle" aria-hidden="true">
        <span class="n2c-chevron n2c-chevron-up"></span>
      </span>
    </button>
    <div class="n2c-modal n2c-hidden" data-prompt-modal role="dialog" aria-modal="true" aria-label="Manage prompts">
      <div class="n2c-modal-panel">
        <div class="n2c-modal-head">
          <div>
            <div class="n2c-meta-label">Prompt</div>
            <div class="n2c-modal-title">Manage tasks</div>
          </div>
          <button class="n2c-modal-close" type="button" data-close-prompts aria-label="Close">×</button>
        </div>
        <div class="n2c-prompt-editor">
          <div class="n2c-prompt-list" data-prompt-editor-list></div>
          <div class="n2c-prompt-form">
            <label class="n2c-field">
              <span class="n2c-field-label">Name</span>
              <input class="n2c-input" data-prompt-name maxlength="48" />
            </label>
            <label class="n2c-field">
              <span class="n2c-field-label">Prompt</span>
              <textarea class="n2c-textarea" data-prompt-instruction spellcheck="false"></textarea>
            </label>
            <div class="n2c-editor-message" data-prompt-editor-message></div>
            <div class="n2c-editor-actions">
              <button class="n2c-editor-button" type="button" data-new-prompt>New</button>
              <button class="n2c-editor-button n2c-editor-primary" type="button" data-save-prompt>Save</button>
              <button class="n2c-editor-button" type="button" data-reset-prompt>Reset default</button>
              <button class="n2c-editor-button n2c-editor-danger" type="button" data-delete-prompt>Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
const promptListNode = root.querySelector('[data-prompt-list]');
const sendHintNode = root.querySelector('[data-send-hint]');
const managePromptsButton = root.querySelector('[data-manage-prompts]');
const promptModalNode = root.querySelector('[data-prompt-modal]');
const closePromptsButton = root.querySelector('[data-close-prompts]');
const promptEditorListNode = root.querySelector('[data-prompt-editor-list]');
const promptNameInput = root.querySelector('[data-prompt-name]');
const promptInstructionInput = root.querySelector('[data-prompt-instruction]');
const promptEditorMessageNode = root.querySelector('[data-prompt-editor-message]');
const newPromptButton = root.querySelector('[data-new-prompt]');
const savePromptButton = root.querySelector('[data-save-prompt]');
const resetPromptButton = root.querySelector('[data-reset-prompt]');
const deletePromptButton = root.querySelector('[data-delete-prompt]');
const openAppButton = root.querySelector('[data-open-app]');
const stopButton = root.querySelector('[data-stop-job]');
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
renderPromptButtons();
loadWriteSettingsPreference();
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
  managePromptsButton.addEventListener('click', () => openPromptManager());
  closePromptsButton.addEventListener('click', () => closePromptManager());
  promptModalNode.addEventListener('click', (event) => {
    if (event.target === promptModalNode) {
      closePromptManager();
    }
  });
  for (const eventName of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste', 'copy', 'cut']) {
    promptModalNode.addEventListener(eventName, stopModalEventPropagation, true);
  }
  newPromptButton.addEventListener('click', () => createPromptFromEditor());
  savePromptButton.addEventListener('click', () => savePromptFromEditor());
  resetPromptButton.addEventListener('click', () => resetPromptFromEditor());
  deletePromptButton.addEventListener('click', () => deletePromptFromEditor());
  openAppButton.addEventListener('click', () => openCodexAppFromPanel());
  stopButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    stopCurrentJob();
  });
  approveButton.addEventListener('click', () => submitApproval('accept'));
  declineButton.addEventListener('click', () => submitApproval('decline'));
  promptListNode.addEventListener('pointerdown', captureActionSelectionFromPointer, true);
  promptListNode.addEventListener('mousedown', preserveSelectionForActionControl, true);
  writeBackButton.addEventListener('pointerdown', captureActionSelectionFromPointer, true);
  writeBackButton.addEventListener('mousedown', preserveSelectionForActionControl, true);

  document.addEventListener('selectionchange', () => {
    rememberLiveSelection();
    updateActionCopy();
    updateControls();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestClearJobBadge();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (Object.hasOwn(changes, WRITE_MODE_STORAGE_KEY)) {
      state.writeMode = normalizeWriteMode(changes[WRITE_MODE_STORAGE_KEY].newValue);
    }
    if (Object.hasOwn(changes, MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY)) {
      state.manualWritebackVisible = changes[MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY].newValue === true;
    }
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
    copyButton.classList.add('n2c-copied');
    copyButton.setAttribute('aria-label', 'Copied');
    copyButton.title = 'Copied';
    setTimeout(() => {
      copyButton.classList.remove('n2c-copied');
      copyButton.setAttribute('aria-label', 'Copy result');
      copyButton.title = 'Copy result';
    }, 1400);
  });

  writeBackButton.addEventListener('click', () => startManualWriteBack({
    selectionText: consumeActionSelectionText(),
  }));
}

function setExpanded(nextExpanded) {
  state.expanded = Boolean(nextExpanded);
  shell.classList.toggle('n2c-shell-expanded', state.expanded);
  menu.setAttribute('aria-hidden', state.expanded ? 'false' : 'true');
  fab.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');

  if (state.expanded
    && (isTerminalJobStatus(state.currentStatus) || state.currentStatus === 'waiting_for_approval')) {
    requestClearJobBadge();
  }

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
  state.pageProvider = detectPageProvider(window.location.href);
  try {
    const response = await sendMessage({ type: 'getBridgeStatus' });
    state.runtime = response.runtime || state.runtime;
    state.session = response.session || null;
    state.notionMcp = response.notionMcp || state.notionMcp;
    state.documentProviders = response.documentProviders || state.documentProviders;
    state.bridgeReady = Boolean(response.paired) && Boolean(state.runtime.ready);
    state.bridgeMessage = formatBridgeMessage(response);
    syncLatestReplyFromSession(response.session || null);
    if (state.bridgeReady) {
      await refreshPromptProfiles();
    }
  } catch (error) {
    state.bridgeReady = false;
    state.session = null;
    state.runtime = {
      ...state.runtime,
      ready: false,
      standalone: false,
    };
    state.bridgeMessage = error.message || 'Unable to connect to bridge';
  }

  statusDots.forEach((node) => node.classList.toggle('ready', state.bridgeReady));
  const stripLabel = state.bridgeReady ? 'Activity' : 'Local CLI disconnected';
  stripLabelNodes.forEach((node) => {
    node.textContent = stripLabel;
  });
  pageTitleNode.textContent = getPageTitle();
  renderSessionState();
  renderPromptButtons();
  updateActionCopy();
  updateControls();
}

async function refreshPromptProfiles() {
  try {
    const response = await sendMessage({ type: 'getPromptProfiles' });
    const profiles = normalizePromptProfiles(response.profiles);
    if (profiles.length) {
      state.promptProfiles = profiles;
    }
    if (!state.promptProfiles.some((profile) => profile.id === state.promptProfileId)) {
      state.promptProfileId = PROMPT_PROFILE_RAW;
    }
  } catch {}
}

function renderPromptButtons() {
  const disabled = state.busy || !state.bridgeReady || !canStartAction(getSelectionText());
  const existingButtons = new Map(
    [...promptListNode.querySelectorAll('[data-prompt-profile-id]')]
      .map((button) => [button.dataset.promptProfileId, button]),
  );
  const activeProfileIds = new Set();

  state.promptProfiles.forEach((profile, index) => {
    let button = existingButtons.get(profile.id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'n2c-task-button';
      button.dataset.promptProfileId = profile.id;
      button.addEventListener('click', () => handlePromptButtonClick(profile.id));
    }

    button.textContent = profile.name;
    button.title = profile.name;
    button.disabled = disabled;
    button.classList.toggle('active', profile.id === state.promptProfileId);
    activeProfileIds.add(profile.id);

    if (promptListNode.children[index] !== button) {
      promptListNode.insertBefore(button, promptListNode.children[index] || null);
    }
  });

  for (const [profileId, button] of existingButtons.entries()) {
    if (!activeProfileIds.has(profileId)) {
      button.remove();
    }
  }
}

function handlePromptButtonClick(profileId) {
  const task = resolvePromptProfile(profileId);
  if (task.id !== state.promptProfileId) {
    state.promptProfileId = task.id;
    renderPromptButtons();
    updateActionCopy();
    updateControls();
    return;
  }

  startAction(task.id, {
    selectionText: consumeActionSelectionText(),
  });
}

function updateActionCopy() {
  const selected = getSelectionText();
  sendHintNode.classList.remove('n2c-hidden');

  if (!state.runtime.ready) {
    sendHintNode.textContent = state.runtime.launchCommand
      ? `Start the CLI from the extension popup: ${state.runtime.launchCommand}`
      : 'Start the CLI from the extension popup.';
    renderPromptButtons();
    return;
  }

  if (!state.bridgeReady) {
    sendHintNode.textContent = 'Generate and enter a 6-digit pairing code in the extension popup, then return here to run.';
    renderPromptButtons();
    return;
  }

  if (!isSupportedRuntime() || state.runtime.standalone) {
    sendHintNode.textContent = 'The current mode does not support real runs. Start Codex or Claude from the extension popup, then return here.';
    renderPromptButtons();
    return;
  }

  if (selected) {
    sendHintNode.textContent = '';
    sendHintNode.classList.add('n2c-hidden');
    renderPromptButtons();
    return;
  }

  if (!canAttemptFullPageDelivery()) {
    sendHintNode.textContent = 'Full-page runs require document access. Enable the required provider setup in the extension popup first.';
    renderPromptButtons();
    return;
  }

  sendHintNode.textContent = '';
  sendHintNode.classList.add('n2c-hidden');
  renderPromptButtons();
}

function buildSubmitText({ target, runtimeLabel, task }) {
  return `Submitting ${target} as "${task.name}" input to ${runtimeLabel}...`;
}

function buildSubmittedText({ target, runtimeLabel, task }) {
  return `${target} was submitted as "${task.name}" input to ${runtimeLabel} and is waiting for the result.`;
}

async function startAction(profileId = state.promptProfileId, options = {}) {
  const selectionText = normalizeSelectionText(options.selectionText) || getSelectionText();
  const selectionContext = buildSelectionContext(selectionText);
  const action = selectionText ? ACTION_FORWARD_SELECTION : ACTION_FORWARD_FULL_PAGE;
  const runtimeLabel = getRuntimeLabel();
  const task = resolvePromptProfile(profileId);
  state.promptProfileId = task.id;
  persistPromptProfilePreference(task.id);

  clearPolling();
  setExpanded(true);
  state.busy = true;
  state.stopBusy = false;
  state.approvalBusy = false;
  state.pendingApproval = null;
  state.currentAction = action;
  state.currentJobId = null;
  state.notifiedJobEvents = new Set();
  clearLatestReplyForNewRun();
  requestClearJobBadge();
  state.lastSubmission = {
    action,
    pageUrl: window.location.href,
    pageTitle: getPageTitle(),
    providerId: getProviderId(),
    selectionText,
    selectionContext,
    promptProfileId: task.id,
  };

  renderJobState({
    status: 'sending',
    text: selectionText
      ? buildSubmitText({ target: 'selection', runtimeLabel, task })
      : buildSubmitText({ target: 'current page', runtimeLabel, task }),
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
        providerId: state.lastSubmission.providerId,
        selectionText,
        selectionContext,
        promptProfileId: task.id,
        source: 'chrome-extension',
      },
    });

    state.currentJobId = response.jobId;
    renderJobState({
      status: response.status,
      text: selectionText
        ? buildSubmittedText({ target: 'selection', runtimeLabel, task })
        : buildSubmittedText({ target: 'current page', runtimeLabel, task }),
      jobId: response.jobId,
      action,
    });
    pollJob(response.jobId);
  } catch (error) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: error.message || 'Submit failed',
      jobId: '',
      action,
    });
  }
}

async function startManualWriteBack(options = {}) {
  if (!state.manualWritebackVisible) {
    return;
  }

  const writeMode = normalizeWriteMode(state.writeMode);
  const selectionText = normalizeSelectionText(options.selectionText) || getSelectionText();
  const replyText = String(state.latestReply || '').trim();

  if (!replyText) {
    renderJobState({
      status: 'failed',
      text: 'There is no reply to write back.',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
    return;
  }

  if (writeMode === WRITE_MODE_UPDATE_CONTENT && !selectionText) {
    state.busy = false;
    renderJobState({
      status: 'failed',
      text: `The current write-back mode replaces the selected content. Select the target text before clicking Write to ${getProviderLabel()}.`,
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
    return;
  }

  const runtimeLabel = getRuntimeLabel();
  state.busy = true;
  state.stopBusy = false;
  state.currentAction = ACTION_WRITE_REPLY;
  state.notifiedJobEvents = new Set();
  requestClearJobBadge();
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
        providerId: getProviderId(),
        selectionText,
        selectionContext: buildSelectionContext(selectionText),
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
      text: error.message || 'Write-back failed',
      jobId: '',
      action: ACTION_WRITE_REPLY,
    });
  }
}

async function stopCurrentJob() {
  const jobId = state.currentJobId;
  if (!jobId || state.stopBusy) {
    return;
  }

  clearPolling();
  state.stopBusy = true;
  renderJobState({
    status: 'cancelling',
    text: 'Stopping task...',
    jobId,
    action: state.currentAction,
  });

  try {
    const response = await sendMessage({
      type: 'cancelJob',
      jobId,
    });
    const job = response.job || {};
    clearPolling();
    state.busy = false;
    state.stopBusy = false;
    state.approvalBusy = false;
    state.pendingApproval = null;
    requestClearJobBadge();
    renderJobState({
      status: job.status || 'cancelled',
      text: buildCancelStatusText(job),
      jobId: job.id || jobId,
      action: job.action || state.currentAction,
      runtimeMeta: job.runtimeMeta || {},
    });
  } catch (error) {
    state.stopBusy = false;
    renderJobState({
      status: state.currentJobId ? 'running' : 'failed',
      text: error.message || 'Failed to stop task',
      jobId,
      action: state.currentAction,
    });
    if (state.currentJobId === jobId) {
      pollJob(jobId);
    }
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
      if (shouldIgnorePollResult(jobId)) {
        return;
      }
      maybeNotify(job);
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
          text: buildReplyCompletedText(job),
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

      if (isTerminalJobStatus(job.status)) {
        clearPolling();
        state.busy = false;
        state.stopBusy = false;
        state.approvalBusy = false;
        updateControls();
      }
    } catch (error) {
      clearPolling();
      state.busy = false;
      state.stopBusy = false;
      state.approvalBusy = false;
      renderJobState({
        status: 'failed',
        text: error.message || 'Failed to read task status',
        jobId,
        action: state.currentAction || ACTION_FORWARD_FULL_PAGE,
        runtimeMeta: {},
      });
    }
  }, 1800);
}

function shouldIgnorePollResult(jobId) {
  return state.currentJobId !== jobId
    || state.stopBusy
    || state.currentStatus === 'cancelling'
    || isTerminalJobStatus(state.currentStatus);
}

function buildJobStateText(job) {
  if (job.status === 'failed') {
    return job.error || (job.action === ACTION_WRITE_REPLY ? 'Write-back failed.' : 'Run failed.');
  }

  if (job.status === 'cancelled') {
    return buildCancelStatusText(job);
  }

  if (job.status === 'cancelling') {
    return 'Stopping task...';
  }

  if (job.status === 'waiting_for_approval') {
    return job.runtimeMeta?.pendingApproval?.message || (job.action === ACTION_WRITE_REPLY
      ? 'Write-back needs your confirmation.'
      : 'Continuing needs your confirmation.');
  }

  if (job.action === ACTION_WRITE_REPLY) {
    return buildWriteStatusText(job.status, normalizeWriteMode(job.writeMode));
  }

  if (isReplyAction(job.action)) {
    return buildForwardStatusText(job.status, job.action, job);
  }

  return job.replyText || statusLabel(job.status, job.action);
}

function buildReplyCompletedText(job) {
  const meta = job.runtimeMeta || {};
  if (state.runtime.id === 'codex' && meta.appVisible) {
    return 'This Brief was added to the same Codex App session and is shown in the panel.';
  }

  if (state.runtime.id === 'claude') {
    return 'This Brief is shown in the current Claude Code terminal session and in the panel.';
  }

  return 'This Brief is shown in the panel.';
}

function buildForwardStatusText(status, action, job = {}) {
  const target = action === ACTION_FORWARD_SELECTION ? 'selection' : 'current page';
  const runtimeLabel = getRuntimeLabel();
  const task = resolveJobPromptProfile(job);
  const taskPrefix = task.id === PROMPT_PROFILE_RAW ? '' : `${task.name} `;

  switch (status) {
    case 'queued':
      return `${taskPrefix}${target} submitted and queued...`;
    case 'dispatched':
      return `${taskPrefix}${target} delivered to ${runtimeLabel} and waiting to start...`;
    case 'running':
      return `${runtimeLabel} is processing ${taskPrefix}${target}...`;
    case 'sending':
      return `Submitting ${taskPrefix}${target}...`;
    default:
      return `${taskPrefix}${target} processing...`;
  }
}

function buildWriteStatusText(status, writeMode) {
  if (status === 'completed') {
    return buildWriteCompletedText(writeMode);
  }
  if (status === 'cancelled') {
    return 'Write-back task stopped.';
  }
  const runtimeLabel = getRuntimeLabel();

  switch (status) {
    case 'queued':
      return 'Write-back request sent and queued...';
    case 'dispatched':
      return `Write-back request delivered to ${runtimeLabel} and waiting to run...`;
    case 'running':
      return buildWriteRunningText(writeMode);
    case 'cancelling':
      return 'Stopping write-back task...';
    case 'sending':
      return 'Submitting write-back request...';
    default:
      return 'Write-back in progress...';
  }
}

function buildCancelStatusText(job = {}) {
  const mode = String(job.runtimeMeta?.cancelMode || '').trim();
  if (mode === 'soft' || mode === 'unsupported') {
    return 'Stopped waiting for this result; the underlying agent may still be running.';
  }

  return 'Task stopped.';
}

function buildWriteRunningText(writeMode) {
  if (state.runtime.standalone) {
    return 'Generating a simulated write-back result. The current page will not change.';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return 'Replacing the previously selected text with the result...';
    case WRITE_MODE_REPLACE_CONTENT:
      return 'Replacing the current page body with the result...';
    default:
      return 'Appending the result to the current page...';
  }
}

function buildWriteCompletedText(writeMode) {
  if (state.runtime.standalone) {
    return 'Simulated write-back completed. The current page was not changed.';
  }

  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return 'The result replaced the previously selected text.';
    case WRITE_MODE_REPLACE_CONTENT:
      return 'The result replaced the current page body.';
    default:
      return 'The result was appended to the current page.';
  }
}

function renderJobState({ status, text, jobId, action, runtimeMeta = {} }) {
  state.currentAction = action || state.currentAction;
  state.currentJobId = jobId || null;
  state.currentStatus = status || '';

  jobIdNode.textContent = jobId ? `#${jobId.slice(0, 8)}` : '';

  const isTerminal = isTerminalJobStatus(status);
  const isWaitingForApproval = status === 'waiting_for_approval';
  const statusMarkup = isTerminal
    ? `<span>${statusLabel(status, action)}</span>`
    : isWaitingForApproval
      ? `<span>${statusLabel(status, action)}</span>`
      : `<span class="n2c-spinner"></span><span>${statusLabel(status, action)}</span>`;
  runStatusNode.innerHTML = statusMarkup;

  activityNoteNode.textContent = text || 'Run status and agent replies appear here.';
  activityNoteNode.classList.toggle('n2c-empty', !text);
  syncApprovalState(status, runtimeMeta.pendingApproval || null);
  updateControls();

  if (state.expanded && state.panelPosition) {
    schedulePanelViewportClamp();
  }
}

function renderBrief() {
  const brief = state.latestBrief || '';
  outputNode.textContent = brief || 'The final Brief appears here.';
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
      return 'Queued';
    case 'dispatched':
      return action === ACTION_WRITE_REPLY ? 'Preparing write-back' : 'Dispatched';
    case 'running':
      return action === ACTION_WRITE_REPLY ? 'Writing back' : 'Processing';
    case 'waiting_for_approval':
      return 'Waiting for confirmation';
    case 'cancelling':
      return 'Stopping';
    case 'cancelled':
      return 'Stopped';
    case 'sending':
      return action === ACTION_WRITE_REPLY ? 'Preparing write-back' : 'Submitting';
    case 'completed':
      return action === ACTION_WRITE_REPLY ? 'Written back' : 'Completed';
    case 'failed':
      return action === ACTION_WRITE_REPLY ? 'Write-back failed' : 'Run failed';
    default:
      return 'Processing';
  }
}

function isTerminalJobStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function getSelectionText() {
  return normalizeSelectionText(window.getSelection()?.toString());
}

function normalizeSelectionText(value) {
  return String(value || '').trim();
}

function rememberLiveSelection() {
  const selectionText = getSelectionText();
  if (!selectionText) {
    return;
  }

  state.lastSelectionText = selectionText;
  state.lastSelectionCapturedAt = Date.now();
}

function captureActionSelectionSnapshot() {
  const selectionText = getSelectionText() || getRecentSelectionText();
  if (!selectionText) {
    return '';
  }

  state.pendingActionSelectionText = selectionText;
  state.pendingActionSelectionCapturedAt = Date.now();
  return selectionText;
}

function captureActionSelectionFromPointer(event) {
  if (event?.isPrimary === false || (event?.pointerType === 'mouse' && event.button !== 0)) {
    return;
  }

  captureActionSelectionSnapshot();
}

function preserveSelectionForActionControl(event) {
  if (event?.button !== 0) {
    return;
  }

  captureActionSelectionSnapshot();
  event.preventDefault();
}

function consumeActionSelectionText() {
  const selectionText = getSelectionText() || getPendingActionSelectionText();
  state.pendingActionSelectionText = '';
  state.pendingActionSelectionCapturedAt = 0;
  return selectionText;
}

function getPendingActionSelectionText() {
  if (
    state.pendingActionSelectionText
    && Date.now() - state.pendingActionSelectionCapturedAt <= ACTION_SELECTION_CACHE_MS
  ) {
    return state.pendingActionSelectionText;
  }

  return '';
}

function getRecentSelectionText() {
  if (
    state.lastSelectionText
    && Date.now() - state.lastSelectionCapturedAt <= ACTION_SELECTION_CACHE_MS
  ) {
    return state.lastSelectionText;
  }

  return '';
}

function getPageTitle() {
  return document.title
    .replace(/\s+\|\s+Notion$/, '')
    .replace(/\s+[-|]\s+(Feishu|Lark|Lark Docs|Feishu Docs).*$/i, '')
    .trim() || `Untitled ${getProviderLabel()} Page`;
}

function detectPageProvider(pageUrl) {
  let url;
  try {
    url = new URL(pageUrl);
  } catch {
    return {
      id: 'notion',
      label: 'Notion',
    };
  }

  if (/(^|\.)notion\.so$/i.test(url.hostname)) {
    return {
      id: 'notion',
      label: 'Notion',
    };
  }

  if (/(^|\.)((feishu\.cn)|(larksuite\.com)|(larkoffice\.com))$/i.test(url.hostname)) {
    return {
      id: 'lark',
      label: url.hostname.includes('larksuite') || url.hostname.includes('larkoffice') ? 'Lark' : 'Feishu',
    };
  }

  return {
    id: '',
    label: 'Document',
  };
}

function getProviderId() {
  return state.pageProvider?.id || detectPageProvider(window.location.href).id || '';
}

function getProviderLabel() {
  return state.pageProvider?.label || detectPageProvider(window.location.href).label || 'Document';
}

function providerUsesRuntimeMcp() {
  return getProviderId() === 'notion';
}

function getCurrentProviderStatus() {
  const providerId = getProviderId();
  const providers = state.documentProviders?.providers;
  if (!providerId || !Array.isArray(providers)) {
    return null;
  }
  return providers.find((provider) => provider.providerId === providerId) || null;
}

function buildSelectionContext(selectionText) {
  const selected = String(selectionText || '').trim();
  if (!selected) {
    return null;
  }

  const bodyText = String(document.body?.innerText || '');
  const index = bodyText.indexOf(selected);
  return {
    beforeText: index === -1 ? '' : bodyText.slice(Math.max(0, index - 500), index),
    afterText: index === -1 ? '' : bodyText.slice(index + selected.length, index + selected.length + 500),
    selectionHash: hashString(selected),
  };
}

function hashString(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function getRuntimeLabel() {
  return state.runtime.label || 'Local Agent';
}

function resolveJobPromptProfile(job) {
  return resolvePromptProfile(job?.promptProfileId || job?.promptProfile?.id || state.promptProfileId, job?.promptProfile);
}

function resolvePromptProfile(value, fallbackProfile = null) {
  const id = normalizePromptProfileId(value);
  const profile = state.promptProfiles.find((item) => item.id === id);
  if (profile) {
    return profile;
  }

  if (fallbackProfile?.id) {
    return {
      ...fallbackProfile,
      id: normalizePromptProfileId(fallbackProfile.id),
      name: String(fallbackProfile.name || fallbackProfile.id).trim() || fallbackProfile.id,
    };
  }

  return {
    id: PROMPT_PROFILE_RAW,
    name: 'Raw',
    instruction: '',
  };
}

function normalizePromptProfileId(value) {
  return String(value || PROMPT_PROFILE_RAW).trim().toLowerCase() || PROMPT_PROFILE_RAW;
}

function normalizePromptProfiles(value) {
  const profiles = Array.isArray(value) ? value : [];
  const normalized = profiles
    .map((profile) => ({
      id: normalizePromptProfileId(profile?.id),
      name: String(profile?.name || '').trim(),
      instruction: String(profile?.instruction || ''),
      editable: profile?.editable !== false,
      deletable: Boolean(profile?.deletable),
      resettable: Boolean(profile?.resettable),
      source: String(profile?.source || ''),
    }))
    .filter((profile) => profile.id && profile.name);

  if (!normalized.some((profile) => profile.id === PROMPT_PROFILE_RAW)) {
    normalized.unshift({
      id: PROMPT_PROFILE_RAW,
      name: 'Raw',
      instruction: '',
      editable: false,
      deletable: false,
      resettable: false,
      source: 'fallback',
    });
  }

  return normalized;
}

async function openPromptManager() {
  state.promptEditorOpen = true;
  state.promptEditorMessage = '';
  if (!state.promptProfiles.some((profile) => profile.id === state.promptEditorProfileId)) {
    state.promptEditorProfileId = state.promptProfileId;
  }
  promptModalNode.classList.remove('n2c-hidden');
  if (state.bridgeReady) {
    await refreshPromptProfiles();
  }
  renderPromptManager();
}

function closePromptManager() {
  state.promptEditorOpen = false;
  promptModalNode.classList.add('n2c-hidden');
}

function stopModalEventPropagation(event) {
  event.stopPropagation();
}

function renderPromptManager() {
  if (!state.promptEditorOpen) {
    return;
  }

  promptEditorListNode.replaceChildren();
  for (const profile of state.promptProfiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'n2c-editor-list-item';
    button.textContent = profile.name;
    button.classList.toggle('active', profile.id === state.promptEditorProfileId);
    button.addEventListener('click', () => {
      state.promptEditorProfileId = profile.id;
      state.promptEditorMessage = '';
      renderPromptManager();
    });
    promptEditorListNode.appendChild(button);
  }

  const selectedProfile = state.promptEditorProfileId === PROMPT_EDITOR_NEW
    ? null
    : state.promptProfiles.find((profile) => profile.id === state.promptEditorProfileId) || state.promptProfiles[0];
  if (selectedProfile && state.promptEditorProfileId !== selectedProfile.id) {
    state.promptEditorProfileId = selectedProfile.id;
  }

  promptNameInput.value = selectedProfile?.name || '';
  promptInstructionInput.value = selectedProfile?.instruction || '';
  promptNameInput.disabled = state.promptEditorBusy || Boolean(selectedProfile && !selectedProfile.editable);
  promptInstructionInput.disabled = state.promptEditorBusy || Boolean(selectedProfile && !selectedProfile.editable);
  promptEditorMessageNode.textContent = state.promptEditorMessage || '';
  promptEditorMessageNode.classList.toggle('n2c-empty', !state.promptEditorMessage);
  newPromptButton.disabled = state.promptEditorBusy || !state.bridgeReady;
  savePromptButton.disabled = state.promptEditorBusy || !state.bridgeReady || Boolean(selectedProfile && !selectedProfile.editable);
  deletePromptButton.disabled = state.promptEditorBusy || !state.bridgeReady || !selectedProfile?.deletable;
  resetPromptButton.disabled = state.promptEditorBusy || !state.bridgeReady || !selectedProfile?.resettable;
  savePromptButton.textContent = state.promptEditorProfileId === PROMPT_EDITOR_NEW ? 'Create' : 'Save';
}

function readPromptEditorDraft() {
  return {
    name: promptNameInput.value.trim(),
    instruction: promptInstructionInput.value.trim(),
  };
}

async function createPromptFromEditor() {
  if (state.promptEditorProfileId !== PROMPT_EDITOR_NEW) {
    state.promptEditorProfileId = PROMPT_EDITOR_NEW;
    state.promptEditorMessage = '';
    renderPromptManager();
    promptNameInput.focus();
    return;
  }

  const draft = readPromptEditorDraft();
  await runPromptEditorMutation(async () => {
    const response = await sendMessage({
      type: 'createPromptProfile',
      profile: draft,
    });
    updatePromptProfilesFromResponse(response);
    state.promptEditorProfileId = response.profile?.id || state.promptProfiles.at(-1)?.id || PROMPT_PROFILE_RAW;
    state.promptProfileId = state.promptEditorProfileId;
    state.promptEditorMessage = 'Created.';
  });
}

async function savePromptFromEditor() {
  if (state.promptEditorProfileId === PROMPT_EDITOR_NEW) {
    await createPromptFromEditor();
    return;
  }

  const profileId = state.promptEditorProfileId;
  const draft = readPromptEditorDraft();
  await runPromptEditorMutation(async () => {
    const response = await sendMessage({
      type: 'updatePromptProfile',
      profileId,
      profile: draft,
    });
    updatePromptProfilesFromResponse(response);
    state.promptProfileId = response.profile?.id || profileId;
    state.promptEditorProfileId = state.promptProfileId;
    state.promptEditorMessage = 'Saved.';
  });
}

async function deletePromptFromEditor() {
  const profile = resolvePromptProfile(state.promptEditorProfileId);
  if (!profile.deletable || !window.confirm(`Delete "${profile.name}"?`)) {
    return;
  }

  await runPromptEditorMutation(async () => {
    const response = await sendMessage({
      type: 'deletePromptProfile',
      profileId: profile.id,
    });
    updatePromptProfilesFromResponse(response);
    if (state.promptProfileId === profile.id) {
      state.promptProfileId = PROMPT_PROFILE_RAW;
      persistPromptProfilePreference(state.promptProfileId);
    }
    state.promptEditorProfileId = state.promptProfileId;
    state.promptEditorMessage = 'Deleted.';
  });
}

async function resetPromptFromEditor() {
  const profile = resolvePromptProfile(state.promptEditorProfileId);
  if (!profile.resettable) {
    return;
  }

  await runPromptEditorMutation(async () => {
    const response = await sendMessage({
      type: 'resetPromptProfile',
      profileId: profile.id,
    });
    updatePromptProfilesFromResponse(response);
    state.promptProfileId = response.profile?.id || profile.id;
    state.promptEditorProfileId = state.promptProfileId;
    state.promptEditorMessage = 'Reset to default.';
  });
}

async function runPromptEditorMutation(callback) {
  state.promptEditorBusy = true;
  state.promptEditorMessage = '';
  renderPromptManager();

  try {
    await callback();
  } catch (error) {
    state.promptEditorMessage = error.message || 'Operation failed.';
  } finally {
    state.promptEditorBusy = false;
    renderPromptButtons();
    updateActionCopy();
    renderPromptManager();
  }
}

function updatePromptProfilesFromResponse(response) {
  const profiles = normalizePromptProfiles(response?.profiles);
  if (profiles.length) {
    state.promptProfiles = profiles;
  }
}

function isSupportedRuntime() {
  return state.runtime.id === 'codex' || state.runtime.id === 'claude';
}

function canOpenRuntimeView() {
  return state.runtime.id === 'codex' && Boolean(state.session?.threadId);
}

function updateControls() {
  const selectionText = getSelectionText();

  renderPromptButtons();
  managePromptsButton.disabled = state.promptEditorBusy || !state.bridgeReady;
  openAppButton.disabled = state.openAppBusy || !canOpenRuntimeView();
  copyButton.disabled = !(state.latestBrief || state.latestReply);
  writeBackButton.textContent = `Write to ${getProviderLabel()}`;
  writeBackButton.classList.toggle('n2c-hidden', !state.manualWritebackVisible);
  writeBackButton.disabled = !state.manualWritebackVisible || state.busy || !canWriteBack(selectionText);
  stopButton.classList.toggle('n2c-hidden', !canShowStopButton());
  stopButton.disabled = state.stopBusy || !canStopCurrentJob();
  approveButton.disabled = !state.pendingApproval || state.approvalBusy;
  declineButton.disabled = !state.pendingApproval || state.approvalBusy;
  approveButton.textContent = state.pendingApproval?.mode === 'url' && !isUrlApprovalReadyToContinue()
    ? 'Open authorization page'
    : 'Allow';
}

function canShowStopButton() {
  return Boolean(state.currentJobId) && state.busy && !isTerminalJobStatus(currentVisibleStatus());
}

function canStopCurrentJob() {
  return Boolean(state.currentJobId) && state.busy && !state.stopBusy && !isTerminalJobStatus(currentVisibleStatus());
}

function currentVisibleStatus() {
  if (state.stopBusy) {
    return 'cancelling';
  }

  return state.currentStatus || '';
}

async function openCodexAppFromPanel() {
  if (!state.session?.threadId || state.openAppBusy) {
    return;
  }

  state.openAppBusy = true;
  openAppButton.textContent = 'Opening';
  updateControls();

  try {
    const response = await sendMessage({ type: 'openCodexApp' });
    activityNoteNode.textContent = response.message || 'Codex App opened.';
    activityNoteNode.classList.remove('n2c-empty');
  } catch (error) {
    activityNoteNode.textContent = error.message || 'Unable to open Codex App.';
    activityNoteNode.classList.remove('n2c-empty');
  } finally {
    state.openAppBusy = false;
    openAppButton.textContent = 'Open Codex App';
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
  if (!isSupportedRuntime() || state.runtime.standalone) {
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
  const runtimeLabel = runtime.label || 'Local Agent';

  if (response.paired && runtime.ready) {
    if (runtime.standalone) {
      return 'Connected to debug mode';
    }

    return response.session?.threadId ? `Connected to ${runtimeLabel} session` : `Connected to ${runtimeLabel}`;
  }

  if (response.awaitingPairCode) {
    return 'Waiting for the 6-digit pairing code';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || 'Local Agent is not ready';
  }

  return 'Open the extension to finish connecting';
}

function canAttemptFullPageDelivery() {
  if (!providerUsesRuntimeMcp()) {
    const provider = getCurrentProviderStatus();
    return getProviderId() !== 'lark' || provider?.status === 'configured';
  }

  return ['configured', 'unknown', 'unauthenticated'].includes(state.notionMcp.status);
}

function canAttemptWriteBack() {
  if (!providerUsesRuntimeMcp()) {
    const provider = getCurrentProviderStatus();
    return getProviderId() !== 'lark' || provider?.status === 'configured';
  }

  return !['missing', 'unavailable'].includes(state.notionMcp.status);
}

function canWriteBack(selectionText) {
  if (!isSupportedRuntime() || state.runtime.standalone) {
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
  if (state.busy) {
    return;
  }

  const latestReply = String(session?.latestSharableAssistantMessage || '').trim();
  if (!latestReply || latestReply === state.latestReply) {
    return;
  }

  state.latestReply = latestReply;
  state.latestBrief = extractBrief(latestReply);
  state.latestReplyJobId = String(session?.latestAssistantJobId || '').trim() || state.latestReplyJobId;
  renderBrief();
}

function clearLatestReplyForNewRun() {
  state.latestReply = '';
  state.latestBrief = '';
  state.latestReplyJobId = null;
  renderBrief();
}

function renderSessionState() {
  if (!state.runtime.ready) {
    openAppButton.textContent = 'Open session';
    openAppButton.title = '';
    return;
  }

  const threadId = String(state.session?.threadId || '').trim();
  if (!threadId) {
    openAppButton.textContent = state.runtime.id === 'codex' ? 'Open Codex App' : 'Claude is in the terminal';
    openAppButton.title = state.runtime.id === 'claude'
      ? 'The Claude Code channel session is in the terminal where you ran notion2cli claude launch'
      : '';
    return;
  }

  openAppButton.textContent = state.runtime.id === 'codex' ? 'Open Codex App' : 'Claude is in the terminal';
  openAppButton.title = state.runtime.id === 'claude'
    ? 'The Claude Code channel session is in the terminal where you ran notion2cli claude launch'
    : '';
}

function sendMessage(message, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : EXTENSION_MESSAGE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('The extension background worker did not respond. Reload the extension and try again.'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeout);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Extension messaging failed'));
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
        text: 'The browser blocked the authorization window. Allow popups and try again.',
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
    activityNoteNode.textContent = 'Authorization page opened. Complete browser authorization, then click Allow again.';
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
    requestClearJobBadge();
    renderJobState({
      status: 'running',
      text: action === 'accept'
        ? 'Allowed to continue. Waiting for the latest progress...'
        : `Declined the current request. Waiting for ${getRuntimeLabel()} to finish this run...`,
      jobId: state.currentJobId,
      action: state.currentAction,
      runtimeMeta: {},
    });
  } catch (error) {
    state.approvalBusy = false;
    renderJobState({
      status: 'failed',
      text: error.message || 'Failed to submit confirmation',
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
  approvalMessageNode.textContent = 'This run needs confirmation before it can continue.';
  updateControls();
}

function buildApprovalMessage(pendingApproval) {
  const base = pendingApproval.message || 'This run needs your confirmation before it can continue.';
  if (pendingApproval.mode === 'url' && pendingApproval.url) {
    if (isUrlApprovalReadyToContinue()) {
      return `${base} Browser authorization appears complete. You can click Allow now.`;
    }

    if (pendingApproval.opened) {
      return `${base} Authorization page is open. Complete browser authorization, then click Allow again.`;
    }

    return `${base} Click Open authorization page first, complete browser authorization, then return to continue.`;
  }

  return base;
}

function classifyJobEvent(job) {
  if (!job) return null;
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'waiting_for_approval') {
    const approval = job.runtimeMeta?.pendingApproval;
    if (approval && (approval.mode === 'url' || approval.kind === 'mcp_auth' || approval.url)) {
      return 'authorization_needed';
    }
  }
  return null;
}

function maybeNotify(job) {
  const event = classifyJobEvent(job);
  if (!event) return;

  const approvalKey = event === 'authorization_needed'
    ? approvalRequestKey(job.runtimeMeta?.pendingApproval) || 'unknown'
    : '';
  const dedupeKey = approvalKey
    ? `${job.id}:${event}:${approvalKey}`
    : `${job.id}:${event}`;

  if (state.notifiedJobEvents.has(dedupeKey)) {
    return;
  }
  state.notifiedJobEvents.add(dedupeKey);

  const pageHidden = document.visibilityState !== 'visible' || document.hidden === true;

  sendMessage({
    type: 'notifyJobEvent',
    event,
    jobId: job.id,
    pageTitle: getPageTitle(),
    pageUrl: window.location.href,
    summary: String(buildJobStateText(job) || '').slice(0, 120),
    shouldShowSystemNotification: pageHidden,
    pageHidden,
  }).catch(() => {});
}

function requestClearJobBadge() {
  sendMessage({ type: 'clearJobBadge' }).catch(() => {});
}

function approvalRequestKey(pendingApproval) {
  if (!pendingApproval || typeof pendingApproval !== 'object') {
    return '';
  }

  return String(pendingApproval.requestId || pendingApproval.url || pendingApproval.message || '').trim();
}

async function loadWriteSettingsPreference() {
  try {
    const data = await chrome.storage.local.get([
      WRITE_MODE_STORAGE_KEY,
      MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY,
      LAST_PROMPT_PROFILE_STORAGE_KEY,
    ]);
    state.writeMode = normalizeWriteMode(data[WRITE_MODE_STORAGE_KEY]);
    state.manualWritebackVisible = data[MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY] === true;
    state.promptProfileId = normalizePromptProfileId(data[LAST_PROMPT_PROFILE_STORAGE_KEY]);
  } catch {
    state.writeMode = WRITE_MODE_APPEND_SECTION;
    state.manualWritebackVisible = false;
    state.promptProfileId = PROMPT_PROFILE_RAW;
  }

  updateActionCopy();
  updateControls();
}

function persistPromptProfilePreference(profileId) {
  chrome.storage.local.set({
    [LAST_PROMPT_PROFILE_STORAGE_KEY]: normalizePromptProfileId(profileId),
  }).catch(() => {});
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
      return `Requesting ${runtimeLabel} to replace the previously selected text...`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `Requesting ${runtimeLabel} to replace the current page body...`;
    default:
      return `Requesting ${runtimeLabel} to write the result back to the current page...`;
  }
}

function buildWriteWaitingText(writeMode, runtimeLabel) {
  switch (writeMode) {
    case WRITE_MODE_UPDATE_CONTENT:
      return `Replace request sent. Waiting for ${runtimeLabel} to finish write-back...`;
    case WRITE_MODE_REPLACE_CONTENT:
      return `Page replacement request sent. Waiting for ${runtimeLabel} to finish write-back...`;
    default:
      return `Write-back request sent. Waiting for ${runtimeLabel} to finish appending...`;
  }
}

function clearPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

import {
  PERMISSION_MODE_DEFAULT,
  buildRuntimeLaunchCommand,
  getPermissionModeHint,
  normalizePermissionMode,
} from './launch-commands.js';

const NOTION_MCP_DOC_URL = 'https://developers.notion.com/guides/mcp/get-started-with-mcp';
const WRITE_MODE_STORAGE_KEY = 'notion2cli.writeMode';
const MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY = 'notion2cli.manualWritebackVisible';
const PERMISSION_MODE_STORAGE_KEY = 'notion2cli.permissionMode';
const WRITE_MODE_APPEND_SECTION = 'append_markdown_section';
const WRITE_MODE_UPDATE_CONTENT = 'update_content';
const WRITE_MODE_REPLACE_CONTENT = 'replace_content';

const popupState = {
  status: null,
  selectedRuntime: 'codex',
  permissionMode: PERMISSION_MODE_DEFAULT,
  writeMode: WRITE_MODE_APPEND_SECTION,
  manualWritebackVisible: false,
  lastErrorMessage: '',
  pairBusy: false,
  installBusy: false,
  installJobId: null,
  installMessage: '',
  installPollTimer: null,
  larkConnectBusy: false,
  larkMessage: '',
};

const popupRoot = document.querySelector('[data-popup-root]');
const statusDot = document.querySelector('[data-status-dot]');
const statusValue = document.querySelector('[data-status-value]');
const statusHint = document.querySelector('[data-status-hint]');
const historyHint = document.querySelector('[data-history-hint]');
const stepCard = document.querySelector('[data-step-card]');
const stepTitle = document.querySelector('[data-step-title]');
const stepBody = document.querySelector('[data-step-body]');
const runtimeSwitch = document.querySelector('[data-runtime-switch]');
const runtimeButtons = [...document.querySelectorAll('[data-runtime-button]')];
const commandStack = document.querySelector('[data-command-stack]');
const commandBlock = document.querySelector('[data-command-block]');
const stepCommandLabel = document.querySelector('[data-step-command-label]');
const commandRow = document.querySelector('[data-command-row]');
const stepCommand = document.querySelector('[data-step-command]');
const copyCommandButton = document.querySelector('[data-copy-command]');
const pairCommandBlock = document.querySelector('[data-pair-command-block]');
const pairCommandLabel = document.querySelector('[data-pair-command-label]');
const pairCommand = document.querySelector('[data-pair-command]');
const copyPairCommandButton = document.querySelector('[data-copy-pair-command]');
const permissionSetup = document.querySelector('[data-permission-setup]');
const permissionModeSelect = document.querySelector('[data-permission-mode-select]');
const permissionModeHint = document.querySelector('[data-permission-mode-hint]');
const stopCommand = document.querySelector('[data-stop-command]');
const copyStopCommandButton = document.querySelector('[data-copy-stop-command]');
const codeInput = document.querySelector('[data-code-input]');
const connectButton = document.querySelector('[data-connect-button]');
const clearButton = document.querySelector('[data-clear-button]');
const pairCard = document.querySelector('[data-pair-card]');
const pairSetup = document.querySelector('[data-pair-setup]');
const accessDetail = document.querySelector('[data-access-detail]');
const installButton = document.querySelector('[data-install-button]');
const installStatus = document.querySelector('[data-install-status]');
const larkConnectButton = document.querySelector('[data-lark-connect-button]');
const larkStatus = document.querySelector('[data-lark-status]');
const manualWritebackToggle = document.querySelector('[data-manual-writeback-toggle]');
const writeModeSelect = document.querySelector('[data-write-mode-select]');
const writeModeHint = document.querySelector('[data-write-mode-hint]');
const notificationsToggle = document.querySelector('[data-notifications-toggle]');
const notificationsStatus = document.querySelector('[data-notifications-status]');

connectButton.addEventListener('click', connectBridge);
codeInput.addEventListener('input', handleCodeInput);
clearButton.addEventListener('click', clearBridge);
copyCommandButton.addEventListener('click', () => copyCommand(stepCommand, copyCommandButton));
copyPairCommandButton.addEventListener('click', () => copyCommand(pairCommand, copyPairCommandButton));
copyStopCommandButton.addEventListener('click', () => copyCommand(stopCommand, copyStopCommandButton));
installButton.addEventListener('click', sendInstallRequest);
larkConnectButton.addEventListener('click', connectLarkProvider);
permissionModeSelect.addEventListener('change', handlePermissionModeChange);
manualWritebackToggle.addEventListener('change', handleManualWritebackVisibleChange);
writeModeSelect.addEventListener('change', handleWriteModeChange);
runtimeButtons.forEach((button) => {
  button.addEventListener('click', () => selectRuntime(button.dataset.runtimeButton));
});
notificationsToggle.addEventListener('change', handleNotificationsToggle);

loadStartupPreference();
loadWriteSettingsPreference();
syncNotificationsToggle();
refreshStatus();
setInterval(() => {
  refreshStatus().catch(() => {});
}, 15000);

async function refreshStatus() {
  try {
    const status = await sendMessage({ type: 'getBridgeStatus' });
    popupState.status = status;
    popupState.lastErrorMessage = '';
    renderStatus(status);
  } catch (error) {
    renderDisconnectedState(error.message || 'Make sure the notion2CLI bridge is running.');
  }
}

function renderStatus(status) {
  const runtime = status.runtime || {};
  const connected = Boolean(status.paired) && Boolean(runtime.ready);
  const access = getAccessState(status);
  const nextStep = getNextStep(status);
  if (runtime.id === 'codex' || runtime.id === 'claude') {
    popupState.selectedRuntime = runtime.id;
  }

  statusDot.classList.toggle('ready', connected);
  statusValue.textContent = buildStatusValue(status);
  statusHint.textContent = buildStatusHint(status);
  renderHistoryHint(status);
  updateVisualState(status, access, connected);
  updateRuntimeSwitch(nextStep.showRuntimeSwitch);
  updatePermissionSetup(nextStep.showPermissionSetup);
  updatePairSection(connected);
  stepCard.classList.toggle('hidden', Boolean(nextStep.hideStepCard));

  stepTitle.textContent = nextStep.title;
  stepBody.textContent = nextStep.body;
  renderCommands(nextStep);

  accessDetail.textContent = appendDocumentProviderDetail(access.detail, status);
  installButton.disabled = access.disabled || popupState.installBusy;
  installButton.textContent = popupState.installBusy ? 'Processing...' : access.button;
  installStatus.textContent = popupState.installMessage || appendDocumentProviderStatus(access.status, status);
  renderLarkAccess(status);
}

function renderDisconnectedState(message) {
  popupState.status = null;
  popupState.lastErrorMessage = message;
  statusDot.classList.remove('ready');
  statusValue.textContent = 'No local runtime connected';
  statusHint.textContent = message;
  historyHint.textContent = '';
  historyHint.classList.add('hidden');
  popupRoot.dataset.state = 'offline';
  stepCard.classList.remove('hidden');
  updateRuntimeSwitch(true);
  updatePermissionSetup(true);
  updatePairSection(false);
  stepTitle.textContent = 'Start CLI';
  stepBody.textContent = 'Run these two commands in order: start the target runtime, then generate a 6-digit pairing code.';
  renderCommands({
    commandLabel: 'Launch command',
    command: getSelectedRuntimeLaunchCommand(),
    secondaryCommandLabel: 'Generate pairing code',
    secondaryCommand: 'notion2cli pair',
  });
  installButton.disabled = true;
  installButton.textContent = 'Waiting for startup';
  accessDetail.textContent = 'Start the CLI, then check Notion MCP and Feishu/Lark access here.';
  installStatus.textContent = 'Cannot check yet.';
  larkConnectButton.disabled = true;
  larkConnectButton.textContent = 'Waiting for startup';
  larkStatus.textContent = 'Cannot check yet.';
}

function updateVisualState(status, access, connected) {
  const runtime = status.runtime || {};

  if (!runtime.ready) {
    popupRoot.dataset.state = 'offline';
    return;
  }

  if (!connected) {
    popupRoot.dataset.state = 'pairing';
    return;
  }

  if (runtime.standalone) {
    popupRoot.dataset.state = 'standalone';
    return;
  }

  popupRoot.dataset.state = access.canInstall ? 'attention' : 'ready';
}

function buildStatusValue(status) {
  const runtime = status.runtime || {};
  const runtimeLabel = runtime.label || 'Local Agent';

  if (status.paired && runtime.ready) {
    return runtime.standalone ? 'Connected to debug mode' : `Connected to ${runtimeLabel}`;
  }

  if (status.awaitingPairCode) {
    return 'Waiting for pairing code';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || 'Local Agent is not ready';
  }

  return 'Browser is not connected';
}

function buildStatusHint(status) {
  const runtime = status.runtime || {};
  const permissionText = runtime.permissionLabel && !runtime.standalone
    ? ` Current permissions: ${runtime.permissionLabel}.`
    : '';

  if (status.paired && runtime.ready) {
    return runtime.standalone
      ? 'Debug mode is active. Page actions return simulated results and do not call real Notion.'
      : `The browser is connected to the current ${runtime.label || 'Agent'} session. Return to the Notion page and click Run current page to start.${permissionText}`;
  }

  if (status.awaitingPairCode) {
    return 'A 6-digit pairing code has been generated. Paste it below to connect this browser to the local session.';
  }

  if (!runtime.ready) {
    return `Start CLI: ${getSelectedRuntimeLaunchCommand()}`;
  }

  return `Run the pairing command to generate a 6-digit code, then finish the localhost bridge connection below.${permissionText}`;
}

function renderHistoryHint(status) {
  const runtime = status.runtime || {};
  let text = '';

  if (status.paired && runtime.ready && !runtime.standalone) {
    if (runtime.id === 'codex') {
      text = 'Open Codex App to view conversation history. Refreshing may require a restart.';
    } else if (runtime.id === 'claude') {
      text = 'View conversation history live in Claude Code.';
    }
  }

  historyHint.textContent = text;
  historyHint.classList.toggle('hidden', !text);
}

function getNextStep(status) {
  const runtime = status.runtime || {};
  const access = getAccessState(status);

  if (!runtime.ready) {
    return {
      title: 'Start CLI',
      body: 'Run these two commands in order: start the target runtime, then generate a 6-digit pairing code.',
      commandLabel: 'Launch command',
      command: getSelectedRuntimeLaunchCommand(),
      secondaryCommandLabel: 'Generate pairing code',
      secondaryCommand: 'notion2cli pair',
      showRuntimeSwitch: true,
      showPermissionSetup: true,
    };
  }

  if (!status.paired || status.awaitingPairCode) {
    return {
      title: status.awaitingPairCode ? 'Paste the pairing code' : 'Generate a pairing code',
      body: 'Run this command to get a 6-digit code, then paste it into the input below.',
      commandLabel: 'Generate pairing code',
      command: runtime.pairingCommand || 'notion2cli pair',
      showRuntimeSwitch: false,
    };
  }

  if (!runtime.standalone && access.canInstall) {
    return {
      title: 'Enable Notion MCP',
      body: `The browser is connected to the current ${runtime.label || 'Agent'} session. Configure Notion MCP next to enable full-page runs and manual write-back.`,
      command: '',
      showRuntimeSwitch: false,
    };
  }

  return {
    title: '',
    body: '',
    command: '',
    showRuntimeSwitch: false,
    hideStepCard: true,
  };
}

function getAccessState(status) {
  const runtime = status.runtime || {};
  const notionMcp = status.notionMcp || {};

  if (!runtime.ready) {
    return {
      detail: 'Start the CLI, then check Notion MCP here.',
      status: 'Not checked yet.',
      button: 'Waiting for startup',
      disabled: true,
      canInstall: false,
    };
  }

  if (!status.paired) {
    return {
      detail: 'Finish browser connection, then enable Notion MCP for the current runtime.',
      status: 'Continue after connection completes.',
      button: 'Finish connection',
      disabled: true,
      canInstall: false,
    };
  }

  if (runtime.standalone) {
    return {
      detail: 'Standalone debug mode is active and does not call real Notion MCP.',
      status: 'Only simulated results are returned here.',
      button: 'Unavailable in debug mode',
      disabled: true,
      canInstall: false,
    };
  }

  switch (notionMcp.status) {
    case 'configured':
      return {
        detail: notionMcp.detail || 'The current runtime can read and write Notion.',
        status: 'No extra setup needed.',
        button: 'Enabled',
        disabled: true,
        canInstall: false,
      };
    case 'unauthenticated':
      if (runtime.id === 'claude') {
        return {
          detail: notionMcp.detail || 'Claude Code Notion MCP is configured, but authorization is not complete.',
          status: 'Full-page reads show a browser authorization link in Activity. Write-back authorization may also appear in the Claude terminal.',
          button: 'Authorize when needed',
          disabled: true,
          canInstall: false,
        };
      }

      return {
        detail: notionMcp.detail || 'Notion MCP is configured, but authorization is still required.',
        status: 'After authorization, full-page runs and write-back will work again.',
        button: 'Continue authorization',
        disabled: false,
        canInstall: true,
        pendingText: 'Starting authorization request...',
        waitText: `Authorization request sent. Waiting for ${runtime.label || 'Agent'} to finish...`,
      };
    case 'missing':
      return {
        detail: notionMcp.detail || 'The current runtime does not have Notion MCP configured.',
        status: 'Enable it to read full pages and write results back.',
        button: 'Enable Notion MCP',
        disabled: false,
        canInstall: true,
        pendingText: 'Enabling Notion MCP...',
        waitText: `Enable request sent. Waiting for ${runtime.label || 'Agent'} to finish...`,
      };
    case 'unavailable':
      return {
        detail: notionMcp.detail || 'The current mode does not call real Notion MCP.',
        status: 'Switch to a real runtime to continue.',
        button: 'Currently unavailable',
        disabled: true,
        canInstall: false,
      };
    default:
      return {
        detail: notionMcp.detail || 'Notion MCP status cannot be confirmed automatically yet.',
        status: 'If full-page runs or write-back fail, check the official docs.',
        button: 'Try to fix',
        disabled: false,
        canInstall: true,
        pendingText: 'Trying to fix Notion MCP...',
        waitText: `Fix request sent. Waiting for ${runtime.label || 'Agent'} to handle it...`,
      };
  }
}

function appendDocumentProviderDetail(detail, status) {
  const lark = getDocumentProviderStatus(status, 'lark');
  if (!lark?.detail) {
    return detail;
  }

  return `${detail} Feishu/Lark: ${lark.detail}`;
}

function appendDocumentProviderStatus(statusText, status) {
  const lark = getDocumentProviderStatus(status, 'lark');
  if (!lark?.status) {
    return statusText;
  }

  return `${statusText} Feishu/Lark provider: ${lark.status}.`;
}

function renderLarkAccess(status) {
  const runtime = status.runtime || {};
  const lark = getDocumentProviderStatus(status, 'lark');
  const waiting = lark?.status === 'authorization_pending';
  const connected = lark?.status === 'configured';
  const disabled = !runtime.ready || !status.paired || popupState.larkConnectBusy || connected;

  larkConnectButton.disabled = disabled;
  if (popupState.larkConnectBusy) {
    larkConnectButton.textContent = 'Starting...';
  } else if (connected) {
    larkConnectButton.textContent = 'Feishu/Lark connected';
  } else if (waiting) {
    larkConnectButton.textContent = 'Continue Feishu/Lark';
  } else {
    larkConnectButton.textContent = 'Connect Feishu/Lark';
  }

  if (popupState.larkMessage) {
    larkStatus.textContent = popupState.larkMessage;
    return;
  }

  if (!runtime.ready) {
    larkStatus.textContent = 'Start the local bridge first.';
    return;
  }
  if (!status.paired) {
    larkStatus.textContent = 'Pair this browser before connecting Feishu/Lark.';
    return;
  }
  if (waiting && lark.activeFlow?.verificationUrl) {
    larkStatus.textContent = `Authorization is waiting in your browser: ${lark.activeFlow.verificationUrl}`;
    return;
  }
  larkStatus.textContent = lark?.detail || 'Feishu/Lark access has not been checked yet.';
}

function getDocumentProviderStatus(status, providerId) {
  const providers = status?.documentProviders?.providers;
  if (!Array.isArray(providers)) {
    return null;
  }

  return providers.find((provider) => provider.providerId === providerId) || null;
}

async function connectBridge() {
  if (popupState.pairBusy) {
    return;
  }

  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    statusValue.textContent = 'Invalid pairing code format';
    statusHint.textContent = 'Enter 6 digits. The pairing code comes from the Generate pairing code command above.';
    return;
  }

  popupState.pairBusy = true;
  connectButton.disabled = true;
  codeInput.disabled = true;
  connectButton.textContent = 'Connecting...';

  try {
    await sendMessage({ type: 'pairBridge', code });
    codeInput.value = '';
    popupState.installMessage = '';
    popupState.larkMessage = '';
    await refreshStatus();
  } catch (error) {
    statusDot.classList.remove('ready');
    statusValue.textContent = 'Connection failed';
    statusHint.textContent = error.message || 'Start the local CLI bridge, generate a fresh pairing code, and try again.';
  } finally {
    popupState.pairBusy = false;
    connectButton.disabled = false;
    codeInput.disabled = false;
    connectButton.textContent = 'Connect with pairing code';
  }
}

async function connectLarkProvider() {
  if (popupState.larkConnectBusy) {
    return;
  }

  popupState.larkConnectBusy = true;
  popupState.larkMessage = 'Starting Feishu/Lark local authorization...';
  if (popupState.status) {
    renderStatus(popupState.status);
  }

  try {
    const result = await sendMessage({ type: 'connectLarkProvider' });
    if (result.verificationUrl) {
      popupState.larkMessage = `Open this URL to continue: ${result.verificationUrl}`;
      try {
        window.open(result.verificationUrl, '_blank', 'noreferrer');
      } catch {}
    } else {
      popupState.larkMessage = result.detail || 'Feishu/Lark is connected.';
    }
    await refreshStatus();
  } catch (error) {
    popupState.larkMessage = error.message || 'Failed to start Feishu/Lark authorization.';
  } finally {
    popupState.larkConnectBusy = false;
    if (popupState.status) {
      renderStatus(popupState.status);
    }
  }
}

function handleCodeInput() {
  const normalized = codeInput.value.replace(/\D/g, '').slice(0, 6);
  if (codeInput.value !== normalized) {
    codeInput.value = normalized;
  }

  if (normalized.length === 6) {
    connectBridge();
  }
}

async function clearBridge() {
  clearInstallPolling();
  popupState.installBusy = false;
  popupState.installJobId = null;
  popupState.installMessage = '';
  popupState.larkConnectBusy = false;
  popupState.larkMessage = '';
  await sendMessage({ type: 'clearPairing' });
  await refreshStatus();
}

function renderCommands(step) {
  renderCommandBlock({
    block: commandBlock,
    labelNode: stepCommandLabel,
    codeNode: stepCommand,
    command: step.command,
    label: step.commandLabel || '',
  });

  renderCommandBlock({
    block: pairCommandBlock,
    labelNode: pairCommandLabel,
    codeNode: pairCommand,
    command: step.secondaryCommand,
    label: step.secondaryCommandLabel || '',
  });

  commandStack.classList.toggle('hidden', !step.command && !step.secondaryCommand);
}

function updatePairSection(connected) {
  pairSetup.classList.toggle('hidden', connected);
  pairCard.classList.toggle('pair-card-minimal', connected);
}

function renderCommandBlock({ block, labelNode, codeNode, command, label }) {
  block.classList.toggle('hidden', !command);
  if (!command) {
    return;
  }

  labelNode.classList.toggle('hidden', !label);
  labelNode.textContent = label;
  codeNode.textContent = command;
}

async function copyCommand(codeNode, buttonNode) {
  const command = codeNode.textContent.trim();
  if (!command) {
    return;
  }

  await navigator.clipboard.writeText(command);
  buttonNode.textContent = 'Copied';
  setTimeout(() => {
    buttonNode.textContent = 'Copy';
  }, 1400);
}

async function sendInstallRequest() {
  const status = popupState.status;
  const access = status ? getAccessState(status) : null;
  if (!status || !access || access.disabled || popupState.installBusy) {
    return;
  }

  popupState.installBusy = true;
  popupState.installMessage = access.pendingText || 'Processing...';
  renderStatus(status);

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action: 'install_notion_mcp',
        pageUrl: 'chrome-extension://notion2cli/setup',
        pageTitle: 'notion2CLI setup',
        installPrompt: `Follow the official Notion MCP docs to complete installation and authorization: ${NOTION_MCP_DOC_URL}`,
        officialDocUrl: NOTION_MCP_DOC_URL,
        source: 'chrome-extension-popup',
      },
    });

    popupState.installJobId = response.jobId;
    popupState.installMessage = access.waitText || 'Request sent. Waiting for the agent to handle it...';
    renderStatus(status);
    pollInstallJob(response.jobId);
  } catch (error) {
    popupState.installBusy = false;
    popupState.installMessage = error.message || 'Request failed';
    renderStatus(status);
  }
}

function pollInstallJob(jobId) {
  clearInstallPolling();
  popupState.installPollTimer = setInterval(async () => {
    try {
      const response = await sendMessage({
        type: 'getJobStatus',
        jobId,
      });
      const job = response.job;
      popupState.installMessage = job.replyText || job.error || formatJobStatus(job.status);

      if (job.status === 'completed' || job.status === 'failed') {
        popupState.installBusy = false;
        popupState.installJobId = null;
        clearInstallPolling();
        await refreshStatus();
        return;
      }

      if (popupState.status) {
        renderStatus(popupState.status);
      }
    } catch (error) {
      popupState.installBusy = false;
      popupState.installJobId = null;
      popupState.installMessage = error.message || 'Failed to read setup status';
      clearInstallPolling();
      if (popupState.status) {
        renderStatus(popupState.status);
      }
    }
  }, 1800);
}

function clearInstallPolling() {
  if (popupState.installPollTimer) {
    clearInterval(popupState.installPollTimer);
    popupState.installPollTimer = null;
  }
}

function selectRuntime(runtimeId) {
  if (!runtimeId || popupState.selectedRuntime === runtimeId) {
    return;
  }

  popupState.selectedRuntime = runtimeId;
  if (popupState.status) {
    renderStatus(popupState.status);
    return;
  }

  renderDisconnectedState(popupState.lastErrorMessage || 'Make sure the notion2CLI bridge is running.');
}

function updateRuntimeSwitch(visible) {
  runtimeSwitch.classList.toggle('hidden', !visible);
  runtimeButtons.forEach((button) => {
    const active = button.dataset.runtimeButton === popupState.selectedRuntime;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updatePermissionSetup(visible) {
  permissionSetup.classList.toggle('hidden', !visible);
  permissionModeSelect.value = popupState.permissionMode;
  permissionModeHint.textContent = getPermissionModeHint(popupState.permissionMode);
}

function getSelectedRuntimeLaunchCommand() {
  return buildRuntimeLaunchCommand(popupState.selectedRuntime, popupState.permissionMode);
}

async function loadStartupPreference() {
  try {
    const data = await chrome.storage.local.get([PERMISSION_MODE_STORAGE_KEY]);
    popupState.permissionMode = normalizePermissionMode(data[PERMISSION_MODE_STORAGE_KEY]);
  } catch {
    popupState.permissionMode = PERMISSION_MODE_DEFAULT;
  }

  updatePermissionSetup(true);
  if (popupState.status) {
    renderStatus(popupState.status);
    return;
  }

  renderDisconnectedState(popupState.lastErrorMessage || 'Make sure the notion2CLI bridge is running.');
}

async function handlePermissionModeChange() {
  popupState.permissionMode = normalizePermissionMode(permissionModeSelect.value);
  updatePermissionSetup(true);
  if (popupState.status) {
    renderStatus(popupState.status);
  } else {
    renderDisconnectedState(popupState.lastErrorMessage || 'Make sure the notion2CLI bridge is running.');
  }

  try {
    await chrome.storage.local.set({
      [PERMISSION_MODE_STORAGE_KEY]: popupState.permissionMode,
    });
  } catch {}
}

async function loadWriteSettingsPreference() {
  try {
    const data = await chrome.storage.local.get([
      WRITE_MODE_STORAGE_KEY,
      MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY,
    ]);
    popupState.writeMode = normalizeWriteMode(data[WRITE_MODE_STORAGE_KEY]);
    popupState.manualWritebackVisible = data[MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY] === true;
  } catch {
    popupState.writeMode = WRITE_MODE_APPEND_SECTION;
    popupState.manualWritebackVisible = false;
  }

  renderWriteSettingsUi();
}

async function handleManualWritebackVisibleChange() {
  popupState.manualWritebackVisible = Boolean(manualWritebackToggle.checked);
  renderWriteSettingsUi();

  try {
    await chrome.storage.local.set({
      [MANUAL_WRITEBACK_VISIBLE_STORAGE_KEY]: popupState.manualWritebackVisible,
    });
  } catch {}
}

async function handleWriteModeChange() {
  popupState.writeMode = normalizeWriteMode(writeModeSelect.value);
  renderWriteSettingsUi();

  try {
    await chrome.storage.local.set({
      [WRITE_MODE_STORAGE_KEY]: popupState.writeMode,
    });
  } catch {}
}

function renderWriteSettingsUi() {
  popupState.writeMode = normalizeWriteMode(popupState.writeMode);
  manualWritebackToggle.checked = popupState.manualWritebackVisible;
  writeModeSelect.value = popupState.writeMode;

  const copy = getWriteModeCopy(popupState.writeMode);
  writeModeHint.hidden = !popupState.manualWritebackVisible;
  writeModeHint.textContent = popupState.manualWritebackVisible ? copy.hint : '';
  writeModeHint.classList.toggle('config-note-danger', popupState.manualWritebackVisible && copy.tone === 'danger');
}

function getWriteModeCopy(mode) {
  if (mode === WRITE_MODE_UPDATE_CONTENT) {
    return {
      tone: 'warning',
      hint: 'When you click Write to Notion, the latest reply replaces the text currently selected on the page. Select the target text before writing back.',
    };
  }

  if (mode === WRITE_MODE_REPLACE_CONTENT) {
    return {
      tone: 'danger',
      hint: 'When you click Write to Notion, the latest reply replaces the page body. This is high risk and should be used only when you understand the result.',
    };
  }

  return {
    tone: 'default',
    hint: 'When you click Write to Notion, the latest reply is appended to the page without changing existing content. This is the recommended default.',
  };
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

async function syncNotificationsToggle() {
  try {
    const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
    notificationsToggle.checked = granted;
    notificationsStatus.textContent = granted
      ? 'Browser notifications are enabled.'
      : 'Browser notifications are disabled. Only the toolbar badge is shown.';
  } catch (error) {
    notificationsStatus.textContent = error.message || 'Cannot read notifications permission.';
  }
}

async function handleNotificationsToggle() {
  if (notificationsToggle.checked) {
    try {
      const granted = await chrome.permissions.request({ permissions: ['notifications'] });
      if (!granted) {
        notificationsToggle.checked = false;
      }
    } catch (error) {
      notificationsToggle.checked = false;
      notificationsStatus.textContent = error.message || 'Failed to request notifications permission.';
      return;
    }
  } else {
    try {
      await chrome.permissions.remove({ permissions: ['notifications'] });
    } catch {}
  }

  await syncNotificationsToggle();
}

function formatJobStatus(status) {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'dispatched':
      return 'Dispatched';
    case 'running':
      return 'Processing';
    case 'waiting_for_approval':
      return 'Waiting for confirmation';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Run failed';
    default:
      return 'Processing';
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
        reject(new Error(response?.error || 'Extension messaging failed'));
        return;
      }

      resolve(response.result);
    });
  });
}

const NOTION_MCP_DOC_URL = 'https://developers.notion.com/guides/mcp/get-started-with-mcp';

const popupState = {
  status: null,
  selectedRuntime: 'codex',
  lastErrorMessage: '',
  installBusy: false,
  installJobId: null,
  installMessage: '',
  installPollTimer: null,
};

const popupRoot = document.querySelector('[data-popup-root]');
const statusDot = document.querySelector('[data-status-dot]');
const statusValue = document.querySelector('[data-status-value]');
const statusHint = document.querySelector('[data-status-hint]');
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
const codeInput = document.querySelector('[data-code-input]');
const connectButton = document.querySelector('[data-connect-button]');
const clearButton = document.querySelector('[data-clear-button]');
const pairCard = document.querySelector('[data-pair-card]');
const pairSetup = document.querySelector('[data-pair-setup]');
const accessDetail = document.querySelector('[data-access-detail]');
const installButton = document.querySelector('[data-install-button]');
const installStatus = document.querySelector('[data-install-status]');

connectButton.addEventListener('click', connectBridge);
clearButton.addEventListener('click', clearBridge);
copyCommandButton.addEventListener('click', () => copyCommand(stepCommand, copyCommandButton));
copyPairCommandButton.addEventListener('click', () => copyCommand(pairCommand, copyPairCommandButton));
installButton.addEventListener('click', sendInstallRequest);
runtimeButtons.forEach((button) => {
  button.addEventListener('click', () => selectRuntime(button.dataset.runtimeButton));
});

refreshStatus();

async function refreshStatus() {
  try {
    const status = await sendMessage({ type: 'getBridgeStatus' });
    popupState.status = status;
    popupState.lastErrorMessage = '';
    renderStatus(status);
  } catch (error) {
    renderDisconnectedState(error.message || '请确认 notion2CLI bridge 已启动。');
  }
}

function renderStatus(status) {
  const runtime = status.runtime || {};
  const connected = Boolean(status.paired) && Boolean(runtime.ready);
  const access = getAccessState(status);
  const nextStep = getNextStep(status);

  statusDot.classList.toggle('ready', connected);
  statusValue.textContent = buildStatusValue(status);
  statusHint.textContent = buildStatusHint(status);
  updateVisualState(status, access, connected);
  updateRuntimeSwitch(nextStep.showRuntimeSwitch);
  updatePairSection(connected);

  stepTitle.textContent = nextStep.title;
  stepBody.textContent = nextStep.body;
  renderCommands(nextStep);

  accessDetail.textContent = access.detail;
  installButton.disabled = access.disabled || popupState.installBusy;
  installButton.textContent = popupState.installBusy ? '处理中…' : access.button;
  installStatus.textContent = popupState.installMessage || access.status;
}

function renderDisconnectedState(message) {
  popupState.status = null;
  popupState.lastErrorMessage = message;
  statusDot.classList.remove('ready');
  statusValue.textContent = '没有连接本地 Agent';
  statusHint.textContent = message;
  popupRoot.dataset.state = 'offline';
  updateRuntimeSwitch(true);
  updatePairSection(false);
  stepTitle.textContent = '启动 CLI';
  stepBody.textContent = '按顺序运行下面两条命令：启动 CLI 后，再生成 6 位配对码。';
  renderCommands({
    commandLabel: '启动命令',
    command: getSelectedRuntimeLaunchCommand(),
    secondaryCommandLabel: '生成配对码',
    secondaryCommand: 'notion2cli pair',
  });
  installButton.disabled = true;
  installButton.textContent = '等待启动';
  accessDetail.textContent = '启动 CLI 后，再在这里检查 Notion MCP。';
  installStatus.textContent = '当前无法检查。';
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
  const runtimeLabel = runtime.label || '本地 Agent';

  if (status.paired && runtime.ready) {
    return runtime.standalone ? '已连接调试模式' : `已连接 ${runtimeLabel}`;
  }

  if (status.awaitingPairCode) {
    return '等待输入配对码';
  }

  if (!runtime.ready) {
    return runtime.statusMessage || '本地 Agent 未就绪';
  }

  return '浏览器尚未连接';
}

function buildStatusHint(status) {
  const runtime = status.runtime || {};

  if (status.paired && runtime.ready) {
    return runtime.standalone
      ? '当前是调试模式：页面内操作会返回模拟结果，不会调用真实 Notion。'
      : '页面内按钮现在可以发送当前页、查看结果，并直接写回 Notion。';
  }

  if (status.awaitingPairCode) {
    return '已经生成 6 位配对码。把数字贴到下方，就能把当前浏览器连到本地 Agent。';
  }

  if (!runtime.ready) {
    return `启动 CLI：${getSelectedRuntimeLaunchCommand()}`;
  }

  return '运行配对命令生成 6 位码，再在下方完成浏览器连接。';
}

function getNextStep(status) {
  const runtime = status.runtime || {};
  const access = getAccessState(status);

  if (!runtime.ready) {
    return {
      title: '启动 CLI',
      body: '按顺序运行下面两条命令：启动 CLI 后，再生成 6 位配对码。',
      commandLabel: '启动命令',
      command: getSelectedRuntimeLaunchCommand(),
      secondaryCommandLabel: '生成配对码',
      secondaryCommand: 'notion2cli pair',
      showRuntimeSwitch: true,
    };
  }

  if (!status.paired || status.awaitingPairCode) {
    return {
      title: status.awaitingPairCode ? '把配对码贴回来' : '生成一个配对码',
      body: '运行下面的命令拿到 6 位数字，然后贴到下方的输入框里。',
      commandLabel: '生成配对码',
      command: runtime.pairingCommand || 'notion2cli pair',
      showRuntimeSwitch: false,
    };
  }

  if (!runtime.standalone && access.canInstall) {
    return {
      title: '启用 Notion MCP',
      body: '浏览器已经连上本地 Agent。接下来只要为当前 runtime 完成 Notion MCP 配置或授权。',
      command: '',
      showRuntimeSwitch: false,
    };
  }

  return {
    title: '退出命令',
    body: '如果你想结束本地 Agent，可以运行下面的命令。',
    commandLabel: '',
    command: 'notion2cli daemon stop',
    showRuntimeSwitch: false,
  };
}

function getAccessState(status) {
  const runtime = status.runtime || {};
  const notionMcp = status.notionMcp || {};

  if (!runtime.ready) {
    return {
      detail: '启动 CLI 后，再在这里检查 Notion MCP。',
      status: '还没有开始检查。',
      button: '等待启动',
      disabled: true,
      canInstall: false,
    };
  }

  if (!status.paired) {
    return {
      detail: '完成浏览器连接，再为当前 runtime 启用 Notion MCP。',
      status: '连接完成后可继续。',
      button: '完成连接',
      disabled: true,
      canInstall: false,
    };
  }

  if (runtime.standalone) {
    return {
      detail: '当前是 standalone 调试模式，不会调用真实 Notion MCP。',
      status: '这里只会返回模拟结果。',
      button: '调试模式不可用',
      disabled: true,
      canInstall: false,
    };
  }

  switch (notionMcp.status) {
    case 'configured':
      return {
        detail: notionMcp.detail || '当前 runtime 已可读取和写回 Notion。',
        status: '无需额外设置。',
        button: '已启用',
        disabled: true,
        canInstall: false,
      };
    case 'unauthenticated':
      return {
        detail: notionMcp.detail || '已经检测到 Notion MCP 配置，但你还需要完成一次授权。',
        status: '完成授权后，整页发送和写回都会恢复。',
        button: '继续授权',
        disabled: false,
        canInstall: true,
        pendingText: '正在发起授权请求…',
        waitText: '授权请求已发出，等待本地 Agent 完成…',
      };
    case 'missing':
      return {
        detail: notionMcp.detail || '当前 runtime 还没有配置 Notion MCP。',
        status: '启用后才能读取整页并写回结果。',
        button: '启用 Notion MCP',
        disabled: false,
        canInstall: true,
        pendingText: '正在启用 Notion MCP…',
        waitText: '启用请求已发出，等待本地 Agent 完成…',
      };
    case 'unavailable':
      return {
        detail: notionMcp.detail || '当前模式不会调用真实 Notion MCP。',
        status: '切换到真实 runtime 后再继续。',
        button: '当前不可用',
        disabled: true,
        canInstall: false,
      };
    default:
      return {
        detail: notionMcp.detail || '现在还无法自动确认 Notion MCP 状态。',
        status: '如果发送整页或写回失败，请查看官方文档。',
        button: '尝试修复',
        disabled: false,
        canInstall: true,
        pendingText: '正在尝试修复 Notion MCP…',
        waitText: '修复请求已发出，等待本地 Agent 处理…',
      };
  }
}

async function connectBridge() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    statusValue.textContent = '配对码格式不正确';
    statusHint.textContent = '请输入 6 位数字。配对码来自上面的生成配对码命令。';
    return;
  }

  connectButton.disabled = true;
  connectButton.textContent = '连接中…';

  try {
    await sendMessage({ type: 'pairBridge', code });
    codeInput.value = '';
    popupState.installMessage = '';
    await refreshStatus();
  } catch (error) {
    statusDot.classList.remove('ready');
    statusValue.textContent = '连接失败';
    statusHint.textContent = error.message || '请重新生成配对码后再试一次。';
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = '连接浏览器';
  }
}

async function clearBridge() {
  clearInstallPolling();
  popupState.installBusy = false;
  popupState.installJobId = null;
  popupState.installMessage = '';
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
  buttonNode.textContent = '已复制';
  setTimeout(() => {
    buttonNode.textContent = '复制';
  }, 1400);
}

async function sendInstallRequest() {
  const status = popupState.status;
  const access = status ? getAccessState(status) : null;
  if (!status || !access || access.disabled || popupState.installBusy) {
    return;
  }

  popupState.installBusy = true;
  popupState.installMessage = access.pendingText || '正在处理…';
  renderStatus(status);

  try {
    const response = await sendMessage({
      type: 'submitNotionAction',
      payload: {
        action: 'install_notion_mcp',
        pageUrl: 'chrome-extension://notion2cli/setup',
        pageTitle: 'notion2CLI setup',
        installPrompt: `按照以下 notion 官方文档完成 notion MCP 的安装与授权：${NOTION_MCP_DOC_URL}`,
        officialDocUrl: NOTION_MCP_DOC_URL,
        source: 'chrome-extension-popup',
      },
    });

    popupState.installJobId = response.jobId;
    popupState.installMessage = access.waitText || '请求已发出，等待本地 Agent 处理…';
    renderStatus(status);
    pollInstallJob(response.jobId);
  } catch (error) {
    popupState.installBusy = false;
    popupState.installMessage = error.message || '发送请求失败';
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
      popupState.installMessage = error.message || '读取安装状态失败';
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

  renderDisconnectedState(popupState.lastErrorMessage || '请确认 notion2CLI bridge 已启动。');
}

function updateRuntimeSwitch(visible) {
  runtimeSwitch.classList.toggle('hidden', !visible);
  runtimeButtons.forEach((button) => {
    const active = button.dataset.runtimeButton === popupState.selectedRuntime;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function getSelectedRuntimeLaunchCommand() {
  if (popupState.selectedRuntime === 'claude') {
    return 'notion2cli daemon start --runtime claude';
  }

  return 'notion2cli daemon start --runtime codex';
}

function formatJobStatus(status) {
  switch (status) {
    case 'queued':
      return '已排队';
    case 'dispatched':
      return '已发出';
    case 'running':
      return '处理中';
    case 'waiting_for_approval':
      return '等待确认';
    case 'completed':
      return '执行完成';
    case 'failed':
      return '执行失败';
    default:
      return '处理中';
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

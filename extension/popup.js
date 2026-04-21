const NOTION_MCP_DOC_URL = 'https://developers.notion.com/guides/mcp/get-started-with-mcp';

const popupState = {
  status: null,
  installBusy: false,
  installJobId: null,
  installMessage: '',
  installPollTimer: null,
};

const statusDot = document.querySelector('[data-status-dot]');
const statusValue = document.querySelector('[data-status-value]');
const statusHint = document.querySelector('[data-status-hint]');
const runtimePill = document.querySelector('[data-runtime-pill]');
const accessPill = document.querySelector('[data-access-pill]');
const stepTitle = document.querySelector('[data-step-title]');
const stepBody = document.querySelector('[data-step-body]');
const commandRow = document.querySelector('[data-command-row]');
const stepCommand = document.querySelector('[data-step-command]');
const copyCommandButton = document.querySelector('[data-copy-command]');
const codeInput = document.querySelector('[data-code-input]');
const connectButton = document.querySelector('[data-connect-button]');
const clearButton = document.querySelector('[data-clear-button]');
const accessDetail = document.querySelector('[data-access-detail]');
const installButton = document.querySelector('[data-install-button]');
const installStatus = document.querySelector('[data-install-status]');

connectButton.addEventListener('click', connectBridge);
clearButton.addEventListener('click', clearBridge);
copyCommandButton.addEventListener('click', copySuggestedCommand);
installButton.addEventListener('click', sendInstallRequest);

refreshStatus();

async function refreshStatus() {
  try {
    const status = await sendMessage({ type: 'getBridgeStatus' });
    popupState.status = status;
    renderStatus(status);
  } catch (error) {
    popupState.status = null;
    statusDot.classList.remove('ready');
    statusValue.textContent = '无法连接本地 Agent';
    statusHint.textContent = error.message || '请确认 notion2CLI bridge 已启动。';
    runtimePill.textContent = '本地 Agent';
    runtimePill.className = 'pill muted';
    accessPill.textContent = '未检查';
    accessPill.className = 'pill muted';
    stepTitle.textContent = '先启动本地 Agent';
    stepBody.textContent = '启动完成后，这里会自动显示连接与授权状态。';
    stepCommand.textContent = 'notion2cli daemon start --runtime codex';
    commandRow.classList.remove('hidden');
    installButton.disabled = true;
    installButton.textContent = '等待启动';
    accessDetail.textContent = '启动本地 Agent 后，再在这里检查 Notion 访问。';
    installStatus.textContent = '当前无法检查。';
  }
}

function renderStatus(status) {
  const runtime = status.runtime || {};
  const runtimeLabel = runtime.label || '本地 Agent';
  const connected = Boolean(status.paired) && Boolean(runtime.ready);
  const access = getAccessState(status);
  const nextStep = getNextStep(status);

  statusDot.classList.toggle('ready', connected);
  statusValue.textContent = buildStatusValue(status);
  statusHint.textContent = buildStatusHint(status);

  runtimePill.textContent = runtimeLabel;
  runtimePill.className = 'pill';
  accessPill.textContent = access.pill;
  accessPill.className = `pill ${access.pillTone}`.trim();

  stepTitle.textContent = nextStep.title;
  stepBody.textContent = nextStep.body;
  stepCommand.textContent = nextStep.command || '当前不需要额外命令';
  commandRow.classList.toggle('hidden', !nextStep.command);

  accessDetail.textContent = access.detail;
  installButton.disabled = access.disabled || popupState.installBusy;
  installButton.textContent = popupState.installBusy ? '处理中…' : access.button;
  installStatus.textContent = popupState.installMessage || access.status;
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
    return runtime.launchCommand
      ? `先启动本地 Agent：${runtime.launchCommand}`
      : (runtime.statusMessage || '请先启动 notion2CLI bridge。');
  }

  return '先运行配对命令生成 6 位码，再在下方完成浏览器连接。';
}

function getNextStep(status) {
  const runtime = status.runtime || {};
  const access = getAccessState(status);

  if (!runtime.ready) {
    return {
      title: '先启动本地 Agent',
      body: '启动后这里会自动识别当前 runtime，并告诉你后续步骤。',
      command: runtime.launchCommand || '',
    };
  }

  if (!status.paired || status.awaitingPairCode) {
    return {
      title: status.awaitingPairCode ? '把配对码贴回来' : '生成一个配对码',
      body: '运行下面的命令拿到 6 位数字，然后贴到下方的输入框里。',
      command: runtime.pairingCommand || 'notion2cli pair',
    };
  }

  if (!runtime.standalone && access.canInstall) {
    return {
      title: '启用 Notion 访问',
      body: '浏览器已经连上本地 Agent。接下来只要为当前 runtime 完成 Notion 配置或授权。',
      command: '',
    };
  }

  return {
    title: '回到页面开始使用',
    body: '连接与权限都已经准备好。现在去 Notion 页面，用右下角按钮发送当前页或选中内容。',
    command: '',
  };
}

function getAccessState(status) {
  const runtime = status.runtime || {};
  const notionMcp = status.notionMcp || {};

  if (!runtime.ready) {
    return {
      pill: '等待启动',
      pillTone: 'muted',
      detail: '启动本地 Agent 后，再在这里检查 Notion 访问。',
      status: '还没有开始检查。',
      button: '等待启动',
      disabled: true,
      canInstall: false,
    };
  }

  if (!status.paired) {
    return {
      pill: '等待连接',
      pillTone: 'muted',
      detail: '先完成浏览器连接，再为当前 runtime 启用 Notion 访问。',
      status: '连接完成后可继续。',
      button: '先完成连接',
      disabled: true,
      canInstall: false,
    };
  }

  if (runtime.standalone) {
    return {
      pill: '调试模式',
      pillTone: 'warning',
      detail: '当前是 standalone 调试模式，不会调用真实 Notion。',
      status: '这里只会返回模拟结果。',
      button: '调试模式不可用',
      disabled: true,
      canInstall: false,
    };
  }

  switch (notionMcp.status) {
    case 'configured':
      return {
        pill: 'Notion 已就绪',
        pillTone: '',
        detail: notionMcp.detail || '当前 runtime 已可读取和写回 Notion。',
        status: '无需额外设置。',
        button: '已启用',
        disabled: true,
        canInstall: false,
      };
    case 'unauthenticated':
      return {
        pill: '需要授权',
        pillTone: 'warning',
        detail: notionMcp.detail || '已经检测到配置，但你还需要完成一次授权。',
        status: '完成授权后，整页发送和写回都会恢复。',
        button: '继续授权',
        disabled: false,
        canInstall: true,
        pendingText: '正在发起授权请求…',
        waitText: '授权请求已发出，等待本地 Agent 完成…',
      };
    case 'missing':
      return {
        pill: '未启用',
        pillTone: 'warning',
        detail: notionMcp.detail || '当前 runtime 还没有配置 Notion 访问。',
        status: '启用后才能读取整页并写回结果。',
        button: '启用 Notion 访问',
        disabled: false,
        canInstall: true,
        pendingText: '正在启用 Notion 访问…',
        waitText: '启用请求已发出，等待本地 Agent 完成…',
      };
    case 'unavailable':
      return {
        pill: '当前不可用',
        pillTone: 'warning',
        detail: notionMcp.detail || '当前模式不会调用真实 Notion。',
        status: '切换到真实 runtime 后再继续。',
        button: '当前不可用',
        disabled: true,
        canInstall: false,
      };
    default:
      return {
        pill: '状态未知',
        pillTone: 'muted',
        detail: notionMcp.detail || '现在还无法自动确认 Notion 访问状态。',
        status: '如果发送整页或写回失败，请先查看官方文档。',
        button: '尝试修复',
        disabled: false,
        canInstall: true,
        pendingText: '正在尝试修复 Notion 访问…',
        waitText: '修复请求已发出，等待本地 Agent 处理…',
      };
  }
}

async function connectBridge() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    statusValue.textContent = '配对码格式不正确';
    statusHint.textContent = '请输入 6 位数字。配对码来自上面的“下一步”命令。';
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

async function copySuggestedCommand() {
  if (commandRow.classList.contains('hidden')) {
    return;
  }

  await navigator.clipboard.writeText(stepCommand.textContent);
  copyCommandButton.textContent = '已复制';
  setTimeout(() => {
    copyCommandButton.textContent = '复制';
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

import {
  ACTION_FORWARD_SELECTION,
  ACTION_INSTALL_NOTION_MCP,
  ACTION_WRITE_REPLY,
} from '../core/constants.mjs';

export class StandaloneRuntime {
  constructor(log) {
    this.id = 'standalone';
    this.label = 'Standalone Simulator';
    this.log = log;
    this.context = null;
  }

  async start(context) {
    this.context = context;
    this.log('standalone mode enabled');
  }

  async stop() {}

  async startPairing() {}

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, {
      type: 'sent_to_standalone_simulator',
    });

    setTimeout(() => {
      this.context.completeJob(job.id, buildStandaloneReply(job), {
        type: 'standalone_reply',
      });
      this.log('standalone reply generated', { jobId: job.id });
    }, 1200);
  }

  async respondToApproval() {
    throw new Error('Standalone runtime does not support approval callbacks');
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'simulator',
        ready: true,
        standalone: true,
        sessionAttached: false,
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli daemon start --runtime standalone',
        statusMessage: 'standalone 本地调试模式已就绪。',
      },
      capabilities: {
        supportsInteractiveSessionAttach: false,
        supportsStandaloneDispatch: true,
        supportsNotionRead: false,
        supportsNotionWrite: false,
        supportsInstallGuidance: false,
      },
      notionMcp: {
        status: 'unavailable',
        detail: 'standalone 模式不会调用真实 Notion MCP。',
      },
    };
  }
}

function buildStandaloneReply(job) {
  if (job.action === ACTION_WRITE_REPLY) {
    return [
      '当前是 standalone 本地调试模式，下面是模拟写回结果。',
      '',
      `会向页面《${job.pageTitle}》追加一个标题为“${job.writeSectionTitle}”的新 section。`,
      '',
      job.replyTextToWrite.slice(0, 600),
    ].join('\n');
  }

  if (job.action === ACTION_FORWARD_SELECTION) {
    return [
      '当前是 standalone 本地调试模式，下面是模拟回复。',
      '',
      `我收到的选中文本是：${job.selectionText || '(空文本)'}`,
    ].join('\n');
  }

  if (job.action === ACTION_INSTALL_NOTION_MCP) {
    return [
      '当前是 standalone 本地调试模式，下面是模拟安装提示。',
      '',
      job.installPrompt || '请按官方文档完成 Notion MCP 的安装与授权。',
    ].join('\n');
  }

  return [
    '当前是 standalone 本地调试模式，下面是模拟回复。',
    '',
    `我会在真实模式下通过 Notion MCP 读取页面《${job.pageTitle}》的全文并处理它。`,
  ].join('\n');
}

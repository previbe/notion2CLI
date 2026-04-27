import {
  ACTION_FORWARD_SELECTION,
  ACTION_INSTALL_NOTION_MCP,
  ACTION_WRITE_REPLY,
  WRITE_MODE_REPLACE_CONTENT,
  WRITE_MODE_UPDATE_CONTENT,
} from '../core/constants.mjs';

export class StandaloneRuntime {
  constructor(log) {
    this.id = 'standalone';
    this.label = 'Standalone Simulator';
    this.log = log;
    this.context = null;
    this.timers = new Map();
  }

  async start(context) {
    this.context = context;
    this.log('standalone mode enabled');
  }

  async stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  async startPairing() {}

  async dispatchJob(job) {
    this.context.markJobDispatched(job.id, {
      type: 'sent_to_standalone_simulator',
    });

    const timer = setTimeout(() => {
      this.timers.delete(job.id);
      this.context.completeJob(job.id, buildStandaloneReply(job), {
        type: 'standalone_reply',
      });
      this.log('standalone reply generated', { jobId: job.id });
    }, 1200);
    this.timers.set(job.id, timer);
  }

  async cancelJob(jobId) {
    const timer = this.timers.get(jobId);
    if (!timer) {
      return {
        ok: true,
        mode: 'unsupported',
        message: 'No pending standalone timer was found for this job.',
      };
    }

    clearTimeout(timer);
    this.timers.delete(jobId);
    return {
      ok: true,
      mode: 'hard',
      message: 'Standalone timer was cleared.',
    };
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
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli daemon start --runtime standalone',
        statusMessage: 'standalone 本地调试模式已就绪。',
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
    if (job.writeMode === WRITE_MODE_UPDATE_CONTENT) {
      return [
        '当前是 standalone 本地调试模式，下面是模拟写回结果。',
        '',
        `会在页面《${job.pageTitle}》里把当前选中的原文替换为新的内容。`,
        '',
        `原文：${job.selectionText || '(空选区)'}`,
        '',
        job.replyTextToWrite.slice(0, 600),
      ].join('\n');
    }

    if (job.writeMode === WRITE_MODE_REPLACE_CONTENT) {
      return [
        '当前是 standalone 本地调试模式，下面是模拟写回结果。',
        '',
        `会用新的 Markdown 内容覆盖页面《${job.pageTitle}》的正文。`,
        '',
        job.replyTextToWrite.slice(0, 600),
      ].join('\n');
    }

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
      Array.isArray(job.inputBundle?.images) && job.inputBundle.images.length
        ? `同时还附带了 ${job.inputBundle.images.length} 张页面图片工件。`
        : null,
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
    job.inputBundle?.pageBundle
      ? `bridge 已经预取页面《${job.pageTitle}》的全文 bundle，真实 runtime 会优先消费这份 bundle。`
      : `我会在真实模式下通过 Notion MCP 读取页面《${job.pageTitle}》的全文并处理它。`,
    Array.isArray(job.inputBundle?.images) && job.inputBundle.images.length
      ? `当前还检测到了 ${job.inputBundle.images.length} 张页面图片，真实 runtime 会把它们一并交给 CLI。`
      : null,
  ].join('\n');
}

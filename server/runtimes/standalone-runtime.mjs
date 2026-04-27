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
        statusMessage: 'Standalone local debug mode is ready.',
      },
      notionMcp: {
        status: 'unavailable',
        detail: 'Standalone mode does not call real Notion MCP.',
      },
    };
  }
}

function buildStandaloneReply(job) {
  if (job.action === ACTION_WRITE_REPLY) {
    if (job.writeMode === WRITE_MODE_UPDATE_CONTENT) {
      return [
        'Standalone local debug mode is active. This is a simulated write-back result.',
        '',
        `Would update page "${job.pageTitle}" by replacing the currently selected text with new content.`,
        '',
        `Raw: ${job.selectionText || '(empty selection)'}`,
        '',
        job.replyTextToWrite.slice(0, 600),
      ].join('\n');
    }

    if (job.writeMode === WRITE_MODE_REPLACE_CONTENT) {
      return [
        'Standalone local debug mode is active. This is a simulated write-back result.',
        '',
        `Would replace the Markdown body of page "${job.pageTitle}".`,
        '',
        job.replyTextToWrite.slice(0, 600),
      ].join('\n');
    }

    return [
      'Standalone local debug mode is active. This is a simulated write-back result.',
      '',
      `Would append to page "${job.pageTitle}" a new section titled "${job.writeSectionTitle}".`,
      '',
      job.replyTextToWrite.slice(0, 600),
    ].join('\n');
  }

  if (job.action === ACTION_FORWARD_SELECTION) {
    return [
      'Standalone local debug mode is active. This is a simulated reply.',
      '',
      `Selected text received: ${job.selectionText || '(empty text)'}`,
      Array.isArray(job.inputBundle?.images) && job.inputBundle.images.length
        ? `Also received ${job.inputBundle.images.length} page image artifacts.`
        : null,
    ].join('\n');
  }

  if (job.action === ACTION_INSTALL_NOTION_MCP) {
    return [
      'Standalone local debug mode is active. This is a simulated setup response.',
      '',
      job.installPrompt || 'Follow the official docs to install and authorize Notion MCP.',
    ].join('\n');
  }

  return [
    'Standalone local debug mode is active. This is a simulated reply.',
    '',
    job.inputBundle?.pageBundle
      ? `The bridge has prefetched the full-page bundle for "${job.pageTitle}". A real runtime would consume that bundle first.`
      : `In real mode, I would read the full page "${job.pageTitle}" through Notion MCP and process it.`,
    Array.isArray(job.inputBundle?.images) && job.inputBundle.images.length
      ? `Detected ${job.inputBundle.images.length} page images. A real runtime would pass them to the CLI.`
      : null,
  ].join('\n');
}

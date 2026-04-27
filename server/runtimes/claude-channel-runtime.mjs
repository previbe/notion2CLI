import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildClaudeChannelPrompt } from '../core/codex-prompt.mjs';
import { ACTION_INSTALL_NOTION_MCP } from '../core/constants.mjs';
import { ClaudeRuntime } from './claude-runtime.mjs';

const DEFAULT_CHANNEL_TIMEOUT_MS = 10 * 60 * 1000;

export class ClaudeChannelRuntime {
  constructor(log, options = {}) {
    this.id = 'claude';
    this.label = 'Claude Code';
    this.log = log;
    this.context = null;
    this.cwd = options.cwd || process.cwd();
    this.connected = false;
    this.statusMessage = 'Waiting for a Claude Code channel session to attach.';
    this.channelName = buildClaudeChannelName(this.cwd);
    this.runningJobs = new Map();
    this.turnCount = 0;
    this.latestUserMessage = '';
    this.latestUserAt = null;
    this.latestAssistantMessage = '';
    this.latestAssistantAt = null;
    this.latestSharableAssistantMessage = '';
    this.latestSharableAssistantAt = null;
    this.workerRuntime = new ClaudeRuntime(log, {
      cwd: this.cwd,
      extraArgs: buildWorkerExtraArgs(),
    });

    this.mcp = new Server(
      { name: 'notion2cli-bridge', version: '0.1.0' },
      {
        capabilities: {
          experimental: { 'claude/channel': {} },
          tools: {},
        },
        instructions: buildClaudeChannelInstructions(),
      },
    );

    this.registerHandlers();
  }

  registerHandlers() {
    this.mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'reply',
          description: 'Reply back to the notion2cli browser panel for a specific channel job.',
          inputSchema: {
            type: 'object',
            properties: {
              chat_id: {
                type: 'string',
                description: 'The notion2cli job id from the channel event metadata or prompt.',
              },
              text: {
                type: 'string',
                description: 'The final user-facing reply to show in the browser panel.',
              },
              status: {
                type: 'string',
                enum: ['completed', 'failed'],
                description: 'Optional terminal status for the job.',
              },
            },
            required: ['chat_id', 'text'],
          },
        },
      ],
    }));

    this.mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'reply') {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const args = request.params.arguments ?? {};
      const jobId = String(args.chat_id || '').trim();
      const text = String(args.text ?? '').trim();
      const status = args.status === 'failed' ? 'failed' : 'completed';

      if (!jobId) {
        throw new Error('reply.chat_id is required');
      }

      if (!this.runningJobs.has(jobId)) {
        throw new Error(`Unknown or already completed notion2cli job: ${jobId}`);
      }

      this.finishJob(jobId, status, text);

      return {
        content: [
          {
            type: 'text',
            text: `Stored ${status} reply for ${jobId}`,
          },
        ],
      };
    });
  }

  async start(context) {
    this.context = context;
    await this.workerRuntime.start(context);
    await this.mcp.connect(new StdioServerTransport());
    this.connected = true;
    this.statusMessage = 'Claude Code channel session is attached to the notion2cli bridge.';
  }

  async stop() {
    for (const jobId of this.runningJobs.keys()) {
      this.clearJobTimer(jobId);
    }
    this.runningJobs.clear();
    await this.workerRuntime.stop();
    await this.mcp.close?.();
  }

  async startPairing() {
    if (!this.connected) {
      throw new Error(this.statusMessage || 'Claude Code channel is not connected');
    }
  }

  async fetchPageBundle(request) {
    if (!this.workerRuntime.ready) {
      throw new Error(this.workerRuntime.statusMessage || 'Claude Code worker is not ready');
    }

    return await this.workerRuntime.fetchPageBundle(request);
  }

  async dispatchJob(job) {
    if (!this.connected) {
      throw new Error(this.statusMessage || 'Claude Code channel is not connected');
    }

    if (job.action === ACTION_INSTALL_NOTION_MCP) {
      await this.workerRuntime.installNotionMcp(job);
      return;
    }

    const prompt = buildClaudeChannelPrompt(job, {
      notionMcpHint: 'Use the configured Notion MCP tools when the action requires write-back. For full-page reading, use the attached bridge-prepared page bundle as the source of truth.',
    });

    this.runningJobs.set(job.id, {
      startedAt: new Date().toISOString(),
      timer: this.startJobTimer(job.id),
    });
    this.turnCount += 1;
    this.latestUserMessage = resolveLatestUserMessage(job);
    this.latestUserAt = new Date().toISOString();

    try {
      await this.mcp.notification({
        method: 'notifications/claude/channel',
        params: {
          content: prompt,
          meta: {
            chat_id: job.id,
            action: job.action,
            runtime: 'claude',
            transport: 'claude-channel',
            has_selection: job.selectionText ? 'true' : 'false',
            page_title: safeMetaValue(job.pageTitle, 80),
            page_url: safeMetaValue(job.pageUrl, 240),
          },
        },
      });
    } catch (error) {
      this.clearJobTimer(job.id);
      this.runningJobs.delete(job.id);
      throw error;
    }

    this.context.markJobDispatched(job.id, {
      type: 'sent_to_claude_channel',
      runtimeMeta: buildRuntimeMeta({
        sessionId: this.channelName,
      }),
    });
    this.context.markJobRunning(job.id, {
      type: 'claude_channel_running',
      runtimeMeta: buildRuntimeMeta({
        sessionId: this.channelName,
        pendingApproval: null,
      }),
    });
    this.log('job sent to claude channel', { jobId: job.id });
  }

  async respondToApproval(jobId, resolution) {
    if (this.workerRuntime.runningJobs?.has(jobId)) {
      await this.workerRuntime.respondToApproval(jobId, resolution);
      return;
    }

    throw new Error('Claude channel approval happens inside the active Claude Code session');
  }

  async cancelJob(jobId) {
    if (this.workerRuntime.runningJobs?.has(jobId) && typeof this.workerRuntime.cancelJob === 'function') {
      return await this.workerRuntime.cancelJob(jobId);
    }

    if (!this.runningJobs.has(jobId)) {
      return {
        ok: true,
        mode: 'unsupported',
        message: 'No active Claude channel job was found for this stop request.',
      };
    }

    this.clearJobTimer(jobId);
    this.runningJobs.delete(jobId);
    return {
      ok: true,
      mode: 'soft',
      message: 'Stopped waiting for the Claude Code channel reply. The terminal session may still finish the task.',
    };
  }

  async getStatus() {
    const workerStatus = await this.workerRuntime.getStatus();
    const ready = Boolean(this.connected);

    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'claude-channel',
        ready,
        standalone: false,
        cwd: this.cwd,
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli claude launch',
        attachCommand: 'notion2cli claude inspect',
        statusMessage: this.statusMessage,
      },
      session: this.getSnapshot(),
      notionMcp: workerStatus.notionMcp,
    };
  }

  getSnapshot() {
    return {
      ready: this.connected,
      runtime: 'claude',
      transport: 'claude-channel',
      sessionId: this.channelName,
      threadId: this.channelName,
      threadName: this.channelName,
      sessionName: this.channelName,
      appVisible: this.connected,
      visibleInNativeClient: this.connected,
      turnCount: this.turnCount,
      latestUserMessage: this.latestUserMessage || '',
      latestUserAt: this.latestUserAt,
      latestAssistantMessage: this.latestAssistantMessage || '',
      latestAssistantAt: this.latestAssistantAt,
      latestSharableAssistantMessage: this.latestSharableAssistantMessage || '',
      latestSharableAssistantAt: this.latestSharableAssistantAt,
      lastVerifiedAt: this.connected ? new Date().toISOString() : null,
      lastVerificationError: '',
      openCommand: 'notion2cli claude inspect',
      inspectCommand: 'notion2cli claude inspect',
      attachCommand: 'notion2cli claude inspect',
      queueDepth: this.runningJobs.size,
      activeJobId: [...this.runningJobs.keys()][0] || '',
      pendingApproval: null,
    };
  }

  startJobTimer(jobId) {
    const timeoutMs = Number(process.env.NOTION2CLI_CLAUDE_CHANNEL_TIMEOUT_MS || DEFAULT_CHANNEL_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (!this.runningJobs.has(jobId)) {
        return;
      }

      this.runningJobs.delete(jobId);
      this.context.failJob(jobId, 'Claude Code received the channel event but did not call the notion2cli reply tool before the timeout.', {
        type: 'claude_channel_reply_timeout',
        runtimeMeta: buildRuntimeMeta({
          sessionId: this.channelName,
        }),
      });
    }, timeoutMs);
    timer.unref?.();
    return timer;
  }

  clearJobTimer(jobId) {
    const entry = this.runningJobs.get(jobId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
  }

  finishJob(jobId, status, text) {
    this.clearJobTimer(jobId);
    this.runningJobs.delete(jobId);

    const now = new Date().toISOString();
    this.latestAssistantMessage = text;
    this.latestAssistantAt = now;
    this.latestSharableAssistantMessage = text;
    this.latestSharableAssistantAt = now;

    if (status === 'failed') {
      this.context.failJob(jobId, text || 'Claude channel job failed', {
        type: 'claude_channel_reply_failed',
        runtimeMeta: buildRuntimeMeta({
          sessionId: this.channelName,
        }),
      });
      return;
    }

    this.context.completeJob(jobId, text, {
      type: 'claude_channel_reply_completed',
      runtimeMeta: buildRuntimeMeta({
        sessionId: this.channelName,
        appVisible: true,
        turnCount: this.turnCount,
      }),
    });
    this.log('claude channel reply stored', { jobId, status });
  }
}

export function buildClaudeChannelName(cwd) {
  const projectName = path.basename(path.resolve(cwd || process.cwd())) || 'workspace';
  return `notion2CLI - ${projectName}`;
}

function buildClaudeChannelInstructions() {
  return [
    'Events from notion2cli arrive as Claude channel messages with a chat_id metadata field.',
    'Each event is a browser user action that originated from a Notion page on the local machine.',
    'The channel message content already contains the complete notion2cli action prompt, including page bundle markdown and local image artifact paths when available.',
    'Treat the event as the next user request in this Claude Code session.',
    'After determining the final user-facing reply, call the reply tool exactly once with the same chat_id and with text equal to the reply that should be shown in the browser panel.',
    'If the task fails, call reply with status "failed" and a concise error explanation.',
    'Do not call reply before you have completed the user-facing answer.',
    'Answer in Chinese by default unless the event clearly asks for another language.',
  ].join(' ');
}

function buildRuntimeMeta(overrides = {}) {
  return {
    runtime: 'claude',
    transport: 'claude-channel',
    ...overrides,
  };
}

function buildWorkerExtraArgs() {
  const args = [];
  const configPath = String(process.env.NOTION2CLI_CLAUDE_WORKER_MCP_CONFIG || '').trim();
  if (configPath) {
    args.push('--mcp-config', configPath, '--strict-mcp-config');
  }
  return args;
}

function resolveLatestUserMessage(job) {
  if (job.action === 'forward_selection_text') {
    return job.selectionText || '';
  }

  if (job.action === 'write_reply_to_notion') {
    return job.replyTextToWrite || '';
  }

  if (job.inputBundle?.pageBundle?.markdown) {
    return job.inputBundle.pageBundle.markdown;
  }

  return job.pageTitle || job.pageUrl || '';
}

function safeMetaValue(value, maxLength) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

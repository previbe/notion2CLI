import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildClaudeInstructions } from '../core/instructions.mjs';
import { safeMetaValue } from '../core/constants.mjs';

export class ClaudeRuntime {
  constructor(log) {
    this.id = 'claude';
    this.label = 'Claude Code';
    this.log = log;
    this.context = null;
    this.connected = false;
    this.mcp = new Server(
      { name: 'notion2cli-bridge', version: '0.2.0' },
      {
        capabilities: {
          experimental: { 'claude/channel': {} },
          tools: {},
        },
        instructions: buildClaudeInstructions(),
      },
    );

    this.mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'reply',
          description: 'Reply back to the notion2cli browser panel for a specific job.',
          inputSchema: {
            type: 'object',
            properties: {
              chat_id: {
                type: 'string',
                description: 'The job id from the channel tag.',
              },
              text: {
                type: 'string',
                description: 'The markdown reply to show in the browser panel.',
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
      const text = String(args.text ?? '');
      const status = args.status === 'failed' ? 'failed' : 'completed';

      if (!jobId) {
        throw new Error('reply.chat_id is required');
      }

      if (status === 'failed') {
        this.context.failJob(jobId, text, {
          type: 'reply',
          runtimeMeta: { runtime: 'claude' },
        });
      } else {
        this.context.completeJob(jobId, text, {
          type: 'reply',
          runtimeMeta: { runtime: 'claude' },
        });
      }

      this.log('reply stored', { jobId, status });

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
    await this.mcp.connect(new StdioServerTransport());
    this.connected = true;
  }

  async stop() {}

  async startPairing() {
    if (!this.connected) {
      throw new Error('Claude runtime is not connected');
    }
  }

  async dispatchJob(job) {
    const payload = JSON.stringify(
      {
        action: job.action,
        pageUrl: job.pageUrl,
        pageTitle: job.pageTitle,
        selectionText: job.selectionText,
        replyTextToWrite: job.replyTextToWrite,
        writeMode: job.writeMode,
        writeSectionTitle: job.writeSectionTitle,
        sourceReplyJobId: job.sourceReplyJobId,
        installPrompt: job.installPrompt,
        officialDocUrl: job.officialDocUrl,
        source: job.source,
        requestedAt: job.createdAt,
      },
      null,
      2,
    );

    await this.mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: payload,
        meta: {
          chat_id: job.id,
          action: job.action,
          has_selection: job.selectionText ? 'true' : 'false',
          write_mode: job.writeMode,
          official_doc_url: safeMetaValue(job.officialDocUrl, 240),
          page_title: safeMetaValue(job.pageTitle, 80),
          page_url: safeMetaValue(job.pageUrl, 240),
        },
      },
    });

    this.context.markJobDispatched(job.id, {
      type: 'sent_to_claude',
      runtimeMeta: { runtime: 'claude' },
    });
    this.log('job sent to claude', { jobId: job.id });
  }

  async getStatus() {
    return {
      runtime: {
        id: this.id,
        label: this.label,
        launchMode: 'embedded-session',
        ready: this.connected,
        standalone: false,
        sessionAttached: true,
        pairingCommand: 'notion2cli pair',
        launchCommand: 'notion2cli claude launch',
        statusMessage: this.connected ? 'Claude Code 会话已附着 notion2cli bridge。' : '等待 Claude Code 会话附着。',
      },
      capabilities: {
        supportsInteractiveSessionAttach: true,
        supportsStandaloneDispatch: false,
        supportsNotionRead: true,
        supportsNotionWrite: true,
        supportsInstallGuidance: true,
      },
      notionMcp: {
        status: 'unknown',
        detail: '当前无法从 bridge 内部自动确认 Claude 会话里的 Notion MCP 状态。',
      },
    };
  }
}

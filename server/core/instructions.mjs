import {
  ACTION_FORWARD_FULL_PAGE,
  ACTION_FORWARD_SELECTION,
  ACTION_INSTALL_NOTION_MCP,
  ACTION_WRITE_REPLY,
} from './constants.mjs';

export function buildCommonActionRules() {
  return [
    'Treat each notion2cli event as a browser user action that originated from a Notion page on the local machine.',
    'Always inspect the JSON action field before deciding what to do.',
    `If action is "${ACTION_FORWARD_SELECTION}", treat selectionText as the authoritative user input. Use page metadata only as context, and do not fetch the whole page unless the request truly requires extra context.`,
    `If action is "${ACTION_FORWARD_FULL_PAGE}", use the configured Notion MCP tools to fetch the current page from pageUrl before answering. Prefer Notion MCP content as the source of truth for the full document, not browser DOM text. If Notion MCP is unavailable, unauthenticated, or lacks access to the page, say that clearly and do not pretend you read the document.`,
    `If action is "${ACTION_FORWARD_FULL_PAGE}", mention briefly if the fetched page content appears partial or truncated.`,
    `If action is "${ACTION_WRITE_REPLY}", first resolve the target page from pageUrl using Notion MCP, then append replyTextToWrite back to that same page using a non-destructive append flow. Prefer appending a new markdown section to the end of the page instead of replacing existing content.`,
    `For "${ACTION_WRITE_REPLY}", use writeSectionTitle when provided. Unless the payload explicitly says otherwise, do not overwrite existing Notion content and do not use destructive replace modes.`,
    `If action is "${ACTION_INSTALL_NOTION_MCP}", treat installPrompt as a direct user instruction for the current runtime. Use officialDocUrl as the canonical Notion documentation link. Complete any safe, idempotent local setup step you can. If a manual OAuth or browser step still remains, say exactly what remains.`,
    'Answer in Chinese by default unless the user content clearly asks for another language.',
    'Keep the reply compact and readable in a small browser panel unless the request clearly needs more detail.',
  ];
}

export function buildClaudeInstructions() {
  return [
    'Events from notion2cli arrive as <channel source="notion2cli_bridge" chat_id="..." ...>JSON</channel>.',
    ...buildCommonActionRules(),
    'After handling the current action, call the reply tool exactly once with the same chat_id so the browser panel receives the result too.',
  ].join(' ');
}


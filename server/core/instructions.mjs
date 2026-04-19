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
    'If local image artifacts are attached, they came from images on the currently open Notion page. Inspect them directly as images whenever the request could depend on visual content, rather than only reading their original URLs.',
    'If a pageBundle or bundled markdown payload is attached, treat it as the bridge-prepared source of truth for the page body. Do not re-fetch the whole page just to restate the same content.',
    `If action is "${ACTION_FORWARD_SELECTION}", treat selectionText as the authoritative user input. Use page metadata only as context, and do not fetch the whole page unless the request truly requires extra context.`,
    `If action is "${ACTION_FORWARD_FULL_PAGE}", use the attached pageBundle as the source of truth for the full document. If the bundle itself says content is partial or unavailable, explain that clearly and do not pretend you read the missing parts.`,
    `If action is "${ACTION_FORWARD_FULL_PAGE}" and attached image artifacts are present, combine the page text source with those local images to understand screenshots, diagrams, and other visual content from the same page.`,
    `If action is "${ACTION_FORWARD_FULL_PAGE}", mention briefly if the fetched page content appears partial or truncated.`,
    `If action is "${ACTION_WRITE_REPLY}", first resolve the target page from pageUrl using Notion MCP, then inspect writeMode before writing anything.`,
    `For "${ACTION_WRITE_REPLY}" with writeMode "append_markdown_section", append replyTextToWrite to the same page using a non-destructive append flow. Prefer inserting a new markdown section at the end of the page and use writeSectionTitle when provided.`,
    `For "${ACTION_WRITE_REPLY}" with writeMode "update_content", treat selectionText as the exact text to replace. Use Notion's targeted search-and-replace flow, replace only that exact selection, and do not fall back to append or full-page replace if the selection is missing or not found.`,
    `For "${ACTION_WRITE_REPLY}" with writeMode "replace_content", replace the page body with replyTextToWrite. This is destructive by design, so do not preserve the old body unless the payload explicitly asks for it.`,
    `If action is "${ACTION_INSTALL_NOTION_MCP}", treat installPrompt as a direct user instruction for the current runtime. Use officialDocUrl as the canonical Notion documentation link. Complete any safe, idempotent local setup step you can. If a manual OAuth or browser step still remains, say exactly what remains.`,
    'Answer in Chinese by default unless the user content clearly asks for another language.',
    'Keep the reply compact and readable in a small browser panel unless the request clearly needs more detail.',
  ];
}

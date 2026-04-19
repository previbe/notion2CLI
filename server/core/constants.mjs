export const HOST = '127.0.0.1';
export const DEFAULT_PORT = Number(process.env.NOTION2CLI_PORT || 43821);
export const PAIR_TTL_MS = 5 * 60 * 1000;
export const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

export const ACTION_FORWARD_SELECTION = 'forward_selection_text';
export const ACTION_FORWARD_FULL_PAGE = 'forward_full_page_via_mcp';
export const ACTION_WRITE_REPLY = 'write_reply_to_notion';
export const ACTION_INSTALL_NOTION_MCP = 'install_notion_mcp';

export const ACTIONS = new Set([
  ACTION_FORWARD_SELECTION,
  ACTION_FORWARD_FULL_PAGE,
  ACTION_WRITE_REPLY,
  ACTION_INSTALL_NOTION_MCP,
]);

export const DEFAULT_WRITE_MODE = 'append_markdown_section';
export const DEFAULT_WRITE_SECTION_TITLE = 'notion2CLI';

export const JOB_STATUS_QUEUED = 'queued';
export const JOB_STATUS_DISPATCHED = 'dispatched';
export const JOB_STATUS_RUNNING = 'running';
export const JOB_STATUS_COMPLETED = 'completed';
export const JOB_STATUS_FAILED = 'failed';

export const TERMINAL_JOB_STATUSES = new Set([
  JOB_STATUS_COMPLETED,
  JOB_STATUS_FAILED,
]);

export function nowIso() {
  return new Date().toISOString();
}

export function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function safeMetaValue(value, maxLength) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function readBearer(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }

  return header.slice('Bearer '.length).trim();
}

export function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}


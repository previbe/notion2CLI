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

export const WRITE_MODE_APPEND_SECTION = 'append_markdown_section';
export const WRITE_MODE_UPDATE_CONTENT = 'update_content';
export const WRITE_MODE_REPLACE_CONTENT = 'replace_content';

export const WRITE_MODES = new Set([
  WRITE_MODE_APPEND_SECTION,
  WRITE_MODE_UPDATE_CONTENT,
  WRITE_MODE_REPLACE_CONTENT,
]);

export const DEFAULT_WRITE_MODE = WRITE_MODE_APPEND_SECTION;
export const DEFAULT_WRITE_SECTION_TITLE = 'notion2CLI';

export const JOB_STATUS_QUEUED = 'queued';
export const JOB_STATUS_DISPATCHED = 'dispatched';
export const JOB_STATUS_RUNNING = 'running';
export const JOB_STATUS_WAITING_FOR_APPROVAL = 'waiting_for_approval';
export const JOB_STATUS_CANCELLING = 'cancelling';
export const JOB_STATUS_COMPLETED = 'completed';
export const JOB_STATUS_FAILED = 'failed';
export const JOB_STATUS_CANCELLED = 'cancelled';

export const TERMINAL_JOB_STATUSES = new Set([
  JOB_STATUS_COMPLETED,
  JOB_STATUS_FAILED,
  JOB_STATUS_CANCELLED,
]);

export function nowIso() {
  return new Date().toISOString();
}

export function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

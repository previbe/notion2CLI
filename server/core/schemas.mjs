import { z } from 'zod';
import {
  ACTION_FORWARD_FULL_PAGE,
  ACTION_FORWARD_SELECTION,
  ACTION_INSTALL_NOTION_MCP,
  ACTIONS,
  ACTION_WRITE_REPLY,
  DEFAULT_WRITE_MODE,
  DEFAULT_WRITE_SECTION_TITLE,
  WRITE_MODE_UPDATE_CONTENT,
  WRITE_MODES,
  createHttpError,
} from './constants.mjs';
import { normalizePromptProfileId } from './prompt-profiles.mjs';

const requestShape = z.object({
  action: z.string().optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  selectionText: z.string().optional(),
  replyTextToWrite: z.string().optional(),
  writeMode: z.string().optional(),
  writeSectionTitle: z.string().optional(),
  sourceReplyJobId: z.string().optional(),
  installPrompt: z.string().optional(),
  officialDocUrl: z.string().optional(),
  promptProfileId: z.string().optional(),
  source: z.string().optional(),
}).passthrough();

const pairConfirmShape = z.object({
  code: z.string().optional(),
  clientLabel: z.string().optional(),
}).passthrough();

const approvalResolutionShape = z.object({
  action: z.enum(['accept', 'decline', 'cancel']).optional(),
  content: z.unknown().optional(),
  _meta: z.unknown().optional(),
}).passthrough();

const promptProfileMutationShape = z.object({
  name: z.string().optional(),
  instruction: z.string().optional(),
}).passthrough();

function invalidPayload(message) {
  return createHttpError(400, message);
}

function normalizeAction(action) {
  const candidate = String(action || '').trim();
  return ACTIONS.has(candidate) ? candidate : ACTION_FORWARD_FULL_PAGE;
}

function normalizeWriteMode(mode) {
  const candidate = String(mode || '').trim();
  return WRITE_MODES.has(candidate) ? candidate : DEFAULT_WRITE_MODE;
}

function trimOrDefault(value, fallback = '') {
  if (value == null) {
    return fallback;
  }

  return String(value).trim();
}

export function parseJobRequest(body) {
  const raw = requestShape.parse(body ?? {});
  const promptProfileId = normalizePromptProfileId(raw.promptProfileId);
  const payload = {
    action: normalizeAction(raw.action),
    pageUrl: trimOrDefault(raw.pageUrl),
    pageTitle: trimOrDefault(raw.pageTitle, 'Untitled Notion Page') || 'Untitled Notion Page',
    selectionText: trimOrDefault(raw.selectionText),
    replyTextToWrite: trimOrDefault(raw.replyTextToWrite),
    writeMode: normalizeWriteMode(raw.writeMode),
    writeSectionTitle: trimOrDefault(raw.writeSectionTitle, DEFAULT_WRITE_SECTION_TITLE) || DEFAULT_WRITE_SECTION_TITLE,
    sourceReplyJobId: trimOrDefault(raw.sourceReplyJobId),
    installPrompt: trimOrDefault(raw.installPrompt),
    officialDocUrl: trimOrDefault(raw.officialDocUrl),
    promptProfileId,
    source: trimOrDefault(raw.source, 'browser-extension') || 'browser-extension',
  };

  if (!payload.pageUrl) {
    throw invalidPayload('pageUrl is required');
  }

  if (payload.action === ACTION_FORWARD_SELECTION && !payload.selectionText) {
    throw invalidPayload('selectionText is required for selection actions');
  }

  if (payload.action === ACTION_WRITE_REPLY && !payload.replyTextToWrite) {
    throw invalidPayload('replyTextToWrite is required for write-back actions');
  }

  if (payload.action === ACTION_WRITE_REPLY && payload.writeMode === WRITE_MODE_UPDATE_CONTENT && !payload.selectionText) {
    throw invalidPayload('selectionText is required for update_content write-back actions');
  }

  if (payload.action === ACTION_INSTALL_NOTION_MCP && !payload.installPrompt) {
    throw invalidPayload('installPrompt is required for install actions');
  }

  return payload;
}

export function parsePromptProfileMutation(body) {
  const raw = promptProfileMutationShape.parse(body ?? {});
  return {
    name: trimOrDefault(raw.name),
    instruction: trimOrDefault(raw.instruction),
  };
}

export function parsePairConfirm(body) {
  const raw = pairConfirmShape.parse(body ?? {});
  const code = trimOrDefault(raw.code);
  const clientLabel = trimOrDefault(raw.clientLabel, 'Chrome Extension') || 'Chrome Extension';

  if (!code) {
    throw invalidPayload('Pairing code is required');
  }

  return { code, clientLabel };
}

export function parseApprovalResolution(body) {
  const raw = approvalResolutionShape.parse(body ?? {});
  const action = trimOrDefault(raw.action);

  if (!action || !['accept', 'decline', 'cancel'].includes(action)) {
    throw invalidPayload('approval action must be accept, decline, or cancel');
  }

  return {
    action,
    content: Object.hasOwn(raw, 'content') ? raw.content : undefined,
    _meta: Object.hasOwn(raw, '_meta') ? raw._meta : undefined,
  };
}

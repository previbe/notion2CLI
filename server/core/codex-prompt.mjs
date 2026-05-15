import { buildCommonActionRules } from './instructions.mjs';
import {
  ACTION_FORWARD_FULL_PAGE,
  ACTION_FORWARD_SELECTION,
  ACTION_INSTALL_NOTION_MCP,
  ACTION_WRITE_REPLY,
} from './constants.mjs';
import { PROMPT_PROFILE_RAW } from './prompt-profiles.mjs';

export function buildDedicatedRuntimePrompt(job, _runtimeInfo = {}, options = {}) {
  const pageBundle = job.inputBundle?.pageBundle || null;
  const promptProfile = normalizePromptProfile(job.promptProfile);
  const localImageArtifacts = Array.isArray(job.inputBundle?.images) ? job.inputBundle.images : [];
  const payload = buildCompactPayload(job, {
    pageBundle,
    promptProfile,
    attachedImageCount: localImageArtifacts.length,
  });
  const promptProfileLines = buildPromptProfileLines(promptProfile);
  const imageArtifactLines = localImageArtifacts.length
    ? [
      'Local image artifacts from this source document:',
      ...localImageArtifacts.map((image, index) => `- [${index + 1}] ${image.cachePath}`),
    ]
    : [];
  const warningLines = Array.isArray(job.inputBundle?.warnings) && job.inputBundle.warnings.length
    ? [
      'Artifact warnings:',
      ...job.inputBundle.warnings.map((warning) => `- ${warning}`),
    ]
    : [];
  const pageBundleLines = pageBundle
    ? [
      'PageBundle markdown:',
      '<<<N2C_PAGE_BUNDLE_MARKDOWN',
      pageBundle.markdown,
      'N2C_PAGE_BUNDLE_MARKDOWN',
    ]
    : [];

  const replyLines = options.replyToolName
    ? [
      `Reply tool: call "${options.replyToolName}" exactly once with chat_id ${JSON.stringify(job.id || '')} and the final browser Brief text.`,
      'On failure, call the reply tool with status "failed" and a concise error.',
    ]
    : [
      'No browser reply tool: your final assistant message is the browser Brief.',
    ];

  return [
    ...buildCommonActionRules({
      action: job.action,
      promptProfile,
      hasImages: localImageArtifacts.length > 0,
      writeMode: job.writeMode,
    }),
    ...replyLines,
    'You may decide autonomously whether to use the configured document provider, local files, or terminal tools based on the request. For side-effecting actions such as writing, deleting, overwriting, or running commands, confirm they are necessary to complete the current request and mention them in the final Brief.',
    '',
    ...promptProfileLines,
    '',
    `Payload JSON: ${JSON.stringify(payload)}`,
    '',
    ...imageArtifactLines,
    ...(imageArtifactLines.length ? [''] : []),
    ...warningLines,
    ...(warningLines.length ? [''] : []),
    ...pageBundleLines,
    ...(pageBundleLines.length ? [''] : []),
  ].filter(Boolean).join('\n');
}

export function buildCodexPrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo);
}

export function buildClaudePrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo);
}

export function buildClaudeChannelPrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo, {
    replyToolName: 'reply',
  });
}

function normalizePromptProfile(promptProfile) {
  return promptProfile || {
    id: PROMPT_PROFILE_RAW,
    name: 'Raw',
    instruction: '',
  };
}

function buildPromptProfileLines(promptProfile) {
  const profile = normalizePromptProfile(promptProfile);
  const instruction = String(profile.instruction || '').trim();

  if (!instruction) {
    return [];
  }

  return [
    `Profile: ${profile.id} (${profile.name}). Instruction:`,
    '<<<N2C_PROMPT_PROFILE_INSTRUCTION',
    instruction,
    'N2C_PROMPT_PROFILE_INSTRUCTION',
  ];
}

function buildCompactPayload(job, { pageBundle, promptProfile, attachedImageCount }) {
  const payload = compactObject({
    jobId: job.id,
    action: job.action,
    pageUrl: job.pageUrl,
    pageTitle: job.pageTitle,
    providerId: job.providerId,
    promptProfile: {
      id: promptProfile.id,
      name: promptProfile.name,
    },
  });

  if (job.action === ACTION_FORWARD_SELECTION) {
    payload.selectionText = job.selectionText || '';
  }

  if (job.action === ACTION_FORWARD_FULL_PAGE && pageBundle) {
    payload.pageBundle = compactObject({
      provider: pageBundle.provider,
      providerId: pageBundle.providerId,
      sourceProvider: pageBundle.sourceProvider,
      runtimeId: pageBundle.runtimeId,
      truncated: pageBundle.truncated === true ? true : undefined,
      warnings: pageBundle.warnings,
      stats: pageBundle.stats,
    });
  }

  if (job.action === ACTION_WRITE_REPLY) {
    Object.assign(payload, compactObject({
      selectionText: job.selectionText,
      selectionContext: job.selectionContext,
      replyTextToWrite: job.replyTextToWrite,
      writeMode: job.writeMode,
      writeSectionTitle: job.writeSectionTitle,
      sourceReplyJobId: job.sourceReplyJobId,
    }));
  }

  if (job.action === ACTION_INSTALL_NOTION_MCP) {
    Object.assign(payload, compactObject({
      installPrompt: job.installPrompt,
      officialDocUrl: job.officialDocUrl,
    }));
  }

  if (attachedImageCount > 0) {
    payload.attachedImageCount = attachedImageCount;
  }

  const artifactSource = String(job.inputBundle?.artifactSource || '').trim();
  if (artifactSource && artifactSource !== 'none') {
    payload.artifactSource = artifactSource;
  }

  return payload;
}

function compactObject(value) {
  const output = {};

  for (const [key, entry] of Object.entries(value || {})) {
    if (entry == null || entry === '') {
      continue;
    }

    if (Array.isArray(entry)) {
      if (entry.length) {
        output[key] = entry;
      }
      continue;
    }

    if (typeof entry === 'object') {
      const compactEntry = compactObject(entry);
      if (Object.keys(compactEntry).length) {
        output[key] = compactEntry;
      }
      continue;
    }

    output[key] = entry;
  }

  return output;
}

import { buildCommonActionRules } from './instructions.mjs';
import { PROMPT_PROFILE_RAW } from './prompt-profiles.mjs';

export function buildDedicatedRuntimePrompt(job, runtimeInfo = {}, options = {}) {
  const pageBundle = job.inputBundle?.pageBundle || null;
  const promptProfile = normalizePromptProfile(job.promptProfile);
  const payload = {
    jobId: job.id,
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
    promptProfile: {
      id: promptProfile.id,
      name: promptProfile.name,
      hasInstruction: Boolean(String(promptProfile.instruction || '').trim()),
    },
    source: job.source,
    requestedAt: job.createdAt,
    attachedImageCount: Array.isArray(job.inputBundle?.images) ? job.inputBundle.images.length : 0,
    artifactSource: job.inputBundle?.artifactSource || '',
    pageBundle: pageBundle
      ? {
        provider: pageBundle.provider,
        runtimeId: pageBundle.runtimeId,
        truncated: pageBundle.truncated === true,
        warnings: pageBundle.warnings,
        stats: pageBundle.stats,
      }
      : null,
  };
  const runtimeLabel = options.runtimeLabel || 'the local runtime';
  const localImageArtifacts = Array.isArray(job.inputBundle?.images) ? job.inputBundle.images : [];
  const primaryUserText = resolvePrimaryUserText(job);
  const promptProfileLines = buildPromptProfileLines(promptProfile);
  const imageArtifactLines = localImageArtifacts.length
    ? [
      'Inspect these exact local image files directly as images whenever visual content might matter:',
      ...localImageArtifacts.map((image, index) => `- [${index + 1}] ${image.cachePath}`),
      '',
      'These local image files correspond to images from the current Notion page.',
    ]
    : [];
  const warningLines = Array.isArray(job.inputBundle?.warnings) && job.inputBundle.warnings.length
    ? [
      'Artifact preparation warnings:',
      ...job.inputBundle.warnings.map((warning) => `- ${warning}`),
    ]
    : [];
  const pageBundleLines = pageBundle
    ? [
      'Bridge-prepared page bundle markdown follows. Treat it as the authoritative full-page content unless it is explicitly marked partial:',
      '<<<N2C_PAGE_BUNDLE_MARKDOWN',
      pageBundle.markdown,
      'N2C_PAGE_BUNDLE_MARKDOWN',
    ]
    : [];

  const replyLines = options.replyToolName
    ? [
      `A browser reply tool named "${options.replyToolName}" is available in this Claude Code channel session.`,
      `After you determine the final user-facing reply, call "${options.replyToolName}" exactly once with chat_id ${JSON.stringify(job.id || '')} and text equal to that reply.`,
      'If the task fails, call the reply tool with status "failed" and a concise error explanation.',
    ]
    : [
      'There is no browser reply tool in this run. The last assistant message you produce will be shown directly in the browser panel.',
    ];

  return [
    `You are handling a notion2cli browser action for ${runtimeLabel}.`,
    ...buildCommonActionRules(),
    primaryUserText ? `Current browser user message: ${JSON.stringify(primaryUserText)}` : null,
    localImageArtifacts.length ? `Current page image file count: ${localImageArtifacts.length}.` : null,
    ...replyLines,
    'Do not edit local repository files and do not run shell commands unless the current browser request or selected prompt profile requires local code or terminal work.',
    runtimeInfo?.notionMcpHint ? `Runtime hint: ${runtimeInfo.notionMcpHint}` : null,
    '',
    ...promptProfileLines,
    '',
    'Action payload:',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    ...imageArtifactLines,
    ...(imageArtifactLines.length ? [''] : []),
    ...warningLines,
    ...(warningLines.length ? [''] : []),
    ...pageBundleLines,
    ...(pageBundleLines.length ? [''] : []),
    'Return only the final user-facing Brief text.',
  ].filter(Boolean).join('\n');
}

export function buildCodexPrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo, {
    runtimeLabel: 'the local Codex CLI runtime',
  });
}

export function buildClaudePrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo, {
    runtimeLabel: 'the local Claude Code runtime',
  });
}

export function buildClaudeChannelPrompt(job, runtimeInfo) {
  return buildDedicatedRuntimePrompt(job, runtimeInfo, {
    runtimeLabel: 'the active Claude Code channel session',
    replyToolName: 'reply',
  });
}

function resolvePrimaryUserText(job) {
  if (job.action === 'forward_selection_text') {
    return job.selectionText || '';
  }

  if (job.action === 'write_reply_to_notion') {
    return job.replyTextToWrite || '';
  }

  if (job.action === 'install_notion_mcp') {
    return job.installPrompt || '';
  }

  return '';
}

function normalizePromptProfile(promptProfile) {
  return promptProfile || {
    id: PROMPT_PROFILE_RAW,
    name: '原样运行',
    instruction: '',
  };
}

function buildPromptProfileLines(promptProfile) {
  const profile = normalizePromptProfile(promptProfile);
  const instruction = String(profile.instruction || '').trim();

  if (!instruction) {
    return [
      `Selected prompt profile: ${profile.name || '原样运行'} (${profile.id || PROMPT_PROFILE_RAW}).`,
      'No additional prompt profile instruction is attached. Interpret the Notion input as the direct user request.',
    ];
  }

  return [
    `Selected prompt profile: ${profile.name} (${profile.id}).`,
    'Prompt profile instruction follows. Use it as the task intent for this run:',
    '<<<N2C_PROMPT_PROFILE_INSTRUCTION',
    instruction,
    'N2C_PROMPT_PROFILE_INSTRUCTION',
  ];
}

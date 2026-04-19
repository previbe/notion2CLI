import { buildCommonActionRules } from './instructions.mjs';

export function buildDedicatedRuntimePrompt(job, runtimeInfo = {}, options = {}) {
  const pageBundle = job.inputBundle?.pageBundle || null;
  const payload = {
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

  return [
    `You are handling a notion2cli browser action for ${runtimeLabel}.`,
    ...buildCommonActionRules(),
    primaryUserText ? `Current browser user message: ${JSON.stringify(primaryUserText)}` : null,
    localImageArtifacts.length ? `Current page image file count: ${localImageArtifacts.length}.` : null,
    'There is no browser reply tool in this run. The last assistant message you produce will be shown directly in the browser panel.',
    'For content-forwarding and write-back actions, do not edit local repository files and do not run shell commands unless they are strictly necessary to explain a concrete error.',
    runtimeInfo?.notionMcpHint ? `Runtime hint: ${runtimeInfo.notionMcpHint}` : null,
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
    'Return only the final user-facing reply text.',
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

import { buildCommonActionRules } from './instructions.mjs';

export function buildCodexPrompt(job, runtimeInfo) {
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
  };

  return [
    'You are handling a notion2cli browser action for the local machine.',
    ...buildCommonActionRules(),
    'There is no browser reply tool in this run. The last assistant message you produce will be shown directly in the browser panel.',
    'For content-forwarding and write-back actions, do not edit local repository files and do not run shell commands unless they are strictly necessary to explain a concrete error.',
    runtimeInfo?.notionMcpHint ? `Runtime hint: ${runtimeInfo.notionMcpHint}` : null,
    '',
    'Action payload:',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    'Return only the final user-facing reply text.',
  ].filter(Boolean).join('\n');
}


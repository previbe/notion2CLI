import { ArtifactStore } from './artifact-store.mjs';
import { resolveInputArtifacts } from './artifact-resolver.mjs';

export async function createInputBundle(job, options = {}) {
  const artifactStore = options.artifactStore || new ArtifactStore({
    log: options.log,
  });
  const preparedArtifacts = await resolveInputArtifacts({
    job,
    pageBundle: options.pageBundle || null,
    artifactStore,
    log: options.log,
  });

  return {
    pageContext: {
      pageUrl: job.pageUrl,
      pageTitle: job.pageTitle,
      providerId: job.providerId,
      selectionText: job.selectionText,
      selectionContext: job.selectionContext,
      source: job.source,
    },
    request: {
      action: job.action,
      replyTextToWrite: job.replyTextToWrite,
      writeMode: job.writeMode,
      writeSectionTitle: job.writeSectionTitle,
      sourceReplyJobId: job.sourceReplyJobId,
      installPrompt: job.installPrompt,
      officialDocUrl: job.officialDocUrl,
      requestedAt: job.createdAt,
    },
    pageBundle: options.pageBundle || null,
    images: preparedArtifacts.images,
    warnings: preparedArtifacts.warnings,
    cacheDir: preparedArtifacts.cacheDir,
    artifactSource: preparedArtifacts.source,
  };
}

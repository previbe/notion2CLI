import { extractImageCandidatesFromPageBundle } from './mcp-page-bundle.mjs';

export async function resolveInputArtifacts({ job, pageBundle, artifactStore, log = () => {} }) {
  const bundleImageCandidates = extractImageCandidatesFromPageBundle(pageBundle);
  const warnings = [];

  if (bundleImageCandidates.length > 0) {
    const result = await artifactStore.prepareArtifacts(job.id, {
      images: bundleImageCandidates,
    });

    warnings.push(...result.warnings);
    if (result.images.length > 0) {
      log('input artifacts resolved from page bundle', {
        jobId: job.id,
        candidateCount: bundleImageCandidates.length,
        resolvedCount: result.images.length,
        warnings: result.warnings,
      });
      return {
        images: result.images,
        warnings,
        cacheDir: result.cacheDir,
        source: 'page-bundle',
      };
    }
    warnings.push('The MCP page bundle declared image attachments, but the bridge could not download any local image artifacts.');
  }

  return {
    images: [],
    warnings,
    cacheDir: artifactStore.resolveJobCacheDir(job.id),
    source: bundleImageCandidates.length > 0 ? 'page-bundle-empty' : 'none',
  };
}

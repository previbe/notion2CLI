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
    warnings.push('MCP 页面 bundle 中声明了图片附件，但 bridge 未能成功下载任何本地图片工件。');
  }

  return {
    images: [],
    warnings,
    cacheDir: artifactStore.resolveJobCacheDir(job.id),
    source: bundleImageCandidates.length > 0 ? 'page-bundle-empty' : 'none',
  };
}

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_LARK_IMAGES = 6;

export async function resolveLarkImageAssets({
  adapter,
  artifactStore,
  jobId,
  imageAssets,
  log = () => {},
}) {
  const assets = Array.isArray(imageAssets) ? imageAssets.slice(0, MAX_LARK_IMAGES) : [];
  if (!assets.length) {
    return {
      images: [],
      warnings: [],
    };
  }

  const images = [];
  const warnings = [];
  const cacheDir = artifactStore?.resolveJobCacheDir?.(jobId);
  if (cacheDir) {
    await mkdir(cacheDir, { recursive: true });
  }

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (asset.sourceUrl) {
      images.push({
        sourceUrl: asset.sourceUrl,
        caption: asset.caption || 'image',
        width: asset.width || null,
        height: asset.height || null,
        source: 'lark-cli',
      });
      continue;
    }

    if (!asset.token || !cacheDir) {
      continue;
    }

    try {
      const outputBase = path.join(cacheDir, `lark-media-${String(index + 1).padStart(2, '0')}`);
      const result = await adapter.downloadMedia({
        token: asset.token,
        outputPath: outputBase,
      });
      const cachePath = resolveSavedPath(result, outputBase);
      images.push({
        sourceUrl: `lark-media:${asset.token}`,
        cachePath,
        caption: asset.caption || 'image',
        width: asset.width || null,
        height: asset.height || null,
        source: 'lark-cli',
      });
    } catch (error) {
      const message = `Feishu/Lark media ${index + 1} download failed: ${error?.message || 'unknown error'}`;
      warnings.push(message);
      log('lark media download failed', {
        jobId,
        index,
        token: maskToken(asset.token),
        error: error?.message || 'unknown error',
      });
    }
  }

  return {
    images,
    warnings,
  };
}

function resolveSavedPath(result, fallback) {
  return String(
    result?.data?.saved_path
    || result?.saved_path
    || result?.data?.path
    || result?.path
    || fallback
    || '',
  ).trim();
}

function maskToken(token) {
  const value = String(token || '');
  return value.length <= 8 ? '****' : `****${value.slice(-4)}`;
}

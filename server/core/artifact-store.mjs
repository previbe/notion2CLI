import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ARTIFACT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_COUNT = 6;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

const MIME_EXTENSION_MAP = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/svg+xml', 'svg'],
]);

const EXTENSION_MIME_MAP = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
]);

export class ArtifactStore {
  constructor({ rootDir, log, allowPrivateNetworkUrls = false } = {}) {
    this.rootDir = rootDir || path.join(getNotion2cliHome(), 'state', 'artifacts');
    this.log = log || (() => {});
    this.allowPrivateNetworkUrls = allowPrivateNetworkUrls === true;
  }

  async prepareArtifacts(jobId, assets = {}) {
    await this.prune();

    const preparedImages = await this.downloadImages(jobId, assets.images || []);
    return {
      images: preparedImages.images,
      warnings: preparedImages.warnings,
      cacheDir: preparedImages.cacheDir,
    };
  }

  async prune() {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const cutoff = Date.now() - ARTIFACT_RETENTION_MS;

    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) {
        return;
      }

      const target = path.join(this.rootDir, entry.name);
      try {
        const info = await stat(target);
        if (info.mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {}
    }));
  }

  async downloadImages(jobId, rawImages) {
    const cacheDir = this.resolveJobCacheDir(jobId);
    await mkdir(cacheDir, { recursive: true });

    const normalizedImages = normalizeImageCandidates(rawImages).slice(0, MAX_IMAGE_COUNT);
    const images = [];
    const warnings = [];

    for (let index = 0; index < normalizedImages.length; index += 1) {
      const candidate = normalizedImages[index];
      try {
        const artifact = await downloadImageArtifact(cacheDir, index, candidate, {
          allowPrivateNetworkUrls: this.allowPrivateNetworkUrls,
        });
        images.push(artifact);
      } catch (error) {
        const message = error?.message || 'Unknown image download failure';
        warnings.push(`图片 ${index + 1} 下载失败：${message}`);
        this.log('image artifact download failed', {
          jobId,
          index,
          sourceUrl: candidate.sourceUrl,
          error: message,
        });
      }
    }

    return {
      cacheDir,
      images,
      warnings,
    };
  }

  resolveJobCacheDir(jobId) {
    return path.join(this.rootDir, jobId);
  }
}

function normalizeImageCandidates(rawImages) {
  const list = Array.isArray(rawImages) ? rawImages : [];
  const seen = new Set();
  const images = [];

  for (const item of list) {
    const sourceUrl = String(item?.sourceUrl || item?.url || '').trim();
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl) || seen.has(sourceUrl)) {
      continue;
    }

    seen.add(sourceUrl);
    images.push({
      sourceUrl,
      alt: String(item?.alt || '').trim(),
      width: normalizeDimension(item?.width),
      height: normalizeDimension(item?.height),
    });
  }

  return images;
}

function normalizeDimension(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return null;
  }

  return Math.round(candidate);
}

async function downloadImageArtifact(cacheDir, index, image, options = {}) {
  validateImageSourceUrl(image.sourceUrl, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetchImageWithValidatedRedirects(image.sourceUrl, {
      signal: controller.signal,
      allowPrivateNetworkUrls: options.allowPrivateNetworkUrls,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const headerMimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const buffer = await readResponseBodyWithLimit(response, MAX_IMAGE_BYTES);
  const mimeType = resolveImageMimeType({
    headerMimeType,
    buffer,
    sourceUrl: image.sourceUrl,
  });
  if (!mimeType.startsWith('image/')) {
    throw new Error(`unsupported content-type ${mimeType || 'unknown'}`);
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${buffer.length} bytes)`);
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const extension = MIME_EXTENSION_MAP.get(mimeType) || 'img';
  const fileName = `${String(index + 1).padStart(2, '0')}-${sha256.slice(0, 12)}.${extension}`;
  const cachePath = path.join(cacheDir, fileName);
  await writeFile(cachePath, buffer);

  return {
    artifactId: randomUUID(),
    kind: 'image',
    sourceUrl: image.sourceUrl,
    cachePath,
    mimeType,
    sizeBytes: buffer.length,
    sha256,
    width: image.width,
    height: image.height,
    alt: image.alt,
  };
}

async function fetchImageWithValidatedRedirects(sourceUrl, options = {}) {
  let currentUrl = validateImageSourceUrl(sourceUrl, options);

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: options.signal,
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`redirect ${response.status} missing location`);
    }

    currentUrl = validateImageSourceUrl(new URL(location, currentUrl).toString(), options);
  }

  throw new Error('too many redirects');
}

async function readResponseBodyWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`image too large (${contentLength} bytes)`);
  }

  if (!response.body?.getReader) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.length > maxBytes) {
      throw new Error(`image too large (${fallback.length} bytes)`);
    }
    return fallback;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`image too large (${totalBytes} bytes)`);
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks, totalBytes);
}

function validateImageSourceUrl(sourceUrl, options = {}) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('invalid image URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported URL protocol ${url.protocol}`);
  }

  if (!options.allowPrivateNetworkUrls && isPrivateNetworkHost(url.hostname)) {
    throw new Error('local/private image URLs are not allowed');
  }

  return url.toString();
}

function isPrivateNetworkHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    return true;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (net.isIP(host) === 4) {
    return isPrivateIpv4(host);
  }

  if (net.isIP(host) === 6) {
    return isPrivateIpv6(host);
  }

  return false;
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(host) {
  return host === '::1'
    || host === '0:0:0:0:0:0:0:1'
    || host.startsWith('fc')
    || host.startsWith('fd')
    || host.startsWith('fe80:')
    || host.startsWith('::ffff:127.')
    || host.startsWith('::ffff:10.')
    || host.startsWith('::ffff:192.168.');
}

function getNotion2cliHome() {
  return process.env.NOTION2CLI_HOME || path.join(os.homedir(), '.notion2cli');
}

function resolveImageMimeType({ headerMimeType, buffer, sourceUrl }) {
  if (headerMimeType.startsWith('image/')) {
    return headerMimeType;
  }

  const sniffedMimeType = sniffImageMimeType(buffer);
  if (sniffedMimeType) {
    return sniffedMimeType;
  }

  const extensionMimeType = inferMimeTypeFromUrl(sourceUrl);
  if (extensionMimeType) {
    return extensionMimeType;
  }

  return headerMimeType;
}

function sniffImageMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (buffer.length >= 12) {
    const riffHeader = buffer.subarray(0, 4).toString('ascii');
    const webpHeader = buffer.subarray(8, 12).toString('ascii');
    if (riffHeader === 'RIFF' && webpHeader === 'WEBP') {
      return 'image/webp';
    }
  }

  const snippet = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').trimStart();
  if (snippet.startsWith('<svg') || (snippet.startsWith('<?xml') && snippet.includes('<svg'))) {
    return 'image/svg+xml';
  }

  return null;
}

function inferMimeTypeFromUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return EXTENSION_MIME_MAP.get(path.extname(url.pathname).toLowerCase()) || null;
  } catch {
    return null;
  }
}

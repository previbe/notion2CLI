const PAGE_BUNDLE_JSON_START = '<<<N2C_PAGE_BUNDLE_JSON';
const PAGE_BUNDLE_JSON_END = 'N2C_PAGE_BUNDLE_JSON';
const PAGE_BUNDLE_MARKDOWN_START = '<<<N2C_PAGE_MARKDOWN';
const PAGE_BUNDLE_MARKDOWN_END = 'N2C_PAGE_MARKDOWN';

const TEXT_EXCERPT_LENGTH = 240;

export function buildRuntimePageBundleFetchPrompt({ pageUrl, pageTitle, runtimeLabel = 'the current runtime' }) {
  return [
    `You are preparing a notion2cli page bundle using ${runtimeLabel}.`,
    'Use the configured Notion MCP tools to fetch the target Notion page as enhanced markdown.',
    'Do not answer the user request yet. This run only extracts page content for the bridge.',
    'Return exactly one envelope in this format and do not add code fences or commentary:',
    PAGE_BUNDLE_JSON_START,
    '{"ok":true,"pageUrl":"<page url>","pageTitle":"<page title>","truncated":false,"warnings":[]}',
    PAGE_BUNDLE_JSON_END,
    PAGE_BUNDLE_MARKDOWN_START,
    '<verbatim markdown from Notion MCP>',
    PAGE_BUNDLE_MARKDOWN_END,
    '',
    'If the page cannot be fetched, return exactly:',
    PAGE_BUNDLE_JSON_START,
    '{"ok":false,"pageUrl":"<page url>","pageTitle":"<page title>","error":"<short reason>","warnings":[]}',
    PAGE_BUNDLE_JSON_END,
    '',
    `Target pageUrl: ${pageUrl}`,
    `Target pageTitle: ${pageTitle || 'Untitled Notion Page'}`,
  ].join('\n');
}

export function parseRuntimePageBundleEnvelope(text) {
  const jsonPayload = extractEnvelopeSection(text, PAGE_BUNDLE_JSON_START, PAGE_BUNDLE_JSON_END);
  if (!jsonPayload) {
    throw new Error('Missing N2C_PAGE_BUNDLE_JSON envelope');
  }

  let meta;
  try {
    meta = JSON.parse(jsonPayload);
  } catch (error) {
    throw new Error(`Invalid page bundle JSON envelope: ${error?.message || 'parse failed'}`);
  }

  if (!meta || typeof meta !== 'object') {
    throw new Error('Invalid page bundle metadata payload');
  }

  if (meta.ok === false) {
    return {
      ok: false,
      pageUrl: String(meta.pageUrl || '').trim(),
      pageTitle: String(meta.pageTitle || '').trim(),
      error: String(meta.error || 'Unknown page bundle error').trim(),
      warnings: normalizeWarnings(meta.warnings),
      truncated: false,
      markdown: '',
    };
  }

  const markdown = extractEnvelopeSection(text, PAGE_BUNDLE_MARKDOWN_START, PAGE_BUNDLE_MARKDOWN_END);
  if (markdown == null) {
    throw new Error('Missing N2C_PAGE_MARKDOWN envelope');
  }

  return {
    ok: true,
    pageUrl: String(meta.pageUrl || '').trim(),
    pageTitle: String(meta.pageTitle || '').trim(),
    warnings: normalizeWarnings(meta.warnings),
    truncated: meta.truncated === true,
    markdown,
  };
}

export function createMcpPageBundle({
  pageUrl,
  pageTitle,
  markdown,
  warnings = [],
  provider = 'runtime-backed-notion-mcp',
  runtimeId = '',
  truncated = false,
}) {
  const normalizedMarkdown = String(markdown || '');
  const normalizedWarnings = normalizeWarnings(warnings);
  const assets = extractMarkdownAssets(normalizedMarkdown);
  const bodyBlock = createBodyBlock(normalizedMarkdown);
  const attachmentBlocks = flattenAssets(assets).map((asset, index) => ({
    blockId: `${asset.type}:${index + 1}`,
    type: asset.type,
    role: 'attachment',
    text: '',
    url: asset.sourceUrl,
    caption: asset.caption,
    mimeType: asset.mimeType || '',
    fileName: asset.fileName || '',
    metadata: {
      source: asset.source,
      title: asset.title,
    },
  }));
  const blocks = [bodyBlock, ...attachmentBlocks];
  const stats = summarizeBlocks(blocks, normalizedMarkdown.length);

  return {
    provider,
    runtimeId: String(runtimeId || '').trim(),
    pageUrl: String(pageUrl || '').trim(),
    pageTitle: String(pageTitle || '').trim() || 'Untitled Notion Page',
    markdown: normalizedMarkdown,
    truncated,
    warnings: normalizedWarnings,
    blocks,
    assets,
    stats,
    fetchedAt: new Date().toISOString(),
  };
}

export function summarizePageBundle(bundle) {
  if (!bundle) {
    return null;
  }

  return {
    provider: bundle.provider || '',
    runtimeId: bundle.runtimeId || '',
    pageUrl: bundle.pageUrl || '',
    pageTitle: bundle.pageTitle || '',
    truncated: bundle.truncated === true,
    warningCount: Array.isArray(bundle.warnings) ? bundle.warnings.length : 0,
    stats: bundle.stats || null,
  };
}

export function extractImageCandidatesFromPageBundle(bundle) {
  const images = Array.isArray(bundle?.assets?.images) ? bundle.assets.images : [];
  return images.map((image) => ({
    sourceUrl: image.sourceUrl,
    alt: image.caption || image.fileName || '',
    width: null,
    height: null,
  }));
}

function extractEnvelopeSection(text, startMarker, endMarker) {
  const source = String(text || '');
  const startIndex = source.indexOf(startMarker);
  if (startIndex === -1) {
    return null;
  }

  const contentStart = startIndex + startMarker.length;
  const endIndex = source.indexOf(endMarker, contentStart);
  if (endIndex === -1) {
    return null;
  }

  return source.slice(contentStart, endIndex).replace(/^\s*\n/, '').replace(/\s*$/, '');
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function createBodyBlock(markdown) {
  const excerpt = markdown
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_EXCERPT_LENGTH);

  return {
    blockId: 'markdown/body',
    type: 'text',
    role: 'primary-content',
    text: excerpt,
    url: '',
    caption: '',
    mimeType: 'text/markdown',
    fileName: '',
    metadata: {
      markdownChars: markdown.length,
    },
  };
}

function summarizeBlocks(blocks, markdownChars) {
  const summary = {
    markdownChars,
    blockCount: Array.isArray(blocks) ? blocks.length : 0,
    textBlockCount: 0,
    imageBlockCount: 0,
    fileBlockCount: 0,
    pdfBlockCount: 0,
    audioBlockCount: 0,
    videoBlockCount: 0,
    unknownBlockCount: 0,
  };

  for (const block of blocks || []) {
    switch (block.type) {
      case 'text':
        summary.textBlockCount += 1;
        break;
      case 'image':
        summary.imageBlockCount += 1;
        break;
      case 'file':
        summary.fileBlockCount += 1;
        break;
      case 'pdf':
        summary.pdfBlockCount += 1;
        break;
      case 'audio':
        summary.audioBlockCount += 1;
        break;
      case 'video':
        summary.videoBlockCount += 1;
        break;
      default:
        summary.unknownBlockCount += 1;
        break;
    }
  }

  return summary;
}

function flattenAssets(assets) {
  return [
    ...(assets.images || []),
    ...(assets.files || []),
    ...(assets.pdfs || []),
    ...(assets.audio || []),
    ...(assets.video || []),
    ...(assets.unknown || []),
  ];
}

function extractMarkdownAssets(markdown) {
  const links = parseMarkdownLinks(markdown);
  const images = [];
  const files = [];
  const pdfs = [];
  const audio = [];
  const video = [];
  const unknown = [];

  for (const link of links) {
    const asset = normalizeAsset(link);
    if (!asset) {
      continue;
    }

    switch (asset.type) {
      case 'image':
        images.push(asset);
        break;
      case 'pdf':
        pdfs.push(asset);
        break;
      case 'audio':
        audio.push(asset);
        break;
      case 'video':
        video.push(asset);
        break;
      case 'file':
        files.push(asset);
        break;
      default:
        unknown.push(asset);
        break;
    }
  }

  return { images, files, pdfs, audio, video, unknown };
}

function normalizeAsset(link) {
  const sourceUrl = normalizeHttpUrl(link.destination);
  if (!sourceUrl) {
    return null;
  }

  const title = String(link.title || '').trim();
  const fileName = inferFileName(sourceUrl, link.label);
  const type = classifyAssetType({
    isImage: link.isImage,
    sourceUrl,
    fileName,
  });

  return {
    type,
    source: 'markdown',
    sourceUrl,
    caption: String(link.label || '').trim(),
    title,
    fileName,
    mimeType: inferMimeTypeFromUrl(sourceUrl),
  };
}

function classifyAssetType({ isImage, sourceUrl, fileName }) {
  if (isImage) {
    return 'image';
  }

  const extension = inferExtension(sourceUrl, fileName);
  if (!extension) {
    return 'file';
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) {
    return 'image';
  }

  if (extension === '.pdf') {
    return 'pdf';
  }

  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(extension)) {
    return 'audio';
  }

  if (['.mp4', '.mov', '.avi', '.webm', '.mkv'].includes(extension)) {
    return 'video';
  }

  return 'file';
}

function inferMimeTypeFromUrl(sourceUrl) {
  const extension = inferExtension(sourceUrl);
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    default:
      return '';
  }
}

function inferExtension(sourceUrl, fallbackFileName = '') {
  try {
    const url = new URL(sourceUrl);
    const pathname = url.pathname || '';
    const dotIndex = pathname.lastIndexOf('.');
    if (dotIndex !== -1) {
      return pathname.slice(dotIndex).toLowerCase();
    }
  } catch {}

  const fallback = String(fallbackFileName || '').trim();
  const dotIndex = fallback.lastIndexOf('.');
  if (dotIndex !== -1) {
    return fallback.slice(dotIndex).toLowerCase();
  }

  return '';
}

function inferFileName(sourceUrl, fallbackLabel = '') {
  try {
    const url = new URL(sourceUrl);
    const pathname = url.pathname || '';
    const segment = pathname.split('/').filter(Boolean).at(-1);
    if (segment) {
      return decodeURIComponent(segment);
    }
  } catch {}

  return String(fallbackLabel || '').trim();
}

function normalizeHttpUrl(destination) {
  const value = String(destination || '').trim();
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {}

  return '';
}

function parseMarkdownLinks(markdown) {
  const source = String(markdown || '');
  const tokens = [];

  for (let index = 0; index < source.length; index += 1) {
    const image = source[index] === '!' && source[index + 1] === '[';
    const link = source[index] === '[';
    if (!image && !link) {
      continue;
    }

    const labelStart = image ? index + 2 : index + 1;
    const labelEnd = findClosingBracket(source, labelStart);
    if (labelEnd === -1 || source[labelEnd + 1] !== '(') {
      continue;
    }

    const destinationStart = labelEnd + 2;
    const destinationEnd = findClosingParen(source, destinationStart);
    if (destinationEnd === -1) {
      continue;
    }

    const rawDestination = source.slice(destinationStart, destinationEnd).trim();
    const { destination, title } = splitMarkdownDestination(rawDestination);

    tokens.push({
      isImage: image,
      label: source.slice(labelStart, labelEnd),
      destination,
      title,
    });

    index = destinationEnd;
  }

  return tokens;
}

function findClosingBracket(source, startIndex) {
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === ']' && source[index - 1] !== '\\') {
      return index;
    }
  }

  return -1;
}

function findClosingParen(source, startIndex) {
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' && source[index - 1] !== '\\') {
      depth += 1;
      continue;
    }

    if (char === ')' && source[index - 1] !== '\\') {
      if (depth === 0) {
        return index;
      }

      depth -= 1;
    }
  }

  return -1;
}

function splitMarkdownDestination(rawDestination) {
  const trimmed = String(rawDestination || '').trim();
  if (!trimmed) {
    return { destination: '', title: '' };
  }

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return {
      destination: trimmed.slice(1, -1).trim(),
      title: '',
    };
  }

  const match = trimmed.match(/^(\S+)(?:\s+["'](.+)["'])?$/);
  if (!match) {
    return {
      destination: trimmed,
      title: '',
    };
  }

  return {
    destination: match[1] || '',
    title: match[2] || '',
  };
}

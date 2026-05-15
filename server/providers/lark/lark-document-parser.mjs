export const LARK_PROVIDER_ID = 'lark';
export const LARK_PROVIDER_NAME = 'Feishu/Lark';

const LARK_HOST_PATTERN = /(^|\.)((feishu\.cn)|(larksuite\.com)|(larkoffice\.com))$/i;

export function resolveLarkDocumentReference(pageUrl) {
  let url;
  try {
    url = new URL(String(pageUrl || ''));
  } catch {
    return null;
  }

  if (!LARK_HOST_PATTERN.test(url.hostname)) {
    return null;
  }

  const docxToken = extractPathToken(url.pathname, '/docx/');
  if (docxToken) {
    return {
      providerId: LARK_PROVIDER_ID,
      kind: 'docx',
      token: docxToken,
      pageUrl: url.toString(),
    };
  }

  const wikiToken = extractPathToken(url.pathname, '/wiki/');
  if (wikiToken) {
    return {
      providerId: LARK_PROVIDER_ID,
      kind: 'wiki',
      token: wikiToken,
      pageUrl: url.toString(),
    };
  }

  return null;
}

export function extractMarkdownFromFetchPayload(payload) {
  return String(
    payload?.data?.document?.content
    || payload?.document?.content
    || payload?.data?.content
    || payload?.content
    || '',
  );
}

export function extractTitleFromFetchPayload(payload, fallback = '') {
  return String(
    payload?.data?.document?.title
    || payload?.document?.title
    || payload?.data?.title
    || fallback
    || 'Untitled Feishu/Lark Document',
  ).trim();
}

export function extractDocumentIdFromFetchPayload(payload, fallback = '') {
  return String(
    payload?.data?.document?.document_id
    || payload?.data?.document?.documentId
    || payload?.document?.document_id
    || payload?.document?.documentId
    || fallback
    || '',
  ).trim();
}

export function extractRevisionFromFetchPayload(payload) {
  return String(
    payload?.data?.document?.revision_id
    || payload?.document?.revision_id
    || payload?.data?.revision_id
    || payload?.revision_id
    || '',
  ).trim();
}

export function extractLarkMarkdownImageAssets(markdown) {
  const source = String(markdown || '');
  const discovered = [];
  const seen = new Set();

  for (const match of source.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const caption = match[1] || '';
    const target = match[2] || '';
    addImageAsset(discovered, seen, assetFromTarget(target, caption), match.index || 0);
  }

  for (const match of source.matchAll(/<(?:img|image)\b[^>]*>/gi)) {
    const tag = match[0];
    const token = readTagAttribute(tag, 'token') || readTagAttribute(tag, 'file_token');
    const url = readTagAttribute(tag, 'url') || readTagAttribute(tag, 'src');
    addImageAsset(discovered, seen, {
      token,
      sourceUrl: isHttpUrl(url) ? url : '',
      caption: readTagAttribute(tag, 'alt') || readTagAttribute(tag, 'caption') || 'image',
      width: normalizeDimension(readTagAttribute(tag, 'width')),
      height: normalizeDimension(readTagAttribute(tag, 'height')),
    }, match.index || 0);
  }

  return discovered
    .sort((left, right) => left.index - right.index)
    .map(({ index, ...asset }) => asset);
}

export function locateUniqueMarkdownSelection({ markdown, selectionText, selectionContext = null }) {
  const body = String(markdown || '');
  const selected = String(selectionText || '').trim();
  if (!selected) {
    return {
      ok: false,
      reason: 'No selected text was provided.',
    };
  }

  const candidates = findOccurrences(body, selected);
  if (!candidates.length) {
    return {
      ok: false,
      reason: 'The selected text was not found in the fetched Feishu/Lark document.',
    };
  }

  const filtered = filterCandidatesByContext(body, candidates, selected, selectionContext);
  if (filtered.length !== 1) {
    return {
      ok: false,
      reason: filtered.length === 0
        ? 'The selected text was found, but the surrounding context did not match the fetched document.'
        : 'The selected text appears more than once in the document. Select a more unique range and try again.',
    };
  }

  return {
    ok: true,
    index: filtered[0],
  };
}

function extractPathToken(pathname, marker) {
  const index = pathname.indexOf(marker);
  if (index === -1) {
    return '';
  }
  const rest = pathname.slice(index + marker.length);
  return decodeURIComponent(rest.split('/')[0] || '').trim();
}

function assetFromTarget(target, caption) {
  const value = String(target || '').trim();
  if (isHttpUrl(value)) {
    return {
      sourceUrl: value,
      token: '',
      caption,
    };
  }

  const tokenMatch = value.match(/^(?:lark|feishu)-media:(.+)$/i);
  return {
    sourceUrl: '',
    token: tokenMatch ? tokenMatch[1] : '',
    caption,
  };
}

function addImageAsset(assets, seen, asset, index) {
  if (!asset) {
    return;
  }
  const key = asset.sourceUrl || asset.token;
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  assets.push({
    index,
    sourceUrl: asset.sourceUrl || '',
    token: asset.token || '',
    caption: asset.caption || 'image',
    width: asset.width || null,
    height: asset.height || null,
  });
}

function readTagAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const match = String(tag || '').match(pattern);
  return match ? String(match[2] || match[3] || '').trim() : '';
}

function normalizeDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function findOccurrences(body, selected) {
  const candidates = [];
  let index = body.indexOf(selected);
  while (index !== -1) {
    candidates.push(index);
    index = body.indexOf(selected, index + Math.max(1, selected.length));
  }
  return candidates;
}

function filterCandidatesByContext(body, candidates, selected, selectionContext) {
  if (!selectionContext || typeof selectionContext !== 'object' || candidates.length <= 1) {
    return candidates;
  }

  const before = normalizeContext(selectionContext.beforeText).slice(-160);
  const after = normalizeContext(selectionContext.afterText).slice(0, 160);
  if (!before && !after) {
    return candidates;
  }

  const filtered = candidates.filter((index) => {
    const beforeText = normalizeContext(body.slice(Math.max(0, index - 800), index));
    const afterText = normalizeContext(body.slice(index + selected.length, index + selected.length + 800));
    return (!before || beforeText.endsWith(before) || beforeText.includes(before))
      && (!after || afterText.startsWith(after) || afterText.includes(after));
  });
  return filtered.length ? filtered : candidates;
}

function normalizeContext(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

import {
  WRITE_MODE_APPEND_SECTION,
  WRITE_MODE_REPLACE_CONTENT,
  WRITE_MODE_UPDATE_CONTENT,
} from '../core/constants.mjs';
import { createMcpPageBundle, summarizePageBundle } from '../core/mcp-page-bundle.mjs';
import { LarkAuthService } from './lark/lark-auth-service.mjs';
import { LarkCliAdapter } from './lark/lark-cli-adapter.mjs';
import {
  LARK_PROVIDER_ID,
  LARK_PROVIDER_NAME,
  resolveLarkDocumentReference,
} from './lark/lark-document-parser.mjs';
import { resolveLarkImageAssets } from './lark/lark-media-resolver.mjs';

const DOCX_BLOCK_BATCH_SIZE = 50;

export class LarkDocumentProvider {
  constructor({
    adapter = null,
    authService = null,
    artifactStore = null,
    log = () => {},
  } = {}) {
    this.id = LARK_PROVIDER_ID;
    this.displayName = LARK_PROVIDER_NAME;
    this.adapter = adapter || new LarkCliAdapter({ log });
    this.authService = authService || new LarkAuthService({ adapter: this.adapter, log });
    this.artifactStore = artifactStore;
    this.log = log;
  }

  matchPage(pageUrl) {
    return resolveLarkDocumentReference(pageUrl);
  }

  async getStatus() {
    const status = await this.authService.getStatus();
    return {
      providerId: this.id,
      displayName: this.displayName,
      capabilities: {
        fullPageRead: true,
        imageArtifacts: true,
        writeBack: true,
        replaceSelection: true,
      },
      ...status,
    };
  }

  async connect(options = {}) {
    return this.authService.connect(options);
  }

  async fetchPageBundle(job) {
    await this.authService.ensureReady();
    const target = await this.resolveDocument(job.pageUrl);

    const [rawContentPayload, documentPayload, blocks] = await Promise.all([
      this.adapter.getDocumentRawContent(target.documentId),
      this.adapter.getDocument(target.documentId).catch(() => null),
      this.listAllDocumentBlocks(target.documentId).catch(() => []),
    ]);
    const markdown = extractRawContent(rawContentPayload);
    if (!markdown) {
      throw new Error('Feishu/Lark returned an empty document.');
    }

    const pageTitle = target.title || extractDocumentTitle(documentPayload) || job.pageTitle;
    const rawImages = extractImageAssetsFromBlocks(blocks);
    const resolvedImages = await resolveLarkImageAssets({
      adapter: this.adapter,
      artifactStore: this.artifactStore,
      jobId: job.id,
      imageAssets: rawImages,
      log: this.log,
    });

    const bundle = createMcpPageBundle({
      pageUrl: job.pageUrl,
      pageTitle,
      markdown,
      warnings: resolvedImages.warnings,
      provider: 'lark-openapi-docx',
      providerId: this.id,
      sourceProvider: this.id,
      runtimeId: '',
      truncated: false,
      assets: {
        images: resolvedImages.images,
      },
      revision: extractRevision(rawContentPayload) || extractRevision(documentPayload),
      providerMeta: {
        documentId: target.documentId,
        sourceKind: target.kind,
        sourceToken: target.sourceToken,
        wikiNodeToken: target.wikiNodeToken || '',
        imageTokenCount: rawImages.filter((asset) => asset.token).length,
      },
    });

    this.log('lark page bundle fetch completed', {
      summary: summarizePageBundle(bundle),
    });

    return {
      bundle,
      warnings: bundle.warnings,
    };
  }

  async writeBack(job) {
    await this.authService.ensureReady();
    const target = await this.resolveDocument(job.pageUrl);

    const writeMode = job.writeMode || WRITE_MODE_APPEND_SECTION;
    if (writeMode === WRITE_MODE_UPDATE_CONTENT) {
      return this.replaceSelection({ job, target });
    }

    const content = buildWriteMarkdown(job);
    const blocks = markdownToDocxBlocks(content);
    if (writeMode === WRITE_MODE_REPLACE_CONTENT) {
      await this.replaceDocumentBody(target.documentId, blocks);
      return {
        handled: true,
        replyText: 'Replaced the Feishu/Lark document body with the generated result.',
        runtimeMeta: {
          providerWriteBack: {
            providerId: this.id,
            writeMode,
            documentToken: target.documentId,
            api: 'docx.v1.blocks.children',
          },
        },
      };
    }

    await this.appendDocumentBlocks(target.documentId, blocks);
    return {
      handled: true,
      replyText: 'Appended the generated result to the Feishu/Lark document.',
      runtimeMeta: {
        providerWriteBack: {
          providerId: this.id,
          writeMode: WRITE_MODE_APPEND_SECTION,
          documentToken: target.documentId,
          api: 'docx.v1.blocks.children',
        },
      },
    };
  }

  async replaceSelection({ job, target }) {
    const blocks = await this.listAllDocumentBlocks(target.documentId);
    const located = locateSelectionInTextBlocks({
      blocks,
      selectionText: job.selectionText,
      replacementText: job.replyTextToWrite,
    });
    if (!located.ok) {
      throw new Error(located.reason || 'The selected text could not be located safely.');
    }

    await this.adapter.patchDocumentBlock(target.documentId, located.blockId, located.blockPatch);

    return {
      handled: true,
      replyText: 'Replaced the selected Feishu/Lark document text with the generated result.',
      runtimeMeta: {
        providerWriteBack: {
          providerId: this.id,
          writeMode: WRITE_MODE_UPDATE_CONTENT,
          documentToken: target.documentId,
          blockId: located.blockId,
          api: 'docx.v1.blocks.patch',
        },
      },
    };
  }

  async appendDocumentBlocks(documentId, blocks) {
    const safeBlocks = blocks.length ? blocks : markdownToDocxBlocks(' ');
    for (const chunk of chunkArray(safeBlocks, DOCX_BLOCK_BATCH_SIZE)) {
      await this.adapter.createDocumentChildren(documentId, documentId, {
        index: -1,
        children: chunk,
      });
    }
  }

  async replaceDocumentBody(documentId, blocks) {
    const children = await this.listAllDocumentChildren(documentId, documentId);
    if (children.length) {
      await this.adapter.batchDeleteDocumentChildren(documentId, documentId, {
        startIndex: 0,
        endIndex: children.length,
      });
    }
    await this.appendDocumentBlocks(documentId, blocks);
  }

  async listAllDocumentChildren(documentId, blockId) {
    const children = [];
    let pageToken = '';
    do {
      const payload = await this.adapter.listDocumentChildren(documentId, blockId, { pageToken });
      children.push(...extractItems(payload));
      pageToken = extractNextPageToken(payload);
    } while (pageToken);
    return children;
  }

  async listAllDocumentBlocks(documentId) {
    const blocks = [];
    let pageToken = '';
    do {
      const payload = await this.adapter.listDocumentBlocks(documentId, { pageToken });
      blocks.push(...extractItems(payload));
      pageToken = extractNextPageToken(payload);
    } while (pageToken);
    return blocks;
  }

  async resolveDocument(pageUrl) {
    const reference = resolveLarkDocumentReference(pageUrl);
    if (!reference) {
      throw new Error('The current page is not a supported Feishu/Lark docx or wiki document URL.');
    }

    if (reference.kind === 'docx') {
      return {
        ...reference,
        documentId: reference.token,
        sourceToken: reference.token,
        wikiNodeToken: '',
        title: '',
      };
    }

    const payload = await this.adapter.getWikiNode(reference.token);
    const node = extractWikiNode(payload);
    const objType = String(node.obj_type || '').trim().toLowerCase();
    const documentId = String(node.obj_token || '').trim();
    if (objType !== 'docx' || !documentId) {
      throw new Error(`This Feishu/Lark wiki node is ${objType || 'unknown'}; only docx wiki documents are supported.`);
    }

    return {
      ...reference,
      documentId,
      sourceToken: documentId,
      wikiNodeToken: String(node.node_token || reference.token).trim(),
      title: String(node.title || '').trim(),
    };
  }
}

export function markdownToDocxBlocks(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let inFence = false;
  let codeLines = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    if (text) {
      blocks.push(createTextBlock(text));
    }
  };

  const flushCode = () => {
    const text = codeLines.join('\n').trimEnd();
    codeLines = [];
    if (text) {
      blocks.push(createTextBlock(text));
    }
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        flushParagraph();
        inFence = true;
      }
      continue;
    }

    if (inFence) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push(createTextBlock(heading[2].trim(), `heading${heading[1].length}`));
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push(createTextBlock(bullet[1].trim(), 'bullet'));
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push(createTextBlock(ordered[1].trim(), 'ordered'));
      continue;
    }

    paragraph.push(line.trim());
  }

  if (inFence) {
    flushCode();
  }
  flushParagraph();

  return blocks;
}

function createTextBlock(content, kind = 'text') {
  const text = String(content || ' ');
  const typeMap = {
    text: [2, 'text'],
    heading1: [3, 'heading1'],
    heading2: [4, 'heading2'],
    heading3: [5, 'heading3'],
    heading4: [6, 'heading4'],
    heading5: [7, 'heading5'],
    heading6: [8, 'heading6'],
    bullet: [12, 'bullet'],
    ordered: [13, 'ordered'],
  };
  const [blockType, key] = typeMap[kind] || typeMap.text;
  return {
    block_type: blockType,
    [key]: {
      elements: [
        {
          text_run: {
            content: text,
          },
        },
      ],
    },
  };
}

function locateSelectionInTextBlocks({ blocks, selectionText, replacementText }) {
  const selected = String(selectionText || '').trim();
  const replacement = String(replacementText || '');
  if (!selected) {
    return {
      ok: false,
      reason: 'No selected text was provided.',
    };
  }

  const matches = [];
  for (const block of blocks) {
    const blockId = extractBlockId(block);
    const textContainer = getTextContainer(block);
    if (!blockId || !textContainer?.elements) {
      continue;
    }

    const blockText = extractTextFromElements(textContainer.elements);
    if (blockText.includes(selected)) {
      matches.push({
        block,
        blockId,
        textContainerKey: textContainer.key,
        textContainer,
        replacement,
      });
    }
  }

  if (matches.length !== 1) {
    return {
      ok: false,
      reason: matches.length
        ? 'The selected text appears more than once in the document. Select a more unique range and try again.'
        : 'The selected text was not found in the fetched Feishu/Lark document.',
    };
  }

  const match = matches[0];
  const replaced = replaceSelectionInSingleTextRun(match.textContainer.elements, selected, replacement);
  if (!replaced.ok) {
    return replaced;
  }

  return {
    ok: true,
    blockId: match.blockId,
    blockPatch: {
      block_type: normalizeBlockType(match.block),
      [match.textContainerKey]: {
        ...match.textContainer.value,
        elements: replaced.elements,
      },
    },
  };
}

function extractRawContent(payload) {
  return String(
    payload?.data?.content
    || payload?.data?.raw_content
    || payload?.content
    || payload?.raw_content
    || payload?.data?.document?.content
    || '',
  ).trim();
}

function extractDocumentTitle(payload) {
  return String(
    payload?.data?.document?.title
    || payload?.data?.title
    || payload?.document?.title
    || payload?.title
    || '',
  ).trim();
}

function extractRevision(payload) {
  return String(
    payload?.data?.document?.revision_id
    || payload?.data?.revision_id
    || payload?.document?.revision_id
    || payload?.revision_id
    || '',
  ).trim();
}

function extractWikiNode(payload) {
  return payload?.data?.node || payload?.node || {};
}

function extractItems(payload) {
  const candidates = [
    payload?.data?.items,
    payload?.data?.children,
    payload?.items,
    payload?.children,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function extractNextPageToken(payload) {
  return String(
    payload?.data?.page_token
    || payload?.data?.next_page_token
    || payload?.page_token
    || payload?.next_page_token
    || '',
  ).trim();
}

function extractImageAssetsFromBlocks(blocks) {
  const assets = [];
  const seen = new Set();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const image = block?.image || block?.file || {};
    const token = String(
      image.token
      || image.file_token
      || image.fileToken
      || image.block_token
      || block?.block_token
      || '',
    ).trim();
    const sourceUrl = String(image.url || image.src || '').trim();
    const key = sourceUrl || token;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    assets.push({
      sourceUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : '',
      token,
      caption: String(image.caption || image.name || 'image').trim(),
      width: normalizeDimension(image.width),
      height: normalizeDimension(image.height),
    });
  }
  return assets;
}

function extractBlockId(block) {
  return String(block?.block_id || block?.blockId || block?.id || '').trim();
}

function normalizeBlockType(block) {
  const value = block?.block_type ?? block?.blockType ?? 2;
  return Number.isFinite(Number(value)) ? Number(value) : value;
}

function getTextContainer(block) {
  const keys = [
    'text',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
    'heading7',
    'heading8',
    'heading9',
    'bullet',
    'ordered',
    'quote',
    'todo',
    'callout',
    'code',
  ];
  for (const key of keys) {
    const value = block?.[key];
    if (value && Array.isArray(value.elements)) {
      return { key, value, elements: value.elements };
    }
  }
  return null;
}

function extractTextFromElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((element) => element?.text_run?.content || element?.textRun?.content || element?.mention_user?.name || element?.mention_doc?.title || '')
    .join('');
}

function replaceSelectionInSingleTextRun(elements, selected, replacement) {
  let match = null;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const content = String(element?.text_run?.content || '');
    const offset = content.indexOf(selected);
    if (offset === -1) {
      continue;
    }
    if (match) {
      return {
        ok: false,
        reason: 'The selected text appears more than once in the same document block. Select a more unique range and try again.',
      };
    }
    match = { index, offset, content };
  }

  if (!match) {
    return {
      ok: false,
      reason: 'The selected text spans multiple rich-text runs. Select text inside one paragraph without mixed inline formatting.',
    };
  }

  const nextElements = elements.map((element, index) => {
    if (index !== match.index) {
      return element;
    }
    const nextContent = `${match.content.slice(0, match.offset)}${replacement}${match.content.slice(match.offset + selected.length)}`;
    return {
      ...element,
      text_run: {
        ...element.text_run,
        content: nextContent,
      },
    };
  });

  return {
    ok: true,
    elements: nextElements,
  };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function buildWriteMarkdown(job) {
  const replyText = String(job.replyTextToWrite || '').trim();
  if (!replyText || job.writeMode === WRITE_MODE_REPLACE_CONTENT) {
    return replyText;
  }

  const title = String(job.writeSectionTitle || '').trim();
  if (!title) {
    return replyText;
  }

  if (/^\s{0,3}#/m.test(replyText)) {
    return replyText;
  }

  return `## ${title.replace(/\s+/g, ' ')}\n\n${replyText}`;
}

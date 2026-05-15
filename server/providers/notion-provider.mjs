import { RuntimeBackedNotionPageBundleProvider } from '../core/page-bundle-provider.mjs';

const NOTION_HOST_PATTERN = /(^|\.)notion\.so$/i;

export class NotionDocumentProvider {
  constructor({ runtime, log = () => {} }) {
    this.id = 'notion';
    this.displayName = 'Notion';
    this.runtime = runtime;
    this.log = log;
    this.pageBundleProvider = new RuntimeBackedNotionPageBundleProvider({ runtime, log });
  }

  matchPage(pageUrl) {
    let url;
    try {
      url = new URL(pageUrl);
    } catch {
      return null;
    }

    if (!NOTION_HOST_PATTERN.test(url.hostname)) {
      return null;
    }

    return {
      providerId: this.id,
      kind: 'notion-page',
      token: '',
      pageUrl: url.toString(),
    };
  }

  async getStatus(runtimeStatus = null) {
    const notionMcp = runtimeStatus?.notionMcp || {};
    return {
      providerId: this.id,
      displayName: this.displayName,
      status: notionMcp.status || 'unknown',
      detail: notionMcp.detail || 'Notion uses the selected runtime Notion MCP configuration.',
      capabilities: {
        fullPageRead: true,
        imageArtifacts: true,
        writeBack: false,
        runtimeWriteBack: true,
        replaceSelection: false,
      },
    };
  }

  async fetchPageBundle(job) {
    return this.pageBundleProvider.fetchPageBundle(job);
  }
}

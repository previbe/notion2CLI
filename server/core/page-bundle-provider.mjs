import {
  createMcpPageBundle,
  parseRuntimePageBundleEnvelope,
  summarizePageBundle,
} from './mcp-page-bundle.mjs';

export class RuntimeBackedNotionPageBundleProvider {
  constructor({ runtime, log }) {
    this.runtime = runtime;
    this.log = log || (() => {});
  }

  async fetchPageBundle(job) {
    if (typeof this.runtime?.fetchPageBundle !== 'function') {
      return {
        bundle: null,
        warnings: [
          `当前 runtime（${this.runtime?.id || 'unknown'}）还不支持 bridge 侧的页面预取。`,
        ],
      };
    }

    this.log('page bundle fetch started', {
      runtime: this.runtime.id,
      pageUrl: job.pageUrl,
      pageTitle: job.pageTitle,
      action: job.action,
    });

    try {
      const responseText = await this.runtime.fetchPageBundle({
        pageUrl: job.pageUrl,
        pageTitle: job.pageTitle,
        source: job.source,
      });
      const parsed = parseRuntimePageBundleEnvelope(responseText);

      if (!parsed.ok) {
        const warnings = [
          parsed.error,
          ...parsed.warnings,
        ].filter(Boolean);

        this.log('page bundle fetch failed', {
          runtime: this.runtime.id,
          pageUrl: job.pageUrl,
          pageTitle: job.pageTitle,
          warnings,
        });

        return {
          bundle: null,
          warnings,
        };
      }

      const bundle = createMcpPageBundle({
        pageUrl: parsed.pageUrl || job.pageUrl,
        pageTitle: parsed.pageTitle || job.pageTitle,
        markdown: parsed.markdown,
        warnings: parsed.warnings,
        provider: 'runtime-backed-notion-mcp',
        runtimeId: this.runtime.id,
        truncated: parsed.truncated,
      });

      this.log('page bundle fetch completed', {
        runtime: this.runtime.id,
        summary: summarizePageBundle(bundle),
      });

      return {
        bundle,
        warnings: bundle.warnings,
      };
    } catch (error) {
      const message = error?.message || 'Failed to fetch page bundle';
      this.log('page bundle fetch crashed', {
        runtime: this.runtime?.id || 'unknown',
        pageUrl: job.pageUrl,
        error: message,
      });

      return {
        bundle: null,
        warnings: [message],
      };
    }
  }
}

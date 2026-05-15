import { ACTION_WRITE_REPLY } from '../core/constants.mjs';
import { LarkDocumentProvider } from './lark-provider.mjs';
import { NotionDocumentProvider } from './notion-provider.mjs';

const PROVIDER_STATUS_TIMEOUT_MS = 5000;

export class DocumentProviderRouter {
  constructor({ providers = [], fallbackProviderId = 'notion', log = () => {} } = {}) {
    this.providers = providers;
    this.fallbackProviderId = fallbackProviderId;
    this.log = log;
  }

  resolve(pageUrl, explicitProviderId = '') {
    const requested = String(explicitProviderId || '').trim().toLowerCase();
    if (requested) {
      const explicitProvider = this.providers.find((provider) => provider.id === requested);
      if (explicitProvider) {
        return explicitProvider;
      }
    }

    const matched = this.providers.find((provider) => Boolean(provider.matchPage?.(pageUrl)));
    if (matched) {
      return matched;
    }

    return this.providers.find((provider) => provider.id === this.fallbackProviderId) || null;
  }

  async getStatus(runtimeStatus = null) {
    const providers = await Promise.all(
      this.providers
        .filter((provider) => typeof provider.getStatus === 'function')
        .map((provider) => readProviderStatus(provider, runtimeStatus)),
    );

    return {
      providers,
    };
  }

  async fetchPageBundle(job) {
    const provider = this.resolve(job.pageUrl, job.providerId);
    if (!provider || typeof provider.fetchPageBundle !== 'function') {
      return {
        bundle: null,
        warnings: [`No document provider can read this page: ${job.pageUrl}`],
      };
    }

    return provider.fetchPageBundle(job);
  }

  async writeBack(job) {
    if (job.action !== ACTION_WRITE_REPLY) {
      return {
        handled: false,
      };
    }

    const provider = this.resolve(job.pageUrl, job.providerId);
    if (!provider || typeof provider.writeBack !== 'function') {
      return {
        handled: false,
        providerId: provider?.id || '',
      };
    }

    const result = await provider.writeBack(job);
    return {
      providerId: provider.id,
      ...result,
      handled: result?.handled !== false,
    };
  }
}

async function readProviderStatus(provider, runtimeStatus) {
  try {
    return await withTimeout(
      provider.getStatus(runtimeStatus),
      PROVIDER_STATUS_TIMEOUT_MS,
      `${provider.displayName || provider.id || 'Document provider'} status check timed out.`,
    );
  } catch (error) {
    return {
      providerId: provider.id || '',
      displayName: provider.displayName || provider.id || 'Document provider',
      status: 'unavailable',
      detail: error?.message || 'Document provider status is unavailable.',
      capabilities: {},
    };
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function createDocumentProviderRouter({ runtime, artifactStore = null, log = () => {} } = {}) {
  return new DocumentProviderRouter({
    log,
    providers: [
      new LarkDocumentProvider({ artifactStore, log }),
      new NotionDocumentProvider({ runtime, log }),
    ],
  });
}

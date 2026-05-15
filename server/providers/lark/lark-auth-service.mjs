import { LarkCliAdapter } from './lark-cli-adapter.mjs';

export const LARK_DOC_SCOPE_LIST = [
  'docx:document:readonly',
  'docx:document:write_only',
  'docs:document.media:download',
  'wiki:node:read',
];

export const LARK_DOC_SCOPES = LARK_DOC_SCOPE_LIST.join(' ');

export class LarkAuthService {
  constructor({ adapter = null, log = () => {} } = {}) {
    this.adapter = adapter || new LarkCliAdapter({ log });
    this.log = log;
    this.activeFlow = null;
  }

  async getStatus() {
    const activeFlow = this.getActiveFlowSnapshot();
    let version = '';

    try {
      version = await this.adapter.getVersion();
    } catch (error) {
      return {
        status: 'missing',
        detail: `Bundled lark-cli is not available: ${error?.message || 'command failed'}`,
        larkCliVersion: '',
        activeFlow,
      };
    }

    if (activeFlow) {
      return {
        status: 'authorization_pending',
        detail: activeFlow.phase === 'config'
          ? 'Open the Feishu/Lark setup link to create the local Personal Agent app.'
          : 'Open the Feishu/Lark authorization link to grant document access.',
        larkCliVersion: version,
        activeFlow,
      };
    }

    try {
      const payload = await this.adapter.authStatus();
      const identity = String(payload.identity || payload.data?.identity || '').trim();
      const tokenStatus = String(payload.tokenStatus || payload.data?.tokenStatus || '').trim();
      const userName = String(payload.userName || payload.data?.userName || '').trim();
      const scope = String(payload.scope || payload.data?.scope || '').trim();

      if (identity === 'user' && tokenStatus !== 'expired') {
        const missingScopes = listMissingScopes(scope);
        if (missingScopes.length) {
          return {
            status: 'unauthenticated',
            detail: `Feishu/Lark access is missing required scopes: ${missingScopes.join(', ')}. Use Connect Feishu/Lark to authorize again.`,
            larkCliVersion: version,
            identity,
            tokenStatus,
            scope,
            missingScopes,
            activeFlow: null,
          };
        }

        return {
          status: 'configured',
          detail: userName
            ? `Feishu/Lark user access is connected as ${userName}.`
            : 'Feishu/Lark user access is connected.',
          larkCliVersion: version,
          identity,
          tokenStatus,
          scope,
          activeFlow: null,
        };
      }

      return {
        status: 'unauthenticated',
        detail: 'Feishu/Lark app setup exists, but document access has not been authorized for this user.',
        larkCliVersion: version,
        identity: identity || 'bot',
        tokenStatus,
        activeFlow: null,
      };
    } catch (error) {
      return {
        status: isMissingConfigError(error) ? 'missing' : 'unavailable',
        detail: isMissingConfigError(error)
          ? 'Feishu/Lark is not connected yet. Use Connect Feishu/Lark to start the local browser authorization flow.'
          : `Could not read Feishu/Lark auth status: ${error?.message || 'unknown error'}`,
        larkCliVersion: version,
        activeFlow: null,
      };
    }
  }

  async ensureReady() {
    const status = await this.getStatus();
    if (status.status === 'configured') {
      return status;
    }

    if (status.activeFlow?.verificationUrl) {
      throw new Error(`Feishu/Lark authorization is still pending. Open this URL to continue: ${status.activeFlow.verificationUrl}`);
    }

    throw new Error(`${status.detail || 'Feishu/Lark is not connected.'} Open the extension popup and choose Connect Feishu/Lark.`);
  }

  async connect({ pageUrl = '' } = {}) {
    const activeFlow = this.getActiveFlowSnapshot();
    if (activeFlow) {
      return {
        ok: true,
        status: 'authorization_pending',
        ...activeFlow,
      };
    }

    const status = await this.getStatus();
    if (status.status === 'configured') {
      return {
        ok: true,
        status: 'configured',
        detail: status.detail,
      };
    }

    if (status.status === 'missing') {
      return this.startAppRegistration(pageUrl);
    }

    if (status.status === 'unavailable') {
      throw new Error(status.detail || 'Feishu/Lark authorization is currently unavailable.');
    }

    return this.startUserAuthorization();
  }

  async startAppRegistration(pageUrl) {
    const phase = 'config';
    const flow = this.adapter.startAppRegistration({
      brand: inferBrandFromPageUrl(pageUrl),
    });
    const verificationUrl = await flow.waitForUrl;
    this.setActiveFlow({ phase, verificationUrl, flow });
    return {
      ok: true,
      status: 'authorization_pending',
      phase,
      verificationUrl,
      detail: 'Open this Feishu/Lark setup link. After it finishes, click Connect Feishu/Lark again to authorize document access.',
    };
  }

  async startUserAuthorization() {
    const payload = await this.adapter.requestUserAuthorization({
      scopes: LARK_DOC_SCOPES,
    });
    const verificationUrl = String(
      payload.verification_url
      || payload.verificationUriComplete
      || payload.verification_uri_complete
      || payload.data?.verification_url
      || '',
    ).trim();
    const deviceCode = String(payload.device_code || payload.deviceCode || payload.data?.device_code || '').trim();
    if (!verificationUrl || !deviceCode) {
      throw new Error('lark-cli did not return a Feishu/Lark authorization URL and device code.');
    }

    const flow = this.adapter.startDeviceCodePolling(deviceCode);
    const phase = 'auth';
    this.setActiveFlow({ phase, verificationUrl, flow });
    return {
      ok: true,
      status: 'authorization_pending',
      phase,
      verificationUrl,
      detail: 'Open this Feishu/Lark authorization link to grant document access.',
    };
  }

  setActiveFlow({ phase, verificationUrl, flow }) {
    const activeFlow = {
      phase,
      verificationUrl,
      startedAt: new Date().toISOString(),
      flow,
    };
    this.activeFlow = activeFlow;
    flow.done.then((result) => {
      this.log('lark-cli authorization flow finished', {
        phase,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
    }).catch((error) => {
      this.log('lark-cli authorization flow failed', {
        phase,
        error: error?.message || 'unknown error',
      });
    }).finally(() => {
      if (this.activeFlow === activeFlow) {
        this.activeFlow = null;
      }
    });
  }

  getActiveFlowSnapshot() {
    if (!this.activeFlow) {
      return null;
    }

    return {
      phase: this.activeFlow.phase,
      verificationUrl: this.activeFlow.verificationUrl,
      startedAt: this.activeFlow.startedAt,
    };
  }
}

function inferBrandFromPageUrl(pageUrl) {
  try {
    const hostname = new URL(String(pageUrl || '')).hostname.toLowerCase();
    return hostname.includes('larksuite.com') || hostname.includes('larkoffice.com') ? 'lark' : 'feishu';
  } catch {
    return 'feishu';
  }
}

function isMissingConfigError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('config init')
    || message.includes('not configured')
    || message.includes('no apps')
    || message.includes('config.json')
    || message.includes('app id')
    || message.includes('app secret')
    || message.includes('not found');
}

function listMissingScopes(scope) {
  const value = String(scope || '').trim();
  if (!value) {
    return [];
  }
  const granted = new Set(value.split(/[\s,]+/).filter(Boolean));
  return LARK_DOC_SCOPE_LIST.filter((required) => !granted.has(required));
}

import { randomBytes, randomInt } from 'node:crypto';
import { PAIR_TTL_MS } from './constants.mjs';

export class PairingStore {
  constructor() {
    this.pairCode = null;
    this.pairExpiresAt = 0;
    this.clientToken = null;
    this.clientLabel = null;
  }

  createPairCode() {
    const code = String(randomInt(100000, 999999));
    const expiresAt = Date.now() + PAIR_TTL_MS;
    this.pairCode = code;
    this.pairExpiresAt = expiresAt;

    return {
      ok: true,
      code,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  confirm(code, clientLabel) {
    if (!this.pairCode || this.pairExpiresAt < Date.now()) {
      return {
        ok: false,
        error: 'No active pairing code. Run notion2cli pair first.',
        statusCode: 400,
      };
    }

    if (code !== this.pairCode) {
      return {
        ok: false,
        error: 'Invalid pairing code.',
        statusCode: 401,
      };
    }

    this.clientToken = randomBytes(24).toString('hex');
    this.clientLabel = clientLabel;
    this.pairCode = null;
    this.pairExpiresAt = 0;

    return {
      ok: true,
      token: this.clientToken,
      clientLabel: this.clientLabel,
    };
  }

  isAuthenticated(token) {
    return Boolean(token && token === this.clientToken);
  }

  getPublicSnapshot(authenticated) {
    return {
      paired: Boolean(authenticated),
      clientLabel: authenticated ? this.clientLabel : null,
      awaitingPairCode: Boolean(this.pairCode && this.pairExpiresAt > Date.now()),
      pairExpiresAt: this.pairExpiresAt ? new Date(this.pairExpiresAt).toISOString() : null,
    };
  }
}

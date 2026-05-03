import { existsSync, watch } from 'node:fs';

const REOPEN_AFTER_RENAME_MS = 100;
const REOPEN_AFTER_ERROR_MS = 2000;

export class MCPConfigWatcher {
  constructor({ configPaths, runProbe, log, debounceMs = 200 } = {}) {
    this.configPaths = (configPaths || []).filter(Boolean);
    this.runProbe = runProbe;
    this.log = typeof log === 'function' ? log : () => {};
    this.debounceMs = debounceMs;
    this.cached = null;
    this.activeProbe = null;
    this.debounceTimer = null;
    this.watchers = new Map();
    this.reopenTimers = new Set();
    this.stopped = false;
  }

  async start() {
    await this._probe();
    for (const configPath of this.configPaths) {
      this._attachWatcher(configPath);
    }
  }

  stop() {
    this.stopped = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const timer of this.reopenTimers) {
      clearTimeout(timer);
    }
    this.reopenTimers.clear();
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {}
    }
    this.watchers.clear();
  }

  async getStatus() {
    if (this.activeProbe) {
      try {
        await this.activeProbe;
      } catch {}
    }
    return this.cached;
  }

  invalidate() {
    this._scheduleProbe(0);
  }

  _attachWatcher(configPath) {
    if (this.stopped) return;

    const existing = this.watchers.get(configPath);
    if (existing) {
      try {
        existing.close();
      } catch {}
      this.watchers.delete(configPath);
    }

    if (!existsSync(configPath)) {
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
      return;
    }

    let watcher;
    try {
      watcher = watch(configPath, (eventType) => {
        this._scheduleProbe(this.debounceMs);
        if (eventType === 'rename') {
          this._scheduleReopen(configPath, REOPEN_AFTER_RENAME_MS);
        }
      });
      watcher.unref?.();
    } catch (err) {
      this.log('mcp watcher attach failed', { configPath, message: err?.message });
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
      return;
    }

    watcher.on('error', (err) => {
      this.log('mcp watcher error', { configPath, message: err?.message });
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
    });

    this.watchers.set(configPath, watcher);
  }

  _scheduleReopen(configPath, delay) {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.reopenTimers.delete(timer);
      this._attachWatcher(configPath);
    }, delay);
    this.reopenTimers.add(timer);
  }

  _scheduleProbe(delay) {
    if (this.stopped) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this._probe().catch(() => {});
    }, delay);
  }

  async _probe() {
    if (this.activeProbe) return this.activeProbe;
    this.activeProbe = (async () => {
      try {
        this.cached = await this.runProbe();
      } catch (err) {
        this.cached = {
          status: 'unknown',
          detail: err?.message || 'Failed to probe MCP status.',
        };
      } finally {
        this.activeProbe = null;
      }
    })();
    return this.activeProbe;
  }
}

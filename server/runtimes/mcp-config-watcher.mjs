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
    this.probeDirty = false;
    this.debounceTimer = null;
    this.watchers = new Map();
    this.missingPaths = new Set();
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

  async getStatus(options = {}) {
    const waitForActive = options.waitForActive !== false;
    if (waitForActive && this.activeProbe) {
      try {
        await this.activeProbe;
      } catch {}
    }

    if (this.cached) {
      return this.activeProbe && !waitForActive
        ? { ...this.cached, refreshing: true }
        : this.cached;
    }

    return {
      status: 'unknown',
      detail: this.activeProbe
        ? 'MCP status check is still running.'
        : 'MCP status has not been checked yet.',
      refreshing: Boolean(this.activeProbe),
    };
  }

  invalidate() {
    return this._probe({ force: true });
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
      this.missingPaths.add(configPath);
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
      return;
    }

    const wasMissing = this.missingPaths.has(configPath);
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
      this.missingPaths.add(configPath);
      this.log('mcp watcher attach failed', { configPath, message: err?.message });
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
      return;
    }

    watcher.on('error', (err) => {
      this.missingPaths.add(configPath);
      const current = this.watchers.get(configPath);
      if (current === watcher) {
        try {
          watcher.close();
        } catch {}
        this.watchers.delete(configPath);
      }
      this.log('mcp watcher error', { configPath, message: err?.message });
      this._scheduleReopen(configPath, REOPEN_AFTER_ERROR_MS);
    });

    this.watchers.set(configPath, watcher);
    this.missingPaths.delete(configPath);
    if (wasMissing) {
      this._scheduleProbe(0);
    }
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
      this._probe({ force: true }).catch(() => {});
    }, delay);
  }

  async _probe({ force = false } = {}) {
    if (this.stopped) return this.cached;
    if (this.activeProbe) {
      if (force) {
        this.probeDirty = true;
      }
      await this.activeProbe;
      return this.cached;
    }

    this.activeProbe = (async () => {
      try {
        do {
          this.probeDirty = false;
          try {
            this.cached = await this.runProbe();
          } catch (err) {
            this.cached = {
              status: 'unknown',
              detail: err?.message || 'Failed to probe MCP status.',
            };
          }
        } while (this.probeDirty && !this.stopped);
      } finally {
        this.activeProbe = null;
      }
    })();
    await this.activeProbe;
    return this.cached;
  }
}

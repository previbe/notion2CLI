import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getAppPaths, readJsonFile, writeJsonFile } from '../../cli/paths.mjs';
import {
  buildCodexThreadPermissionParams,
  buildCodexTurnPermissionParams,
  normalizePermissionMode,
} from '../core/permission-mode.mjs';
import { spawnCommand } from './exec-utils.mjs';

const CLIENT_INFO = {
  name: 'notion2cli',
  title: 'notion2cli live bridge',
  version: '0.2.0',
};

const WS_HOST = '127.0.0.1';
const WS_CONNECT_RETRIES = 50;
const WS_CONNECT_DELAY_MS = 100;
const THREAD_READ_RETRIES = 4;
const THREAD_READ_RETRY_DELAY_MS = 350;

export class CodexLiveSession {
  constructor({ cwd, model, profile, extraArgs, permissionMode, log }) {
    this.cwd = cwd;
    this.model = model || null;
    this.profile = profile || '';
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs : [];
    this.permissionMode = normalizePermissionMode(permissionMode);
    this.log = log;

    this.child = null;
    this.stderr = '';
    this.ws = null;
    this.wsUrl = '';
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.connected = false;
    this.closed = false;

    this.threadId = null;
    this.threadName = '';
    this.threadPath = '';
    this.threadStatus = { type: 'notLoaded' };
    this.turnCount = 0;
    this.latestUserMessage = '';
    this.latestUserAt = null;
    this.latestAssistantMessage = '';
    this.latestAssistantAt = null;
    this.latestSharableAssistantMessage = '';
    this.latestSharableAssistantAt = null;
    this.lastVerifiedAt = null;
    this.lastVerificationError = '';
    this.appVisible = false;

    this.turnQueue = [];
    this.activeTask = null;
    this.pendingApproval = null;
    this.retryPumpTimer = null;
  }

  async start() {
    const port = await reserveFreePort();
    this.wsUrl = `ws://${WS_HOST}:${port}`;

    const args = buildCodexAppServerWsArgs({
      listenUrl: this.wsUrl,
      profile: this.profile,
      extraArgs: this.extraArgs,
    });

    this.child = spawnCommand('codex', args, {
      cwd: this.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });

    this.child.on('error', (error) => {
      this.handleConnectionFailure(error?.message || 'Failed to start codex app-server');
    });

    this.child.on('close', (code, signal) => {
      this.handleConnectionFailure(
        this.stderr.trim() || `codex app-server exited (${signal || code || 'unknown'})`,
      );
    });

    await this.connectWebSocket();

    await this.request('initialize', {
      clientInfo: CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
      },
    });
    this.send({
      method: 'initialized',
    });

    await this.resumeOrStartThread();
  }

  async stop() {
    this.closed = true;
    this.rejectPendingRequests(new Error('Codex live session closed'));
    if (this.retryPumpTimer) {
      clearTimeout(this.retryPumpTimer);
      this.retryPumpTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {}
    }
  }

  getSnapshot() {
    return {
      ready: this.connected && Boolean(this.threadId),
      wsUrl: this.wsUrl || '',
      threadId: this.threadId || '',
      threadName: this.threadName || '',
      threadPath: this.threadPath || '',
      attachCommand: this.threadId ? `notion2cli codex attach` : '',
      openCommand: this.threadId ? 'notion2cli codex open' : '',
      inspectCommand: this.threadId ? 'notion2cli codex inspect' : '',
      permissionMode: this.permissionMode,
      status: serializeThreadStatus(this.threadStatus),
      appVisible: Boolean(this.appVisible),
      turnCount: this.turnCount,
      latestUserMessage: this.latestUserMessage || '',
      latestUserAt: this.latestUserAt,
      latestAssistantMessage: this.latestAssistantMessage || '',
      latestAssistantAt: this.latestAssistantAt,
      latestSharableAssistantMessage: this.latestSharableAssistantMessage || '',
      latestSharableAssistantAt: this.latestSharableAssistantAt,
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationError: this.lastVerificationError || '',
      queueDepth: this.turnQueue.length,
      activeJobId: this.activeTask?.jobId || '',
      pendingApproval: this.pendingApproval
        ? {
            jobId: this.pendingApproval.jobId || '',
            ...this.pendingApproval.payload,
          }
        : null,
    };
  }

  enqueueTurn(task) {
    const entry = {
      ...task,
      queuedAt: Date.now(),
      finalMessage: '',
      turnId: null,
    };
    this.turnQueue.push(entry);
    this.pumpQueue().catch((error) => {
      this.log('codex turn queue pump failed', {
        error: error?.message || 'Unknown queue error',
      });
    });
    return {
      queued: true,
      queueDepth: this.turnQueue.length,
    };
  }

  async cancelTurn(jobId) {
    const id = String(jobId || '').trim();
    const queueIndex = this.turnQueue.findIndex((task) => task.jobId === id);
    if (queueIndex >= 0) {
      this.turnQueue.splice(queueIndex, 1);
      return {
        ok: true,
        mode: 'queued',
        message: 'Queued Codex turn was removed before it started.',
      };
    }

    let activeTask = null;
    if (this.activeTask?.jobId === id) {
      this.activeTask.cancelled = true;
      activeTask = this.activeTask;
    }

    if (this.pendingApproval?.jobId === id) {
      await this.respondToApproval(id, { action: 'cancel' });
      const interruptResult = await this.interruptActiveTurn(activeTask);
      return {
        ok: true,
        mode: interruptResult.mode,
        message: interruptResult.message,
      };
    }

    if (activeTask) {
      const interruptResult = await this.interruptActiveTurn(activeTask);
      return {
        ok: true,
        mode: interruptResult.mode,
        message: interruptResult.message,
      };
    }

    return {
      ok: true,
      mode: 'unsupported',
      message: 'No queued or active Codex turn was found for this job.',
    };
  }

  async interruptActiveTurn(task) {
    if (!task?.turnId || !this.threadId) {
      return {
        ok: false,
        mode: 'soft',
        message: 'Stopped waiting for this result; the Codex turn has not returned an interruptible turnId yet.',
      };
    }

    try {
      await this.request('turn/interrupt', {
        threadId: this.threadId,
        turnId: task.turnId,
      });
      return {
        ok: true,
        mode: 'hard',
        message: 'Sent turn interrupt to Codex.',
      };
    } catch (error) {
      const message = error?.message || 'Codex turn interrupt failed';
      this.log('codex turn interrupt failed', {
        threadId: this.threadId,
        turnId: task.turnId,
        jobId: task.jobId,
        error: message,
      });
      return {
        ok: false,
        mode: 'soft',
        message: `Stopped waiting for this result; Codex interrupt did not succeed: ${message}`,
      };
    }
  }

  async respondToApproval(jobId, resolution) {
    if (!this.pendingApproval || this.pendingApproval.jobId !== jobId) {
      throw new Error('No pending Codex approval for this job');
    }

    const pendingApproval = this.pendingApproval;
    this.pendingApproval = null;
    this.send({
      jsonrpc: '2.0',
      id: pendingApproval.requestId,
      result: {
        action: resolution.action,
        content: buildApprovalContent(resolution, pendingApproval.params),
        _meta: Object.hasOwn(resolution, '_meta') ? resolution._meta : null,
      },
    });

    if (this.activeTask?.jobId === jobId) {
      this.activeTask.onApprovalResolved?.(resolution);
    }
  }

  assertReady() {
    if (!this.connected || !this.threadId) {
      throw new Error('Codex live session is not ready');
    }
  }

  async connectWebSocket() {
    let lastError = null;

    for (let attempt = 0; attempt < WS_CONNECT_RETRIES; attempt += 1) {
      try {
        await this.openWebSocket();
        return;
      } catch (error) {
        lastError = error;
        await sleep(WS_CONNECT_DELAY_MS);
      }
    }

    throw lastError || new Error('Unable to connect to the local Codex app-server');
  }

  openWebSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      let settled = false;

      const finish = (fn, value) => {
        if (settled) {
          return;
        }

        settled = true;
        fn(value);
      };

      ws.addEventListener('open', () => {
        this.ws = ws;
        this.connected = true;
        ws.addEventListener('message', (event) => {
          this.handleMessage(event).catch((error) => {
            this.log('codex live session message handling failed', {
              error: error?.message || 'Unknown websocket message error',
            });
          });
        });
        ws.addEventListener('close', () => {
          this.handleConnectionFailure('Codex websocket closed');
        });
        ws.addEventListener('error', (event) => {
          const message = event?.message || 'Codex websocket error';
          this.handleConnectionFailure(message);
        });
        finish(resolve);
      });

      ws.addEventListener('error', (event) => {
        const message = event?.message || 'Codex websocket error';
        finish(reject, new Error(message));
      });
    });
  }

  async handleMessage(event) {
    const message = JSON.parse(await readWsData(event.data));

    if (Object.hasOwn(message, 'id') && !Object.hasOwn(message, 'method')) {
      this.handleResponse(message);
      return;
    }

    if (!message.method) {
      return;
    }

    if (Object.hasOwn(message, 'id')) {
      await this.handleServerRequest(message);
      return;
    }

    await this.handleNotification(message);
  }

  handleResponse(message) {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);
    if (message.error) {
      pending.reject(new Error(normalizeRpcError(message.error)));
      return;
    }

    pending.resolve(message.result);
  }

  async handleServerRequest(message) {
    if (message.method !== 'mcpServer/elicitation/request') {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported server request: ${message.method}`,
        },
      });
      return;
    }

    if (this.activeTask?.cancelled) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          action: 'cancel',
          content: null,
          _meta: null,
        },
      });
      this.log('codex approval auto-cancelled for cancelled turn', {
        threadId: this.threadId,
        turnId: this.activeTask.turnId || null,
        jobId: this.activeTask.jobId || null,
      });
      return;
    }

    const payload = buildPendingApproval(message.params || {});
    this.pendingApproval = {
      requestId: message.id,
      params: message.params || {},
      jobId: this.activeTask?.jobId || null,
      payload,
    };
    this.threadStatus = {
      type: 'active',
      activeFlags: ['waitingOnApproval'],
    };

    this.activeTask?.onApprovalRequested?.({
      threadId: this.threadId,
      turnId: this.activeTask?.turnId || null,
      requestId: message.id,
      pendingApproval: payload,
    });
  }

  async handleNotification(message) {
    switch (message.method) {
      case 'thread/statusChanged':
        if (message.params?.threadId === this.threadId) {
          this.threadStatus = normalizeThreadStatus(message.params?.status);
          this.persistSnapshot().catch(() => {});
          if (isThreadIdle(this.threadStatus)) {
            this.pumpQueue().catch(() => {});
          }
        }
        break;
      case 'thread/name/updated':
        if (message.params?.threadId === this.threadId) {
          this.threadName = String(message.params?.threadName || '').trim();
          this.persistSnapshot().catch(() => {});
        }
        break;
      case 'item/completed':
        this.captureCompletedItem(message.params?.item);
        break;
      case 'turn/completed':
        await this.handleTurnCompleted(message.params?.turn || {});
        break;
      default:
        break;
    }
  }

  captureCompletedItem(item) {
    if (item?.type !== 'agentMessage' || item.phase !== 'final_answer') {
      return;
    }

    const text = String(item.text || '').trim();
    if (!text) {
      return;
    }

    this.latestAssistantMessage = text;
    this.latestAssistantAt = new Date().toISOString();
    if (!this.activeTask || (!this.activeTask.cancelled && this.activeTask.captureReply !== false)) {
      this.latestSharableAssistantMessage = text;
      this.latestSharableAssistantAt = this.latestAssistantAt;
    }

    if (this.activeTask) {
      this.activeTask.finalMessage = text;
    }

    this.persistSnapshot().catch(() => {});
  }

  async handleTurnCompleted(turn) {
    const turnId = String(turn?.id || '').trim();
    if (!this.activeTask || !turnId) {
      if (isThreadIdle(this.threadStatus)) {
        this.pumpQueue().catch(() => {});
      }
      return;
    }

    if (this.activeTask.turnId && turnId !== this.activeTask.turnId) {
      if (isThreadIdle(this.threadStatus)) {
        this.pumpQueue().catch(() => {});
      }
      return;
    }

    const task = this.activeTask;
    this.activeTask = null;
    this.pendingApproval = null;

    if (task.cancelled) {
      this.persistSnapshot().catch(() => {});
      this.pumpQueue().catch(() => {});
      return;
    }

    if (turn.status === 'completed') {
      const finalMessage = task.finalMessage || extractFinalMessageFromTurn(turn);
      if (finalMessage) {
        this.latestAssistantMessage = finalMessage;
        this.latestAssistantAt = new Date().toISOString();
      }
      if (finalMessage && task.captureReply !== false) {
        this.latestSharableAssistantMessage = finalMessage;
        this.latestSharableAssistantAt = this.latestAssistantAt;
      }
      const verification = await this.verifyThreadState().catch((error) => {
        this.lastVerificationError = error?.message || 'Codex thread verification failed';
        this.persistSnapshot().catch(() => {});
        return null;
      });
      task.onCompleted?.(finalMessage || '', {
        threadId: this.threadId,
        turnId,
        verifiedAt: verification?.verifiedAt || null,
        appVisible: verification?.appVisible ?? false,
        turnCount: this.turnCount,
        verificationError: this.lastVerificationError || null,
      });
      this.persistSnapshot().catch(() => {});
      this.pumpQueue().catch(() => {});
      return;
    }

    const errorText = turn?.error?.message
      || turn?.error?.additionalDetails
      || this.stderr.trim()
      || `Codex turn ended with status ${turn.status || 'unknown'}`;
    if (!task.retriedAfterThreadReset && isInvalidHistoricalInputError(errorText)) {
      this.log('codex live session turn failed because history contained invalid input, starting a fresh thread', {
        threadId: this.threadId,
        turnId,
        error: errorText,
      });
      task.retriedAfterThreadReset = true;
      this.startFreshThread()
        .then(() => {
          this.turnQueue.unshift(task);
          return this.pumpQueue();
        })
        .catch((error) => {
          task.onFailed?.(error?.message || errorText, {
            threadId: this.threadId,
            turnId,
            turnStatus: turn.status || 'unknown',
          });
        });
      return;
    }

    task.onFailed?.(errorText, {
      threadId: this.threadId,
      turnId,
      turnStatus: turn.status || 'unknown',
    });
    this.persistSnapshot().catch(() => {});
    this.pumpQueue().catch(() => {});
  }

  async pumpQueue() {
    if (this.closed || this.activeTask || this.pendingApproval || !this.turnQueue.length) {
      return;
    }

    this.assertReady();
    const task = this.turnQueue.shift();
    this.activeTask = task;

    try {
      const response = await this.request('turn/start', {
        threadId: this.threadId,
        input: Array.isArray(task.inputItems) ? task.inputItems : [],
        ...buildCodexTurnPermissionParams(task.permissionMode || this.permissionMode),
        ...(this.model ? { model: this.model } : {}),
      });
      task.turnId = response?.turn?.id || null;
      if (task.cancelled) {
        await this.interruptActiveTurn(task);
        return;
      }
      task.onRunning?.({
        threadId: this.threadId,
        turnId: task.turnId,
      });
    } catch (error) {
      if (!task.retriedAfterThreadReset && isInvalidHistoricalInputError(error)) {
        this.log('codex live session history contained invalid input, starting a fresh thread', {
          threadId: this.threadId,
          error: error?.message || 'Unknown turn/start error',
        });
        task.retriedAfterThreadReset = true;
        this.activeTask = null;
        await this.startFreshThread();
        this.turnQueue.unshift(task);
        this.pumpQueue().catch(() => {});
        return;
      }

      if (isThreadBusyError(error)) {
        this.activeTask = null;
        this.turnQueue.unshift(task);
        this.schedulePumpRetry();
        this.persistSnapshot().catch(() => {});
        return;
      }

      this.activeTask = null;
      task.onFailed?.(error?.message || 'Failed to start Codex turn', {
        threadId: this.threadId,
      });
      this.persistSnapshot().catch(() => {});
      this.pumpQueue().catch(() => {});
    }
  }

  schedulePumpRetry(delayMs = 1500) {
    if (this.closed || this.retryPumpTimer) {
      return;
    }

    this.retryPumpTimer = setTimeout(() => {
      this.retryPumpTimer = null;
      this.pumpQueue().catch((error) => {
        this.log('codex turn queue retry failed', {
          error: error?.message || 'Unknown queue retry error',
        });
      });
    }, delayMs);
    this.retryPumpTimer.unref?.();
  }

  async request(method, params) {
    const id = this.requestId;
    this.requestId += 1;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  send(message) {
    if (!this.ws || !this.connected) {
      throw new Error('Codex websocket is not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  handleConnectionFailure(message) {
    if (this.closed) {
      return;
    }

    this.connected = false;
    this.rejectPendingRequests(new Error(message));
    this.pendingApproval = null;

    if (this.activeTask) {
      this.activeTask.onFailed?.(message, {
        threadId: this.threadId,
        turnId: this.activeTask.turnId || null,
      });
      this.activeTask = null;
    }

    const queuedTasks = this.turnQueue.splice(0);
    for (const task of queuedTasks) {
      task.onFailed?.(message, {
        threadId: this.threadId,
        turnId: task.turnId || null,
      });
    }
  }

  async resumeOrStartThread() {
    const persisted = await readSessionState(this.cwd);
    let threadResponse = null;

    if (persisted?.threadId) {
      this.applyPersistedState(persisted);
      if (shouldStartFreshThreadForPermissionMode(persisted, this.permissionMode)) {
        this.log('codex live session permission mode changed, starting a fresh thread', {
          threadId: persisted.threadId,
          previousPermissionMode: normalizePermissionMode(persisted.permissionMode),
          permissionMode: this.permissionMode,
        });
      } else {
        try {
          threadResponse = await this.request('thread/resume', {
            threadId: persisted.threadId,
            cwd: this.cwd,
            ...buildCodexThreadPermissionParams(this.permissionMode),
            persistExtendedHistory: true,
            ...(this.model ? { model: this.model } : {}),
          });
          this.log('codex live session resumed thread', {
            threadId: persisted.threadId,
          });
        } catch (error) {
          this.log('codex live session resume failed, starting a fresh thread', {
            threadId: persisted.threadId,
            error: error?.message || 'Unknown resume error',
          });
        }
      }
    }

    if (!threadResponse) {
      await this.startFreshThread();
      return;
    }

    this.threadId = threadResponse?.thread?.id || null;
    this.threadStatus = normalizeThreadStatus(threadResponse?.thread?.status);
    this.applyThreadSnapshot(threadResponse?.thread || null);

    await this.ensureThreadName();
    await this.verifyThreadState({ allowEmptyTurns: true });
    await this.persistSnapshot();
  }

  async startFreshThread() {
    const threadResponse = await this.request('thread/start', {
      cwd: this.cwd,
      ...buildCodexThreadPermissionParams(this.permissionMode),
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      ...(this.model ? { model: this.model } : {}),
    });

    this.threadId = threadResponse?.thread?.id || null;
    this.threadStatus = normalizeThreadStatus(threadResponse?.thread?.status);
    this.threadName = '';
    this.threadPath = '';
    this.turnCount = 0;
    this.latestUserMessage = '';
    this.latestUserAt = null;
    this.latestAssistantMessage = '';
    this.latestAssistantAt = null;
    this.latestSharableAssistantMessage = '';
    this.latestSharableAssistantAt = null;
    this.lastVerifiedAt = null;
    this.lastVerificationError = '';
    this.appVisible = false;
    this.pendingApproval = null;
    this.applyThreadSnapshot(threadResponse?.thread || null);
    await this.ensureThreadName({ force: true });
    await this.verifyThreadState({ allowEmptyTurns: true });
    await this.persistSnapshot();
  }

  async ensureThreadName({ force = false } = {}) {
    if (!this.threadId) {
      return;
    }

    if (!force && String(this.threadName || '').trim()) {
      return;
    }

    const name = buildCodexThreadName(this.cwd);
    try {
      await this.request('thread/name/set', {
        threadId: this.threadId,
        name,
      });
      this.threadName = name;
      await this.persistSnapshot();
    } catch (error) {
      this.log('codex live session name set failed', {
        threadId: this.threadId,
        error: error?.message || 'Unknown thread/name/set error',
      });
    }
  }

  async verifyThreadState({ allowEmptyTurns = false } = {}) {
    if (!this.threadId) {
      return null;
    }

    let lastError = null;
    for (let attempt = 0; attempt < THREAD_READ_RETRIES; attempt += 1) {
      try {
        const response = await this.request('thread/read', {
          threadId: this.threadId,
          includeTurns: true,
        });
        const thread = response?.thread || null;
        this.applyThreadSnapshot(thread);

        if (!allowEmptyTurns && this.turnCount < 1) {
          throw new Error('Codex thread has no materialized turns yet');
        }

        const appVisible = await this.verifyThreadListedInApp().catch((error) => {
          this.log('codex live session app visibility check failed', {
            threadId: this.threadId,
            error: error?.message || 'Unknown thread/list error',
          });
          return false;
        });

        this.appVisible = appVisible;
        this.lastVerifiedAt = new Date().toISOString();
        this.lastVerificationError = appVisible ? '' : 'Codex thread was readable but not found in thread/list';
        await this.persistSnapshot();
        return {
          verifiedAt: this.lastVerifiedAt,
          appVisible: this.appVisible,
          turnCount: this.turnCount,
        };
      } catch (error) {
        lastError = error;
        const message = error?.message || '';
        if (/not materialized yet|includeTurns is unavailable before first user message/i.test(message)) {
          if (allowEmptyTurns) {
            this.lastVerifiedAt = new Date().toISOString();
            this.lastVerificationError = '';
            await this.persistSnapshot();
            return {
              verifiedAt: this.lastVerifiedAt,
              appVisible: this.appVisible,
              turnCount: this.turnCount,
            };
          }
        }

        if (attempt + 1 < THREAD_READ_RETRIES) {
          await sleep(THREAD_READ_RETRY_DELAY_MS);
        }
      }
    }

    this.lastVerificationError = lastError?.message || 'Codex thread verification failed';
    await this.persistSnapshot();
    throw lastError || new Error(this.lastVerificationError);
  }

  async verifyThreadListedInApp() {
    if (!this.threadId) {
      return false;
    }

    const response = await this.request('thread/list', {
      archived: false,
      cwd: this.cwd,
      limit: 30,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      sourceKinds: ['appServer'],
      useStateDbOnly: false,
    });
    const threads = Array.isArray(response?.data) ? response.data : [];
    const thread = threads.find((item) => item?.id === this.threadId) || null;
    if (thread) {
      this.applyThreadSnapshot(thread);
      return true;
    }

    return false;
  }

  applyPersistedState(state) {
    if (!state || typeof state !== 'object') {
      return;
    }

    this.threadId = state.threadId || this.threadId;
    this.threadName = state.threadName || this.threadName;
    this.threadPath = state.threadPath || this.threadPath;
    this.turnCount = Number.isFinite(Number(state.turnCount)) ? Number(state.turnCount) : this.turnCount;
    this.latestUserMessage = state.latestUserMessage || this.latestUserMessage;
    this.latestUserAt = state.latestUserAt || this.latestUserAt;
    this.latestAssistantMessage = state.latestAssistantMessage || this.latestAssistantMessage;
    this.latestAssistantAt = state.latestAssistantAt || this.latestAssistantAt;
    this.latestSharableAssistantMessage = state.latestSharableAssistantMessage || this.latestSharableAssistantMessage;
    this.latestSharableAssistantAt = state.latestSharableAssistantAt || this.latestSharableAssistantAt;
    this.lastVerifiedAt = state.lastVerifiedAt || this.lastVerifiedAt;
    this.lastVerificationError = state.lastVerificationError || this.lastVerificationError;
    this.appVisible = Boolean(state.appVisible);
  }

  applyThreadSnapshot(thread) {
    if (!thread || typeof thread !== 'object') {
      return;
    }

    if (thread.id) {
      this.threadId = String(thread.id);
    }

    this.threadName = String(thread.name || this.threadName || '').trim();
    this.threadPath = String(thread.path || this.threadPath || '').trim();
    this.threadStatus = normalizeThreadStatus(thread.status || this.threadStatus);

    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    if (turns.length > 0) {
      this.turnCount = turns.length;
      const latestUser = extractLatestUserFromTurns(turns);
      if (latestUser.message) {
        this.latestUserMessage = latestUser.message;
        this.latestUserAt = latestUser.at || this.latestUserAt;
      }

      const latestAssistant = extractLatestAssistantFromTurns(turns);
      if (latestAssistant.message) {
        this.latestAssistantMessage = latestAssistant.message;
        this.latestAssistantAt = latestAssistant.at || this.latestAssistantAt;
        this.latestSharableAssistantMessage ||= latestAssistant.message;
        this.latestSharableAssistantAt ||= latestAssistant.at || this.latestAssistantAt;
      }
    }
  }

  async loadLatestAssistantFromThread() {
    if (!this.threadId) {
      return;
    }

    let response = null;
    try {
      response = await this.request('thread/read', {
        threadId: this.threadId,
        includeTurns: true,
      });
    } catch (error) {
      const message = error?.message || '';
      if (/not materialized yet|includeTurns is unavailable before first user message/i.test(message)) {
        return;
      }
      throw error;
    }

    const thread = response?.thread || null;
    const latest = extractLatestAssistantFromTurns(thread?.turns || []);

    if (latest.message) {
      this.latestAssistantMessage = latest.message;
      this.latestAssistantAt = latest.at || this.latestAssistantAt;
    }

    if (latest.message) {
      this.latestSharableAssistantMessage = latest.message;
      this.latestSharableAssistantAt = latest.at || this.latestSharableAssistantAt;
    }
  }

  async persistSnapshot() {
    await writeSessionState({
      cwd: this.cwd,
      threadId: this.threadId,
      threadName: this.threadName,
      threadPath: this.threadPath,
      turnCount: this.turnCount,
      latestUserMessage: this.latestUserMessage,
      latestUserAt: this.latestUserAt,
      latestAssistantMessage: this.latestAssistantMessage,
      latestAssistantAt: this.latestAssistantAt,
      latestSharableAssistantMessage: this.latestSharableAssistantMessage,
      latestSharableAssistantAt: this.latestSharableAssistantAt,
      lastVerifiedAt: this.lastVerifiedAt,
      lastVerificationError: this.lastVerificationError,
      appVisible: this.appVisible,
      permissionMode: this.permissionMode,
    });
  }
}

export function buildCodexThreadName(cwd) {
  const projectName = path.basename(path.resolve(cwd || process.cwd())) || 'workspace';
  return `notion2CLI - ${projectName}`;
}

export function shouldStartFreshThreadForPermissionMode(persisted, permissionMode) {
  if (!persisted?.threadId) {
    return false;
  }

  return normalizePermissionMode(persisted.permissionMode) !== normalizePermissionMode(permissionMode);
}

export function buildCodexAppServerWsArgs({ listenUrl, profile, extraArgs }) {
  const args = ['app-server', '--listen', listenUrl];

  if (profile) {
    args.push('-c', `profile="${escapeTomlString(profile)}"`);
  }

  if (Array.isArray(extraArgs) && extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

async function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, WS_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function readWsData(data) {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.text();
  }

  return String(data || '');
}

async function readSessionState(cwd) {
  const state = await readJsonFile(getCodexSessionFile());
  if (!state || state.cwd !== cwd || !state.threadId) {
    return null;
  }

  return state;
}

async function writeSessionState(state) {
  if (!state?.threadId) {
    return;
  }

  await writeJsonFile(getCodexSessionFile(), {
    cwd: state.cwd,
    threadId: state.threadId,
    permissionMode: normalizePermissionMode(state.permissionMode),
    threadName: state.threadName || '',
    threadPath: state.threadPath || '',
    turnCount: Number.isFinite(Number(state.turnCount)) ? Number(state.turnCount) : 0,
    latestUserMessage: state.latestUserMessage || '',
    latestUserAt: state.latestUserAt || null,
    latestAssistantMessage: state.latestAssistantMessage || '',
    latestAssistantAt: state.latestAssistantAt || null,
    latestSharableAssistantMessage: state.latestSharableAssistantMessage || '',
    latestSharableAssistantAt: state.latestSharableAssistantAt || null,
    lastVerifiedAt: state.lastVerifiedAt || null,
    lastVerificationError: state.lastVerificationError || '',
    appVisible: Boolean(state.appVisible),
    updatedAt: new Date().toISOString(),
  });
}

function getCodexSessionFile() {
  return `${getAppPaths().stateDir}/codex-session.json`;
}

function extractLatestAssistantFromTurns(turns) {
  const list = Array.isArray(turns) ? turns : [];

  for (let turnIndex = list.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = list[turnIndex];
    const items = Array.isArray(turn?.items) ? turn.items : [];

    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        return {
          message: item.text.trim(),
          at: turn?.completedAt ? new Date(turn.completedAt * 1000).toISOString() : null,
        };
      }
    }
  }

  return {
    message: '',
    at: null,
  };
}

function extractLatestUserFromTurns(turns) {
  const list = Array.isArray(turns) ? turns : [];

  for (let turnIndex = list.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = list[turnIndex];
    const items = Array.isArray(turn?.items) ? turn.items : [];

    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item?.type !== 'userMessage') {
        continue;
      }

      const text = extractTextFromUserContent(item.content);
      if (text) {
        return {
          message: text,
          at: turn?.startedAt ? new Date(turn.startedAt * 1000).toISOString() : null,
        };
      }
    }
  }

  return {
    message: '',
    at: null,
  };
}

function extractTextFromUserContent(content) {
  const list = Array.isArray(content) ? content : [];
  return list
    .map((item) => {
      if (item?.type === 'text') {
        return String(item.text || '').trim();
      }

      if (item?.type === 'localImage') {
        return `[image: ${item.path || 'local'}]`;
      }

      if (item?.type === 'image') {
        return `[image: ${item.url || 'remote'}]`;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeThreadStatus(status) {
  if (!status || typeof status !== 'object') {
    return { type: 'notLoaded' };
  }

  if (status.type === 'active') {
    return {
      type: 'active',
      activeFlags: Array.isArray(status.activeFlags) ? status.activeFlags : [],
    };
  }

  if (status.type === 'idle' || status.type === 'systemError' || status.type === 'notLoaded') {
    return {
      type: status.type,
    };
  }

  return {
    type: 'notLoaded',
  };
}

function serializeThreadStatus(status) {
  const normalized = normalizeThreadStatus(status);
  return {
    type: normalized.type,
    activeFlags: Array.isArray(normalized.activeFlags) ? normalized.activeFlags : [],
  };
}

function isThreadIdle(status) {
  return normalizeThreadStatus(status).type === 'idle';
}

function escapeTomlString(value) {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function normalizeRpcError(error) {
  if (!error) {
    return 'Unknown JSON-RPC error';
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return JSON.stringify(error);
}

function isInvalidHistoricalInputError(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  return /unknown parameter:\s*['"]?input\[\d+\]\.end_turn/i.test(message);
}

function isThreadBusyError(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  return /active turn|turn.*active|thread.*busy|thread.*not.*idle|cannot accept same-turn steering|another turn/i.test(message);
}

function extractFinalMessageFromTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === 'agentMessage' && item.phase === 'final_answer') {
      return String(item.text || '').trim();
    }
  }

  return '';
}

function buildPendingApproval(params) {
  const message = String(params?.message || 'Codex needs your confirmation to continue.').trim();
  const mode = params?.mode === 'url' ? 'url' : 'form';

  return {
    kind: 'mcp_elicitation',
    serverName: String(params?.serverName || '').trim() || 'unknown',
    mode,
    message,
    url: mode === 'url' ? String(params?.url || '').trim() : '',
    requestedSchema: mode === 'form' ? params?.requestedSchema || null : null,
  };
}

function buildApprovalContent(resolution, params) {
  if (resolution.action !== 'accept') {
    return null;
  }

  if (Object.hasOwn(resolution, 'content')) {
    return resolution.content ?? null;
  }

  return params?.mode === 'form' ? {} : null;
}

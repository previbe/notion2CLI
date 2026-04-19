import {
  JOB_STATUS_COMPLETED,
  JOB_STATUS_DISPATCHED,
  JOB_STATUS_FAILED,
  JOB_STATUS_RUNNING,
  JOB_STATUS_WAITING_FOR_APPROVAL,
  createHttpError,
  readBearer,
} from './constants.mjs';
import { JobStore } from './job-store.mjs';
import { PairingStore } from './pairing-store.mjs';
import { parseApprovalResolution, parseJobRequest, parsePairConfirm } from './schemas.mjs';

export class BridgeApp {
  constructor({ runtime, log }) {
    this.runtime = runtime;
    this.log = log;
    this.startedAt = new Date().toISOString();
    this.jobStore = new JobStore();
    this.pairingStore = new PairingStore();
    this.runtimeContext = this.createRuntimeContext();
  }

  async start() {
    await this.runtime.start(this.runtimeContext);
  }

  async stop() {
    await this.runtime.stop();
  }

  async getPublicStatus(req) {
    this.jobStore.prune();
    const token = typeof req === 'string'
      ? req
      : req && typeof req === 'object'
        ? readBearer(req)
        : null;
    const authenticated = this.pairingStore.isAuthenticated(token);
    const runtimeStatus = await this.runtime.getStatus();

    return {
      ok: true,
      bridgeRunning: true,
      startedAt: this.startedAt,
      runtime: runtimeStatus.runtime,
      capabilities: runtimeStatus.capabilities,
      notionMcp: runtimeStatus.notionMcp,
      ...this.pairingStore.getPublicSnapshot(authenticated),
      pendingJobs: this.jobStore.pendingCount(),
    };
  }

  async createPairCode() {
    await this.runtime.startPairing();
    return this.pairingStore.createPairCode();
  }

  confirmPairCode(body) {
    const { code, clientLabel } = parsePairConfirm(body);
    const result = this.pairingStore.confirm(code, clientLabel);

    if (!result.ok) {
      throw createHttpError(result.statusCode, result.error);
    }

    this.log('browser paired', {
      clientLabel: result.clientLabel,
      runtime: this.runtime.id,
    });

    return result;
  }

  async createJob(token, body) {
    this.assertToken(token);
    this.jobStore.prune();
    const payload = parseJobRequest(body);
    const job = this.jobStore.create(payload);

    this.log('job created', {
      jobId: job.id,
      action: job.action,
      runtime: this.runtime.id,
      pageTitle: job.pageTitle,
      selectionChars: job.selectionText.length,
      writeChars: job.replyTextToWrite.length,
    });

    try {
      await this.runtime.dispatchJob(job);
    } catch (error) {
      const message = error?.message || 'Failed to dispatch job';
      this.runtimeContext.failJob(job.id, message, {
        type: 'dispatch_failed',
        runtimeMeta: { dispatchError: message },
      });
    }

    return {
      ok: true,
      jobId: job.id,
      status: this.jobStore.get(job.id)?.status || job.status,
    };
  }

  readJob(token, jobId) {
    this.assertToken(token);
    const job = this.jobStore.get(jobId);

    if (!job) {
      throw createHttpError(404, 'Unknown job id');
    }

    return {
      ok: true,
      job: this.jobStore.toPublic(job),
    };
  }

  async resolveJobApproval(token, jobId, body) {
    this.assertToken(token);
    const job = this.jobStore.get(jobId);

    if (!job) {
      throw createHttpError(404, 'Unknown job id');
    }

    if (job.status !== JOB_STATUS_WAITING_FOR_APPROVAL) {
      throw createHttpError(409, 'This job is not waiting for approval');
    }

    if (typeof this.runtime.respondToApproval !== 'function') {
      throw createHttpError(501, 'Current runtime does not support approval callbacks');
    }

    const resolution = parseApprovalResolution(body);
    await this.runtime.respondToApproval(jobId, resolution);

    return {
      ok: true,
      job: this.jobStore.toPublic(this.jobStore.get(jobId)),
    };
  }

  assertToken(token) {
    if (!token) {
      throw createHttpError(401, 'Missing bearer token');
    }

    if (!this.pairingStore.isAuthenticated(token)) {
      throw createHttpError(403, 'Bridge is not paired with this browser client');
    }
  }

  createRuntimeContext() {
    return {
      log: this.log,
      getJob: (jobId) => this.jobStore.get(jobId),
      markJobDispatched: (jobId, meta = {}) => this.recordJobEvent(jobId, {
        type: meta.type || 'dispatched',
        status: JOB_STATUS_DISPATCHED,
        note: meta.note || null,
        extra: meta.extra || null,
        runtimeMeta: meta.runtimeMeta || null,
      }),
      markJobRunning: (jobId, meta = {}) => this.recordJobEvent(jobId, {
        type: meta.type || 'running',
        status: JOB_STATUS_RUNNING,
        note: meta.note || null,
        extra: meta.extra || null,
        runtimeMeta: meta.runtimeMeta || null,
      }),
      markJobWaitingForApproval: (jobId, meta = {}) => this.recordJobEvent(jobId, {
        type: meta.type || 'waiting_for_approval',
        status: JOB_STATUS_WAITING_FOR_APPROVAL,
        note: meta.note || null,
        extra: meta.extra || null,
        runtimeMeta: meta.runtimeMeta || null,
      }),
      completeJob: (jobId, replyText, meta = {}) => this.recordJobEvent(jobId, {
        type: meta.type || 'completed',
        status: JOB_STATUS_COMPLETED,
        replyText,
        error: null,
        note: meta.note || null,
        extra: meta.extra || null,
        runtimeMeta: meta.runtimeMeta || null,
      }),
      failJob: (jobId, errorText, meta = {}) => this.recordJobEvent(jobId, {
        type: meta.type || 'failed',
        status: JOB_STATUS_FAILED,
        error: errorText,
        note: meta.note || null,
        extra: meta.extra || null,
        runtimeMeta: meta.runtimeMeta || null,
      }),
    };
  }

  recordJobEvent(jobId, event) {
    const job = this.jobStore.applyEvent(jobId, event);
    if (!job) {
      throw createHttpError(404, `Unknown job id: ${jobId}`);
    }

    return job;
  }
}

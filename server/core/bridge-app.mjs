import {
  ACTION_FORWARD_FULL_PAGE,
  JOB_STATUS_CANCELLED,
  JOB_STATUS_CANCELLING,
  JOB_STATUS_COMPLETED,
  JOB_STATUS_DISPATCHED,
  JOB_STATUS_FAILED,
  JOB_STATUS_RUNNING,
  JOB_STATUS_WAITING_FOR_APPROVAL,
  TERMINAL_JOB_STATUSES,
  createHttpError,
  readBearer,
} from './constants.mjs';
import { JobStore } from './job-store.mjs';
import { PairingStore } from './pairing-store.mjs';
import { ArtifactStore } from './artifact-store.mjs';
import { createInputBundle } from './input-bundle.mjs';
import { RuntimeBackedNotionPageBundleProvider } from './page-bundle-provider.mjs';
import { summarizePageBundle } from './mcp-page-bundle.mjs';
import { PromptProfileStore } from './prompt-profiles.mjs';
import { parseApprovalResolution, parseJobRequest, parsePairConfirm, parsePromptProfileMutation } from './schemas.mjs';

export class BridgeApp {
  constructor({ runtime, log, promptProfileStore = new PromptProfileStore(), artifactStore = null }) {
    this.runtime = runtime;
    this.log = log;
    this.startedAt = new Date().toISOString();
    this.jobStore = new JobStore();
    this.pairingStore = new PairingStore();
    this.artifactStore = artifactStore || new ArtifactStore({ log });
    this.promptProfileStore = promptProfileStore;
    this.pageBundleProvider = new RuntimeBackedNotionPageBundleProvider({ runtime, log });
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
      session: runtimeStatus.session || null,
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
    const promptProfile = await this.promptProfileStore.resolve(payload.promptProfileId);
    if (!promptProfile) {
      throw createHttpError(400, `Unknown promptProfileId: ${payload.promptProfileId}`);
    }
    payload.promptProfile = promptProfile;
    const job = this.jobStore.create(payload);

    this.log('job created', {
      jobId: job.id,
      action: job.action,
      runtime: this.runtime.id,
      pageTitle: job.pageTitle,
      promptProfileId: job.promptProfileId,
      selectionChars: job.selectionText.length,
      writeChars: job.replyTextToWrite.length,
    });

    this.processJob(job.id).catch((error) => {
      const snapshot = this.jobStore.get(job.id);
      if (!snapshot || TERMINAL_JOB_STATUSES.has(snapshot.status) || snapshot.status === JOB_STATUS_CANCELLING) {
        return;
      }

      const message = error?.message || 'Failed to dispatch job';
      this.runtimeContext.failJob(job.id, message, {
        type: 'dispatch_failed',
        runtimeMeta: { dispatchError: message },
      });
    });

    return {
      ok: true,
      jobId: job.id,
      status: this.jobStore.get(job.id)?.status || job.status,
    };
  }

  async listPromptProfiles(token) {
    this.assertToken(token);
    return {
      ok: true,
      profiles: await this.promptProfileStore.list(),
    };
  }

  async createPromptProfile(token, body) {
    this.assertToken(token);
    return {
      ok: true,
      profile: await this.promptProfileStore.create(parsePromptProfileMutation(body)),
      profiles: await this.promptProfileStore.list(),
    };
  }

  async updatePromptProfile(token, profileId, body) {
    this.assertToken(token);
    return {
      ok: true,
      profile: await this.promptProfileStore.update(profileId, parsePromptProfileMutation(body)),
      profiles: await this.promptProfileStore.list(),
    };
  }

  async deletePromptProfile(token, profileId) {
    this.assertToken(token);
    const result = await this.promptProfileStore.delete(profileId);
    return {
      ok: true,
      ...result,
      profiles: await this.promptProfileStore.list(),
    };
  }

  async resetPromptProfile(token, profileId) {
    this.assertToken(token);
    return {
      ok: true,
      profile: await this.promptProfileStore.reset(profileId),
      profiles: await this.promptProfileStore.list(),
    };
  }

  async openCodexApp(token) {
    this.assertToken(token);
    if (typeof this.runtime.openCodexApp !== 'function') {
      throw createHttpError(501, 'Current runtime does not support opening Codex App');
    }

    return await this.runtime.openCodexApp();
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

  async cancelJob(token, jobId) {
    this.assertToken(token);
    const job = this.jobStore.get(jobId);

    if (!job) {
      throw createHttpError(404, 'Unknown job id');
    }

    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      return {
        ok: true,
        job: this.jobStore.toPublic(job),
      };
    }

    this.recordJobEvent(jobId, {
      type: 'cancel_requested',
      status: JOB_STATUS_CANCELLING,
      note: '用户请求停止任务。',
      runtimeMeta: {
        cancelRequested: true,
        pendingApproval: null,
      },
    });

    let result = {
      ok: true,
      mode: 'soft',
      message: '已停止等待这次结果；底层 Agent 可能仍在运行。',
    };

    if (typeof this.runtime.cancelJob === 'function') {
      try {
        result = await this.runtime.cancelJob(jobId, {
          reason: 'user_requested',
        }) || result;
      } catch (error) {
        result = {
          ok: false,
          mode: 'soft',
          message: error?.message || '停止请求未被当前 runtime 确认，已停止等待这次结果。',
        };
      }
    }

    const cancelMode = normalizeCancelMode(result.mode);
    this.recordJobEvent(jobId, {
      type: 'cancelled',
      status: JOB_STATUS_CANCELLED,
      note: cancelMode === 'soft'
        ? '已停止等待这次结果；底层 Agent 可能仍在运行。'
        : '任务已停止。',
      error: null,
      runtimeMeta: {
        cancelRequested: false,
        cancelMode,
        cancelMessage: result.message || '',
        pendingApproval: null,
      },
    });

    return {
      ok: true,
      job: this.jobStore.toPublic(this.jobStore.get(jobId)),
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
    const snapshot = this.jobStore.get(jobId);
    if (!snapshot) {
      throw createHttpError(404, `Unknown job id: ${jobId}`);
    }

    if (shouldIgnoreJobEvent(snapshot, event)) {
      const ignored = this.jobStore.applyEvent(jobId, {
        type: `ignored_${event.type || 'event'}`,
        note: `Ignored ${event.status || 'event'} after ${snapshot.status}.`,
        extra: {
          attemptedStatus: event.status || null,
        },
      });
      return ignored || snapshot;
    }

    const job = this.jobStore.applyEvent(jobId, event);
    if (!job) {
      throw createHttpError(404, `Unknown job id: ${jobId}`);
    }

    return job;
  }

  async processJob(jobId) {
    const job = this.jobStore.get(jobId);
    if (!job) {
      throw createHttpError(404, `Unknown job id: ${jobId}`);
    }

    let pageBundle = null;
    let pageBundleWarnings = [];
    if (job.action === ACTION_FORWARD_FULL_PAGE) {
      if (this.shouldStopProcessing(job.id)) {
        return;
      }

      const pageBundleResult = await this.pageBundleProvider.fetchPageBundle(job);
      if (this.shouldStopProcessing(job.id)) {
        return;
      }

      pageBundle = pageBundleResult.bundle;
      pageBundleWarnings = Array.isArray(pageBundleResult.warnings) ? pageBundleResult.warnings : [];
      if (!pageBundle) {
        const message = pageBundleWarnings[0] || 'bridge 无法为当前整页请求准备 page bundle。';
        throw new Error(message);
      }

      this.log('page bundle prepared', {
        jobId: job.id,
        action: job.action,
        summary: summarizePageBundle(pageBundle),
        warnings: pageBundleWarnings,
      });

      this.recordJobEvent(job.id, {
        type: 'page_bundle_prepared',
        note: 'bridge 已通过 runtime-backed MCP 预取当前页面内容。',
        extra: {
          warnings: pageBundleWarnings,
          summary: summarizePageBundle(pageBundle),
        },
        runtimeMeta: {
          pageBundle: summarizePageBundle(pageBundle),
        },
      });
    }

    if (this.shouldStopProcessing(job.id)) {
      return;
    }

    const inputBundle = await createInputBundle(job, {
      artifactStore: this.artifactStore,
      pageBundle,
      log: this.log,
    });
    if (this.shouldStopProcessing(job.id)) {
      return;
    }

    if (pageBundleWarnings.length) {
      inputBundle.warnings = [...pageBundleWarnings, ...inputBundle.warnings];
    }
    this.log('input bundle prepared', {
      jobId: job.id,
      artifactSource: inputBundle.artifactSource,
      pageBundle: summarizePageBundle(pageBundle),
      imageCount: inputBundle.images.length,
      warnings: inputBundle.warnings,
      images: inputBundle.images.map((image) => ({
        sourceUrl: image.sourceUrl,
        mimeType: image.mimeType,
        cachePath: image.cachePath,
        width: image.width,
        height: image.height,
      })),
    });
    this.recordJobEvent(job.id, {
      type: 'input_bundle_prepared',
      note: inputBundle.images.length
        ? `已准备 ${inputBundle.images.length} 个本地图片工件。`
        : null,
      extra: inputBundle.warnings.length ? { warnings: inputBundle.warnings } : null,
      inputBundle,
      runtimeMeta: {
        inputBundle: {
          artifactSource: inputBundle.artifactSource,
          imageCount: inputBundle.images.length,
          warnings: inputBundle.warnings,
          pageBundle: summarizePageBundle(pageBundle),
        },
      },
    });
    if (this.shouldStopProcessing(job.id)) {
      return;
    }

    await this.runtime.dispatchJob(job);
  }

  shouldStopProcessing(jobId) {
    const job = this.jobStore.get(jobId);
    return !job || TERMINAL_JOB_STATUSES.has(job.status) || job.status === JOB_STATUS_CANCELLING;
  }
}

function shouldIgnoreJobEvent(job, event) {
  if (!event || !Object.hasOwn(event, 'status')) {
    return false;
  }

  if (TERMINAL_JOB_STATUSES.has(job.status) && event.status !== job.status) {
    return true;
  }

  if (job.status === JOB_STATUS_CANCELLING && ![JOB_STATUS_CANCELLING, JOB_STATUS_CANCELLED].includes(event.status)) {
    return true;
  }

  return false;
}

function normalizeCancelMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  return ['hard', 'queued', 'soft', 'unsupported'].includes(value) ? value : 'soft';
}

import { randomUUID } from 'node:crypto';
import {
  JOB_RETENTION_MS,
  JOB_STATUS_QUEUED,
  TERMINAL_JOB_STATUSES,
  nowIso,
  truncate,
} from './constants.mjs';
import { summarizePageBundle } from './mcp-page-bundle.mjs';

export class JobStore {
  constructor() {
    this.jobs = new Map();
  }

  create(payload) {
    const id = randomUUID();
    const createdAt = nowIso();
    const job = {
      id,
      ...payload,
      inputBundle: null,
      status: JOB_STATUS_QUEUED,
      createdAt,
      updatedAt: createdAt,
      replyText: '',
      error: null,
      runtimeMeta: {},
      history: [
        {
          at: createdAt,
          type: 'created',
          status: JOB_STATUS_QUEUED,
        },
      ],
    };

    this.jobs.set(id, job);
    return job;
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  update(jobId, updater) {
    const job = this.get(jobId);
    if (!job) {
      return null;
    }

    updater(job);
    return job;
  }

  applyEvent(jobId, event) {
    return this.update(jobId, (job) => {
      const at = nowIso();

      if (Object.hasOwn(event, 'status')) {
        job.status = event.status;
      }

      if (Object.hasOwn(event, 'replyText')) {
        job.replyText = event.replyText;
      }

      if (Object.hasOwn(event, 'error')) {
        job.error = event.error;
      }

      if (event.runtimeMeta && typeof event.runtimeMeta === 'object') {
        job.runtimeMeta = {
          ...job.runtimeMeta,
          ...event.runtimeMeta,
        };
      }

      if (Object.hasOwn(event, 'inputBundle')) {
        job.inputBundle = event.inputBundle;
      }

      job.updatedAt = at;
      job.history.push({
        at,
        type: event.type,
        status: job.status,
        note: event.note || null,
        extra: event.extra || null,
      });
    });
  }

  prune() {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [jobId, job] of this.jobs.entries()) {
      if (new Date(job.createdAt).getTime() < cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }

  pendingCount() {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (!TERMINAL_JOB_STATUSES.has(job.status)) {
        count += 1;
      }
    }
    return count;
  }

  toPublic(job) {
    return {
      id: job.id,
      action: job.action,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      pageUrl: job.pageUrl,
      pageTitle: job.pageTitle,
      replyText: job.replyText,
      error: job.error,
      selectionPreview: truncate(job.selectionText, 320),
      attachedImageCount: Array.isArray(job.inputBundle?.images) ? job.inputBundle.images.length : 0,
      pageBundle: summarizePageBundle(job.inputBundle?.pageBundle || null),
      artifactSource: job.inputBundle?.artifactSource || '',
      writeMode: job.writeMode,
      runtimeMeta: job.runtimeMeta,
      history: job.history,
    };
  }
}

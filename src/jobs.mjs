// jobs.mjs — asynchronous long-running UV4 invocations with polling + notification.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class JobManager {
  constructor({ maxConcurrent = 2, notify = null, onFinish = null } = {}) {
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.maxConcurrent = maxConcurrent;
    this.notify = notify;        // (job) => void, called on completion
    this.onFinish = onFinish;    // optional persistence hook
  }

  submit({ kind, project, target, command, run }) {
    const id = randomUUID();
    const job = {
      id, kind, project, target, command,
      state: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null, finishedAt: null,
      result: null, error: null,
      _run: run,
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.pump();
    return this.view(job);
  }

  pump() {
    while (this.running < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.running++;
      job.state = 'running';
      job.startedAt = new Date().toISOString();
      Promise.resolve()
        .then(() => job._run())
        .then((res) => { job.result = res; job.state = res && res.ok ? 'succeeded' : 'failed'; })
        .catch((e) => { job.error = String((e && e.message) || e); job.state = 'failed'; })
        .finally(() => {
          job.finishedAt = new Date().toISOString();
          job.durationMs = new Date(job.finishedAt) - new Date(job.startedAt);
          this.running--;
          if (this.notify) { try { this.notify(this.view(job)); } catch {} }
          if (this.onFinish) { try { this.onFinish(job); } catch {} }
          this.pump();
        });
    }
  }

  get(id) { return this.jobs.get(id) || null; }

  list() {
    return [...this.jobs.values()].map(j => ({
      id: j.id, kind: j.kind, state: j.state, project: j.project, target: j.target,
      command: j.command, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
      durationMs: j.durationMs || null,
    }));
  }

  view(job) {
    if (!job) return null;
    const out = {
      id: job.id, kind: job.kind, state: job.state, command: job.command,
      project: job.project, target: job.target,
      createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
      durationMs: job.durationMs || null,
    };
    if (job.state === 'succeeded' || job.state === 'failed') {
      out.result = job.result;
      if (job.error) out.error = job.error;
    }
    return out;
  }

  async wait(id, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const j = this.jobs.get(id);
      if (!j) return null;
      if (j.state === 'succeeded' || j.state === 'failed') return this.view(j);
      if (Date.now() > deadline) return { ...this.view(j), waitingTimedOut: true };
      await new Promise(r => setTimeout(r, 250));
    }
  }

  prune(maxAgeMs = 24 * 3600 * 1000) {
    const now = Date.now();
    for (const [id, j] of this.jobs) {
      if (j.finishedAt && now - new Date(j.finishedAt).getTime() > maxAgeMs) this.jobs.delete(id);
    }
  }

  /** Persist completed job results under dir/<id>.json for later inspection. */
  persist(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    this.onFinish = (job) => {
      try { fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(this.view(job), null, 2)); } catch {}
    };
  }
}

import { randomUUID } from 'node:crypto';
import { validateJob, hashJobRequest } from './validate.mjs';
import { runJob } from './runner.mjs';

/** Single-supervisor durable jobs. A restart reconciles interrupted execution, never repeats code.
 * HTTP retries inspect the same idempotency identity and inputs; late writers cannot publish after cancellation. */
export function createJobManager({ store, run = runJob, baseDir, stop, occupied = () => false, clock = Date.now }) {
  let active = null;
  let unsettled = false;
  let chain = Promise.resolve();
  const serial = work => { const next = chain.then(work); chain = next.catch(() => {}); return next; };
  const save = record => store.set(record.id, { requestHash: record.requestHash, job: record });
  const publicRecord = record => ({ ...record, request: undefined });
  async function execute(record, job) {
    const controller = new AbortController();
    active = { id: record.id, generation: record.generation, controller };
    record.status = 'running'; record.updatedAt = clock();
    try {
      await save(record);
      const result = await run(job, { baseDir, signal: controller.signal, container: record.container });
      // Stop/cancellation is confirmed by the runner before resolving. A changed generation cannot publish.
      await serial(async () => {
        const current = (await store.get(record.id))?.job;
        if (!current || current.generation !== record.generation) return;
        const cancelled = controller.signal.aborted || current.status === 'cancel_requested';
        const final = { ...current, status: cancelled ? 'cancelled' : result.status, updatedAt: clock(), stopConfirmed: true,
          result: cancelled ? null : result, manifest: cancelled || result.status !== 'completed' ? null
            : { requestHash: record.requestHash, generation: record.generation, files: result.files.map(file => ({ name: file.name, size: file.size, sha256: file.sha256 })) } };
        await save(final);
      });
    } catch {
      unsettled = true;
      await serial(async () => {
        const current = (await store.get(record.id))?.job;
        if (current?.generation === record.generation) await save({ ...current, status: 'outcome_unknown', updatedAt: clock(), result: null, stopConfirmed: false,
          error: 'Execution or stop could not be confirmed. Inspect the supervisor; do not resubmit automatically.' });
      });
    } finally { if (active?.generation === record.generation) active = null; }
  }
  return {
    busy: () => Boolean(active) || unsettled,
    async init() {
      for (const saved of await store.list()) {
        const record = saved.job;
        if (!record || !( ['queued', 'running', 'cancel_requested'].includes(record.status) || record.status === 'outcome_unknown' && record.stopConfirmed !== true)) continue;
        // Remove the stable container identity before reporting stop. Fail closed if Docker is unavailable.
        let stopped = false;
        try { await stop(record.container); stopped = true; } catch { /* unknown */ }
        if (!stopped) unsettled = true;
        await save({ ...record, status: stopped ? 'interrupted' : 'outcome_unknown', updatedAt: clock(), result: null, stopConfirmed: stopped,
          error: 'Supervisor restarted. The same job is retained and will not be replayed.' });
      }
    },
    admit(body) {
      return serial(async () => {
        const job = validateJob(body), hash = hashJobRequest(job);
        const existing = await store.get(job.idempotencyKey);
        if (existing) {
          if (existing.requestHash !== hash || !existing.job) throw Object.assign(new Error('Idempotency conflict.'), { statusCode: 409 });
          return { ...publicRecord(existing.job), reused: true };
        }
        if (active || unsettled || occupied()) throw Object.assign(new Error('Executor busy.'), { statusCode: 409 });
        const record = { id: job.idempotencyKey, requestHash: hash, generation: randomUUID(), attempt: 1, status: 'queued',
          container: `cowork-build-${randomUUID()}`, acceptedAt: clock(), updatedAt: clock(), result: null, manifest: null };
        await save(record);
        // Start only after durable admission; execute sets active synchronously before its first await.
        void execute(record, job).catch(() => {});
        return publicRecord({ ...record, status: 'queued' });
      });
    },
    async inspect(id) { const record = (await store.get(id))?.job; return record ? publicRecord(record) : null; },
    cancel(id) {
      return serial(async () => {
        const record = (await store.get(id))?.job;
        if (!record) return null;
        if (!['queued', 'running', 'cancel_requested'].includes(record.status)) return publicRecord(record);
        if (active?.id !== id || active.generation !== record.generation) return publicRecord(record);
        record.status = 'cancel_requested'; record.updatedAt = clock();
        await save(record); active.controller.abort();
        return publicRecord(record);
      });
    },
  };
}

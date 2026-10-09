import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createResultStore } from '../lib/store.mjs';
import { createJobManager } from '../lib/jobs.mjs';

test('durable admission deduplicates retries; cancellation rejects late output and restart never replays', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cw-jobs-'));
  try {
    const store = createResultStore({ dir }); await store.init();
    let finish; let calls = 0;
    const manager = createJobManager({ store, stop: async () => {}, run: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
    await manager.init();
    const body = { idempotencyKey: 'job-cancel-1', language: 'node', code: 'console.log(1)' };
    const accepted = await manager.admit(body);
    assert.equal(accepted.status, 'queued');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal((await manager.admit(body)).reused, true); assert.equal(calls, 1);
    await assert.rejects(manager.admit({ ...body, code: 'different' }), /conflict/);
    assert.equal((await manager.cancel(body.idempotencyKey)).status, 'cancel_requested');
    finish({ status: 'completed', files: [{ name: 'late.csv', size: 1 }], durationMs: 1 });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await manager.inspect(body.idempotencyKey)).status, 'cancelled');
    assert.equal((await manager.inspect(body.idempotencyKey)).result, null);
    await store.set('job-restart-1', { requestHash: 'h', job: { id: 'job-restart-1', generation: 'old', status: 'running', container: 'cowork-old', requestHash: 'h' } });
    const stopped = [];
    const restarted = createJobManager({ store, stop: async id => stopped.push(id), run: async () => assert.fail('no restart replay') });
    await restarted.init();
    assert.deepEqual(stopped, ['cowork-old']); assert.equal((await restarted.inspect('job-restart-1')).status, 'interrupted');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

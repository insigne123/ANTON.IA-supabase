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

test('a stop that cannot be confirmed blocks new compute, including after another restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cw-stop-'));
  try {
    const store = createResultStore({ dir }); await store.init();
    await store.set('job-uncertain-1', { requestHash: 'h', job: { id: 'job-uncertain-1', generation: 'old', status: 'running', container: 'cowork-old', requestHash: 'h' } });
    const manager = createJobManager({ store, stop: async () => { throw new Error('Docker unavailable'); }, run: async () => assert.fail('unknown writers cannot overlap') });
    await manager.init(); assert.equal(manager.busy(), true);
    await assert.rejects(manager.admit({ idempotencyKey: 'job-other-123', language: 'node', code: 'x' }), /busy/);
    const restarted = createJobManager({ store, stop: async () => {}, run: async () => {} });
    await restarted.init(); assert.equal(restarted.busy(), false);
    assert.equal((await restarted.inspect('job-uncertain-1')).status, 'interrupted');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('restart removes the recorded inputs only after confirmed stop and never exposes the host path', { timeout: 10000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cw-restart-inputs-'));
  try {
    const store = createResultStore({ dir }); await store.init();
    const workspace = '/jobs/job-123-456-AbCdEf';
    let staged;
    const recorded = new Promise(resolve => { staged = resolve; });
    const manager = createJobManager({ store, stop: async () => {}, run: async (_job, deps) => {
      await deps.onWorkspace(workspace);
      staged();
      return new Promise(() => {}); // Simulate supervisor loss after input staging.
    } });
    await manager.init();
    const body = { idempotencyKey: 'job-input-restart-1', language: 'node', code: 'x' };
    await manager.admit(body);
    await recorded;
    assert.equal((await store.get(body.idempotencyKey)).job.workingDirectory, workspace);
    assert.equal((await manager.inspect(body.idempotencyKey)).workingDirectory, undefined);
    const order = [];
    const failedStop = createJobManager({ store, stop: async () => { throw Error('Cannot confirm stop'); }, cleanup: async () => assert.fail('do not remove live inputs') });
    await failedStop.init(); assert.equal(failedStop.busy(), true);
    const restarted = createJobManager({ store, stop: async () => order.push('stop'), cleanup: async directory => {
      assert.equal(directory, workspace); order.push('cleanup');
    }, run: async () => assert.fail('never replay') });
    await restarted.init();
    assert.deepEqual(order, ['stop', 'cleanup']);
    assert.equal((await restarted.inspect(body.idempotencyKey)).status, 'interrupted');
    assert.equal((await restarted.inspect(body.idempotencyKey)).workingDirectory, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

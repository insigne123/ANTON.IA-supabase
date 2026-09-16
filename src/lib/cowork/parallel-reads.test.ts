import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCoworkParallelReads } from './parallel-reads';

const tasks = ['uno','dos','tres'].map(input => ({ action: 'leads.search' as const, input }));
test('fan-out is bounded, records real results and preserves input order', async () => {
  let active = 0, peak = 0;
  const recorded: string[] = [];
  const results = await executeCoworkParallelReads(tasks, {
    signal: new AbortController().signal, authorize: async () => {},
    execute: async task => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, task.input === 'uno' ? 15 : 1)); active--; return task.input; },
    record: async (_task, result) => { recorded.push(result); },
  });
  assert.equal(peak, 2); assert.equal(active, 0);
  assert.deepEqual(results, ['uno','dos','tres']); assert.equal(recorded.length, 3);
});
test('revocation prevents new tasks and no active reader survives return', async () => {
  let calls = 0, active = 0, authorized = true;
  await assert.rejects(executeCoworkParallelReads(tasks, {
    signal: new AbortController().signal,
    authorize: async () => { if (!authorized) throw new Error('revoked'); },
    execute: async () => { calls++; active++; await new Promise(resolve => setTimeout(resolve, 2)); active--; authorized = false; return 'data'; },
    record: async () => { throw new Error('Must not publish after revocation'); },
  }), /revoked/);
  assert.ok(calls <= 2); assert.equal(active, 0);
});
test('parallel pool rejects duplicates and unknown capabilities', async () => {
  const deps = { signal: new AbortController().signal, authorize: async () => {}, execute: async () => null, record: async () => {} };
  await assert.rejects(executeCoworkParallelReads([tasks[0], tasks[0]], deps), /Duplicate/);
  await assert.rejects(executeCoworkParallelReads([{ action: 'email.send' as never, input: 'x' }], deps));
});

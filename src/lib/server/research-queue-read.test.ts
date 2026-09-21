import test from 'node:test';
import assert from 'node:assert/strict';
import { readResearchQueue } from './research-queue-read';

test('transient gateway failure retries discovery and returns recovered data', async () => {
  let calls = 0;
  const result = await readResearchQueue('ready', async () => ++calls === 1
    ? { data: null, error: { message: 'Gateway Timeout' } }
    : { data: ['job'], error: null }, async () => {});
  assert.deepEqual(result.data, ['job']);
  assert.equal(calls, 2);
});
test('persistent outage is bounded and retains discovery stage', async () => {
  let calls = 0;
  await assert.rejects(readResearchQueue('synthesis', async () => {
    calls++; throw new Error('fetch failed');
  }, async () => {}), /synthesis.*fetch failed/);
  assert.equal(calls, 3);
});
test('schema and permissions errors are not retried or hidden', async () => {
  let calls = 0;
  await assert.rejects(readResearchQueue('ready', async () => {
    calls++; return { data: null, error: { message: 'permission denied' } };
  }, async () => {}), /ready.*permission denied/);
  assert.equal(calls, 1);
});

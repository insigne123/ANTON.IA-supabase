import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseIdleContactThreads } from '@/lib/server/contact-thread-release';

test('the job releases idle contacts in batches of 200 and reports how many', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const result = await releaseIdleContactThreads({ rpc: async (fn, args) => { calls.push([fn, args]); return { data: 3, error: null }; } });
  assert.deepEqual(calls, [['release_idle_organization_contact_threads_v1', { p_limit: 200 }]]);
  assert.deepEqual(result, { released: 3 });
});

test('a failed release never stops the reconciliation: it is reported', async () => {
  const original = console.error; console.error = () => {};
  try {
    const result = await releaseIdleContactThreads({ rpc: async () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }) });
    assert.deepEqual(result, { released: null, error: 'release_failed' });
  } finally { console.error = original; }
});

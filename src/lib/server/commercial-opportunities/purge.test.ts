import assert from 'node:assert/strict';
import test from 'node:test';

import { PURGE_PER_TICK, purgeClosedExcluded } from './purge';

const client = (answer: any) => {
  const calls: any[] = [];
  return { calls, client: { rpc: async (name: string, args: any) => { calls.push([name, args]); if (answer instanceof Error) throw answer; return answer; } } as any };
};

test('the purge asks the database for at most one tick of rows and says how many went', async () => {
  const done = client({ data: 37, error: null });
  assert.equal(await purgeClosedExcluded(done.client), 37);
  assert.deepEqual(done.calls, [['opportunity_purge_closed_excluded', { p_limit: PURGE_PER_TICK }]]);
});

test('before the migration, or when the call fails, the purge says nothing and never throws', async () => {
  assert.equal(await purgeClosedExcluded(client({ data: null, error: { code: 'PGRST202' } }).client), null);
  assert.equal(await purgeClosedExcluded(client(new Error('network')).client), null);
});

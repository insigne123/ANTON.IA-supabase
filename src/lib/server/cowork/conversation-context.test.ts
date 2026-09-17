import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCoworkHistory } from './conversation-context';

function fixture(rows: Record<string, { parent: string | null; owner?: string }>) {
  const filters: Array<Record<string, string>> = [];
  const client = { from(table: string) {
    const where: Record<string, string> = {};
    filters.push(where);
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: string) => { where[key] = value; return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [{ payload: { action: 'prospecting.search', result: { items: [{ id: 'apollo:1' }] } } }], error: null })),
      maybeSingle: async () => {
        const id = where.id || where.run_id;
        const row = rows[id];
        if (!row || (row.owner && row.owner !== where.user_id)) return { data: null, error: null };
        return { data: table === 'cowork_runs'
          ? { id, message: `request-${id}`, status: 'completed', parent_run_id: row.parent }
          : { payload: { reply: `reply-${id}`, document: null } }, error: null };
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  return { client, filters };
}

test('history preserves chronological turns and scopes every query', async () => {
  const f = fixture({ a: { parent: null }, b: { parent: 'a' } });
  const history = await loadCoworkHistory(f.client, { userId: 'owner', organizationId: 'org' }, 'b');
  assert.deepEqual(history.turns.map(turn => turn.request), ['request-a', 'request-b']);
  assert.equal(history.olderTurnsOmitted, false);
  assert.equal(history.turns[0].observations.length, 1);
  assert.ok(f.filters.every(filter => filter.user_id === 'owner' && filter.organization_id === 'org'));
});

test('history surfaces the most recent tool results first in chronological order', async () => {
  const orders: Array<{ column: string; ascending: boolean }> = [];
  const payloads = [{ payload: { action: 'x', n: 1 } }, { payload: { action: 'x', n: 2 } }, { payload: { action: 'x', n: 3 } }];
  const client = { from(table: string) {
    const where: Record<string, string> = {};
    const chain = {
      select: () => chain,
      order: (column: string, options?: { ascending: boolean }) => { orders.push({ column, ascending: options?.ascending !== false }); return chain; },
      limit: () => chain,
      eq: (key: string, value: string) => { where[key] = value; return chain; },
      maybeSingle: async () => ({ data: table === 'cowork_runs'
        ? { id: 'a', message: 'request-a', status: 'completed', parent_run_id: null }
        : { payload: { reply: 'reply-a', document: null } }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [...payloads].reverse(), error: null })),
    };
    return chain;
  } } as unknown as SupabaseClient;
  const history = await loadCoworkHistory(client, { userId: 'owner', organizationId: 'org' }, 'a');
  const toolOrder = orders.find(order => order.column === 'sequence');
  assert.equal(toolOrder?.ascending, false);
  assert.deepEqual(history.turns[0].observations.map((item: unknown) => (item as { n: number }).n), [1, 2, 3]);
});

test('foreign parent and cyclic ancestry fail closed', async () => {
  const foreign = fixture({ a: { parent: null, owner: 'other' } });
  await assert.rejects(loadCoworkHistory(foreign.client, { userId: 'owner', organizationId: 'org' }, 'a'), /unavailable/);
  const cycle = fixture({ a: { parent: 'a' } });
  await assert.rejects(loadCoworkHistory(cycle.client, { userId: 'owner', organizationId: 'org' }, 'a'), /ancestry/);
});

test('new work has no implicit previous context', async () => {
  const f = fixture({});
  assert.deepEqual(await loadCoworkHistory(f.client, { userId: 'owner', organizationId: 'org' }, null), { turns: [], olderTurnsOmitted: false });
  assert.equal(f.filters.length, 0);
});

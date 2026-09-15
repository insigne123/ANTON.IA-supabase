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
  assert.ok(f.filters.every(filter => filter.user_id === 'owner' && filter.organization_id === 'org'));
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

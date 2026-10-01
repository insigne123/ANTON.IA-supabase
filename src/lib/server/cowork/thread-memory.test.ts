import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadCoworkThreadMemory, saveCoworkThreadMemory } from './thread-memory';

const scope = { userId: 'u1', organizationId: 'o1' };
const memory = { offer: 'Revisión de antecedentes', audience: null, people: [], decisions: [], pending: [] };

/** A stand-in for the query builder over two tables, recording every filter and write. */
function fakeClient(rows: { runs?: Record<string, { message: string; user_id: string; organization_id: string }>; memory?: Record<string, unknown> | null }) {
  const writes: Array<Record<string, unknown>> = [];
  const filters: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      const where: Record<string, unknown> = {};
      filters.push(where);
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { where[column] = value; return builder; },
        maybeSingle: async () => {
          if (table === 'cowork_runs') {
            const run = rows.runs?.[String(where.id)];
            return { data: run && run.user_id === where.user_id && run.organization_id === where.organization_id ? { message: run.message } : null, error: null };
          }
          const stored = rows.memory;
          return { data: stored && stored.user_id === where.user_id && stored.organization_id === where.organization_id ? stored : null, error: null };
        },
        upsert: async (values: Record<string, unknown>) => { writes.push(values); rows.memory = values; return { error: null }; },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, writes, filters };
}

test('the next turn reads the first request of its conversation and the memory, scoped to the account', async () => {
  const fake = fakeClient({
    runs: { root: { message: 'Quiero vender revisión de antecedentes', user_id: 'u1', organization_id: 'o1' } },
    memory: { root_run_id: 'root', user_id: 'u1', organization_id: 'o1', memory, source_created_at: '2026-10-01T10:00:00Z' },
  });
  const loaded = await loadCoworkThreadMemory(fake.client, scope, { id: 'turn-14', message: 'Ahora los correos', root_run_id: 'root' });
  assert.deepEqual(loaded, { firstRequest: 'Quiero vender revisión de antecedentes', memory });
  assert.ok(fake.filters.every(where => where.user_id === 'u1' && where.organization_id === 'o1'));
  // The first turn is its own first request; without the root column (migration pending) there is nothing to read.
  assert.equal((await loadCoworkThreadMemory(fake.client, scope, { id: 'root', message: 'Quiero vender', root_run_id: 'root' })).firstRequest, null);
  assert.deepEqual(await loadCoworkThreadMemory(fake.client, scope, { id: 'x', message: 'y' }), { firstRequest: null, memory: null });
});

test('a turn keeps its memory unless a later turn of the conversation already wrote one', async () => {
  const fake = fakeClient({ memory: null });
  assert.equal(await saveCoworkThreadMemory(fake.client, scope, { id: 'turn-2', message: 'm', root_run_id: 'root', created_at: '2026-10-01T10:00:00Z' }, memory), true);
  assert.equal(fake.writes[0].root_run_id, 'root');
  assert.equal(fake.writes[0].source_run_id, 'turn-2');
  assert.equal(await saveCoworkThreadMemory(fake.client, scope, { id: 'turn-1', message: 'm', root_run_id: 'root', created_at: '2026-10-01T09:00:00Z' }, memory), false,
    'an older turn finishing late never replaces a newer memory');
  assert.equal(await saveCoworkThreadMemory(fake.client, scope, { id: 'turn-3', message: 'm', root_run_id: 'root', created_at: '2026-10-01T11:00:00Z' },
    { ...memory, people: 'Rafael' } as never), false, 'a memory that does not read as one is not stored');
  assert.equal(await saveCoworkThreadMemory(fake.client, scope, { id: 'turn-3', message: 'm' }, memory), false, 'no root, nothing to store');
  assert.equal(fake.writes.length, 1);
});

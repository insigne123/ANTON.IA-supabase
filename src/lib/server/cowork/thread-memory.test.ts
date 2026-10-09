import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadCoworkThreadMemory, loadCoworkThreadTitles, saveCoworkThreadMemory } from './thread-memory';

const scope = { userId: 'u1', organizationId: 'o1' };
const memory = { offer: 'Revisión de antecedentes', audience: null, people: [], decisions: [], pending: [] };

/** A stand-in for the query builder over two tables, recording every filter and write. */
function fakeClient(rows: { runs?: Record<string, { message: string; user_id: string; organization_id: string; parent_run_id?: string | null }>; memory?: Record<string, unknown> | null }) {
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
            return { data: run && run.user_id === where.user_id && run.organization_id === where.organization_id ? { message: run.message, parent_run_id: run.parent_run_id ?? null } : null, error: null };
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

test('another version of a turn does not read the memory the version it replaces wrote', async () => {
  const fake = fakeClient({
    runs: { root: { message: 'Quiero vender', user_id: 'u1', organization_id: 'o1' } },
    memory: { root_run_id: 'root', user_id: 'u1', organization_id: 'o1', memory, source_run_id: 'turn-2a', source_created_at: '2026-10-01T10:00:00Z' },
  });
  const turn = { id: 'turn-2b', message: 'Otra versión', root_run_id: 'root' };
  assert.equal((await loadCoworkThreadMemory(fake.client, scope, turn, { runIds: ['root'], complete: true })).memory, null);
  assert.deepEqual((await loadCoworkThreadMemory(fake.client, scope, { ...turn, id: 'turn-3' }, { runIds: ['root', 'turn-2a'], complete: true })).memory, memory);
  // A short history needs proof beyond the prompt window; unknown ancestry cannot import sibling decisions.
  assert.equal((await loadCoworkThreadMemory(fake.client, scope, turn, { runIds: ['turn-9'], complete: false })).memory, null);
  const long = fakeClient({ runs: { root:{message:'Quiero vender',user_id:'u1',organization_id:'o1'},
    'turn-9':{message:'Sigo',user_id:'u1',organization_id:'o1',parent_run_id:'turn-8'},
    'turn-8':{message:'Sigo',user_id:'u1',organization_id:'o1',parent_run_id:'turn-2a'} },
    memory:{root_run_id:'root',user_id:'u1',organization_id:'o1',memory,source_run_id:'turn-2a'} });
  assert.deepEqual((await loadCoworkThreadMemory(long.client,scope,turn,{runIds:['turn-9'],complete:false})).memory,memory);
  assert.ok(long.filters.every(where=>where.user_id==='u1'&&where.organization_id==='o1'));
});

test('the list reads the names Cowork gave the person\'s conversations, scoped to them, and goes on without them', async () => {
  const filters: Array<Record<string, unknown>> = [];
  const rows = [
    { root_run_id: 'root-1', user_id: 'u1', organization_id: 'o1', memory: { ...memory, title: 'Antecedentes para RR. HH.' } },
    { root_run_id: 'root-2', user_id: 'u1', organization_id: 'o1', memory },
    { root_run_id: 'root-3', user_id: 'u2', organization_id: 'o1', memory: { ...memory, title: 'De otra persona' } },
  ];
  const admin = { from: () => {
    const where: Record<string, unknown> = {};
    filters.push(where);
    const chain = {
      select: (fields: string) => { where.select = fields; return chain; },
      eq: (key: string, value: unknown) => { where[key] = value; return chain; },
      in: (key: string, values: unknown[]) => { where[key] = values; return chain; },
      then: (resolve: (value: unknown) => void) => resolve({ data: rows.filter(row => row.user_id === where.user_id && row.organization_id === where.organization_id
        && (where.root_run_id as string[]).includes(row.root_run_id)).map(row => ({ root_run_id: row.root_run_id, title: (row.memory as { title?: string }).title ?? null })), error: null }),
    };
    return chain;
  } } as unknown as SupabaseClient;
  assert.deepEqual(await loadCoworkThreadTitles(admin, scope, ['root-1', 'root-2', 'root-3', 'root-1']), { 'root-1': 'Antecedentes para RR. HH.' });
  assert.deepEqual(filters[0].root_run_id, ['root-1', 'root-2', 'root-3']);
  // Only the name leaves the database, never the rest of the memory.
  assert.equal(filters[0].select, 'root_run_id,title:memory->>title');
  assert.deepEqual(await loadCoworkThreadTitles(admin, scope, []), {});
  const broken = { from: () => { throw new Error('down'); } } as unknown as SupabaseClient;
  assert.deepEqual(await loadCoworkThreadTitles(broken, scope, ['root-1']), {});
});

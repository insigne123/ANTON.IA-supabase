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
      select: () => chain, order: () => chain, limit: () => chain, in: () => chain,
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
      limit: () => chain, in: () => chain,
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

function orderedClient(newestFirst: Array<Record<string, unknown>>, createdAt = '2026-09-25T13:00:00Z') {
  return { from(table: string) {
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain, eq: () => chain, in: () => chain,
      maybeSingle: async () => ({ data: table === 'cowork_runs'
        ? { id: 'a', message: 'request-a', status: 'completed', parent_run_id: null, created_at: createdAt }
        : { payload: { reply: 'reply-a', document: null } }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: newestFirst.map(payload => ({ payload })), error: null })),
    };
    return chain;
  } } as unknown as SupabaseClient;
}

test('history keeps three reads plus the assistant note and dates each turn', async () => {
  const note = { action: 'assistant.note', input: '', result: { reply: 'Propongo buscar su correo.' } };
  const reads = [1, 2, 3].map(n => ({ action: 'leads.search', n }));
  const withNote = await loadCoworkHistory(orderedClient([note, reads[2], reads[1], reads[0]]), { userId: 'owner', organizationId: 'org' }, 'a');
  assert.deepEqual(withNote.turns[0].observations, [reads[0], reads[1], reads[2], note]);
  assert.equal(withNote.turns[0].at, '2026-09-25T13:00:00Z');
  const fourReads = [4, 3, 2, 1].map(n => ({ action: 'leads.search', n }));
  const capped = await loadCoworkHistory(orderedClient(fourReads), { userId: 'owner', organizationId: 'org' }, 'a');
  assert.deepEqual(capped.turns[0].observations.map(item => (item as { n: number }).n), [2, 3, 4]);
  // The plan shown while it worked is not context and takes no read's place.
  const plan = { action: 'assistant.plan', input: '', result: { steps: [{ label: 'Reviso', read: 'leads.search' }, { label: 'Respondo', read: null }] } };
  const planned = await loadCoworkHistory(orderedClient([reads[1], reads[0], plan]), { userId: 'owner', organizationId: 'org' }, 'a');
  assert.deepEqual(planned.turns[0].observations, [reads[0], reads[1]]);
  // Nor are the Writer's and the Reviewer's steps: a turn that wrote keeps its three reads.
  const agent = (label: string) => ({ action: 'assistant.agent', input: '', result: { agent: 'writer', state: 'done', label } });
  const wrote = await loadCoworkHistory(orderedClient([agent('4'), agent('3'), agent('2'), agent('1'), reads[2], reads[1], reads[0], plan]),
    { userId: 'owner', organizationId: 'org' }, 'a');
  assert.deepEqual(wrote.turns[0].observations, [reads[0], reads[1], reads[2]]);
});

test('history tells the model which approved actions already ran and how they ended', async () => {
  const client = { from(table: string) {
    let effects = false;
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain, eq: () => chain,
      in: () => { effects = true; return chain; },
      maybeSingle: async () => ({ data: table === 'cowork_runs'
        ? { id: 'a', message: 'Busca su correo', status: 'completed', parent_run_id: null, created_at: '2026-09-25T04:30:00Z' }
        : { payload: { reply: 'El proveedor no devolvió correo para este contacto.', document: null } }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: effects
        ? [{ kind: 'effect.completed', payload: { kind: 'enrich_contact', label: 'Enriquecer contacto Carlos A. (Minera Centinela)', result: { found: false, email: null } } }]
        : [{ payload: { action: 'leads.search', result: { items: [] } } }], error: null })),
    };
    return chain;
  } } as unknown as SupabaseClient;
  const history = await loadCoworkHistory(client, { userId: 'owner', organizationId: 'org' }, 'a');
  assert.deepEqual(history.turns[0].actions, [{ kind: 'enrich_contact', label: 'Enriquecer contacto Carlos A. (Minera Centinela)', outcome: 'ejecutada', result: { found: false, email: null } }]);
});

test('a parent turn with a long list keeps its first rows and says how many it left out instead of failing the next turn', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ id: `apollo:person-${index}`, name: 'Persona', title: 'Gerente de Personas',
    company: `Empresa ${index}`, fit: 'Posible comprador: cargo con «gerente de personas» · outsourcing, 120 empleados', notes: 'x'.repeat(600) }));
  const client = { from(table: string) {
    const where: Record<string, string> = {};
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain, in: () => chain,
      eq: (key: string, value: string) => { where[key] = value; return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: where.kind === 'tool.completed'
        ? [{ payload: { action: 'prospecting.search', result: { scope: 'external_search', items, next: { page: 1, offset: 25 } } } }] : [], error: null })),
      maybeSingle: async () => ({ data: table === 'cowork_runs'
        ? { id: where.id, message: 'Busca gerentes de personas', status: 'completed', parent_run_id: null }
        : { payload: { reply: 'Encontré 100 personas.', document: null } }, error: null }),
    };
    return chain;
  } } as unknown as SupabaseClient;
  const history = await loadCoworkHistory(client, { userId: 'owner', organizationId: 'org' }, 'search-turn');
  const result = (history.turns[0].observations[0] as { result: { items: unknown[]; itemsOmitted: number; next: unknown } }).result;
  assert.ok(result.items.length > 0 && result.items.length < 100);
  assert.equal(result.items.length + result.itemsOmitted, 100);
  assert.deepEqual(result.next, { page: 1, offset: 25 });
  assert.ok(JSON.stringify(history.turns[0]).length <= 60000);
});

test('each turn of the history carries what the person said about its answer', async () => {
  const runs: Record<string, string | null> = { a: null, b: 'a' };
  const client = { from(table: string) {
    const where: Record<string, unknown> = {};
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      in: (key: string, values: unknown[]) => { where[key] = values; return chain; },
      eq: (key: string, value: unknown) => { where[key] = value; return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(where.kind === 'answer.feedback'
        ? { data: [{ run_id: 'a', kind: 'answer.feedback', payload: { rating: 'down', reason: 'too_long', comment: null }, sequence: 9 }], error: null }
        : { data: [], error: null })),
      maybeSingle: async () => {
        const id = String(where.id || where.run_id);
        return { data: table === 'cowork_runs' ? { id, message: `request-${id}`, status: 'completed', parent_run_id: runs[id] }
          : { payload: { reply: `reply-${id}`, document: null } }, error: null };
      },
    };
    return chain;
  } } as unknown as SupabaseClient;
  const history = await loadCoworkHistory(client, { userId: 'owner', organizationId: 'org' }, 'b');
  assert.deepEqual(history.turns.map(turn => turn.feedback ?? null), [{ rating: 'down', reason: 'Demasiado largo', comment: null }, null]);
});

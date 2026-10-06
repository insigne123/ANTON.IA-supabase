import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicCoworkUuid } from './operations';
import { loadCoworkSinceLastVisit, readCoworkLastVisit } from './since-visit';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const scope = { userId: USER, organizationId: ORG };
const NOW = Date.parse('2026-10-06T15:00:00Z');

type Row = Record<string, unknown>;
/** A session that answers from tables, applying the filters these reads use; `fail` makes a table error. */
function fakeClient(tables: Record<string, Row[]>, fail: string[] = []) {
  const reads: string[] = [];
  return { reads, from(table: string) {
    reads.push(table);
    let rows = [...(tables[table] || [])];
    const chain = {
      select() { return chain; },
      eq(column: string, value: unknown) { rows = rows.filter(row => row[column] === undefined || row[column] === value); return chain; },
      neq(column: string, value: unknown) { rows = rows.filter(row => row[column] !== value); return chain; },
      gt(column: string, value: string) { rows = rows.filter(row => typeof row[column] === 'string' && (row[column] as string) > value); return chain; },
      in(column: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[column])); return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return fail.includes(table) ? { data: null, error: { message: 'boom' } } : { data: rows[0] ?? null, error: null }; },
      then(resolve: (value: { data: Row[] | null; error: unknown }) => unknown) {
        return Promise.resolve(fail.includes(table) ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }).then(resolve);
      },
    };
    return chain;
  } };
}

const parent = '00000000-0000-4000-8000-0000000000a1';
const runs = [
  // The newest run is the worker telling that research finished: it is not a visit.
  { created_at: '2026-10-05T20:00:00Z', parent_run_id: parent, request_id: deterministicCoworkUuid(`cowork:research-notice:${parent}`) },
  { created_at: '2026-10-04T15:00:00Z', parent_run_id: null, request_id: '00000000-0000-4000-8000-0000000000b1' },
];

test('the last visit is the person\'s own last turn, not the worker\'s', async () => {
  assert.equal(await readCoworkLastVisit(fakeClient({ cowork_runs: runs }) as never, scope), '2026-10-04T15:00:00Z');
  assert.equal(await readCoworkLastVisit(fakeClient({ cowork_runs: [] }) as never, scope), null);
});

test('what arrived since the last visit, each source on its own; one that fails is left out', async () => {
  const tables = {
    cowork_runs: runs,
    contacted_leads: [
      { name: 'Marcela Rojas', company: 'Constructora Andes', reply_intent: 'meeting_request', replied_at: '2026-10-05T12:00:00Z' },
      { name: 'Bot', company: 'Retail Andes', reply_intent: 'auto_reply', replied_at: '2026-10-05T13:00:00Z' },
      { name: 'Antes', company: 'Minera Sur', reply_intent: 'question', replied_at: '2026-10-01T12:00:00Z' },
    ],
    lead_research_jobs: [{ lead_id: 'l1', company_name: 'Minera Centinela', status: 'completed', completed_at: '2026-10-05T10:00:00Z' },
      { lead_id: 'l2', company_name: 'Adecco', status: 'failed', completed_at: '2026-10-05T10:00:00Z' }],
    leads: [{ id: 'l1', name: 'Carlos Ahumada' }],
    commercial_opportunities: [{ kind: 'compra_agil', status: 'new', first_seen_at: '2026-10-05T11:20:00Z' },
      { kind: 'hiring', status: 'dismissed', first_seen_at: '2026-10-05T11:20:00Z' }, { kind: 'project', status: 'new', first_seen_at: '2026-09-01T11:20:00Z' }],
  };
  // LinkedIn without a complete sync says nothing (agenda-read's rule).
  const admin = () => fakeClient({ cowork_linkedin_sweep_state: [{ last_completed_at: '2026-10-06T10:00:00Z', has_more: true }] }) as never;
  const since = await loadCoworkSinceLastVisit({ client: fakeClient(tables) as never, admin, opportunities: true }, scope, NOW);
  assert.equal(since?.at, '2026-10-04T15:00:00Z');
  assert.deepEqual(since?.items.map(item => item.text), [
    '1 respuesta nueva: Marcela Rojas (Constructora Andes) · 1 pide reunión',
    '1 investigación lista: Carlos Ahumada (Minera Centinela)',
    '1 oportunidad nueva: 1 licitación o Compra Ágil',
  ]);
  // Without access to «Oportunidades» they are not read; a failing source does not take the others with it.
  const client = fakeClient(tables, ['contacted_leads']);
  const partial = await loadCoworkSinceLastVisit({ client: client as never, admin, opportunities: false }, scope, NOW);
  assert.deepEqual(partial?.items.map(item => item.kind), ['research']);
  assert.equal(client.reads.includes('commercial_opportunities'), false);
  // Never asked Cowork anything: nothing to compare with.
  assert.equal(await loadCoworkSinceLastVisit({ client: fakeClient({}) as never, admin, opportunities: true }, scope, NOW), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CoworkContactListRefused, loadCoworkFullContactList } from './contact-list';

const RUN = '44444444-4444-4444-8444-444444444444';

/** Your session's client: the run and its events, and the contacts the query reads; every query is scoped to you. */
function session(events: Array<{ sequence: number; kind: string; payload: Record<string, unknown> }>, leads: unknown[]) {
  const scopes: Array<Record<string, unknown>> = [];
  const supabase = { from(table: string) {
    const where: Record<string, unknown> = {};
    scopes.push(where);
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain, order: () => chain, limit: () => chain, or: () => chain, in: () => chain,
      eq: (key, value) => { where[key as string] = value; return chain; },
      maybeSingle: async () => ({ data: table === 'cowork_runs' && where.user_id === 'u1'
        ? { id: RUN, message: 'mis contactos de RR. HH.', mode: 'approval', status: 'completed', parent_run_id: null, request_id: null } : null, error: null }),
      then: (resolve) => (resolve as (value: unknown) => void)({ data: table === 'cowork_run_events' ? events.map(event => ({ ...event, created_at: '' }))
        : table === 'leads' ? leads : [], error: null }),
    };
    return chain;
  } };
  return { auth: { user: { id: 'u1' }, organizationId: 'o1', organizationIds: ['o1'], supabase }, scopes };
}

test('the whole list re-runs the search the turn read, on your own contacts', async () => {
  const leads = Array.from({ length: 45 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`, name: `Persona ${n}`,
    title: 'Jefa de RR. HH.', company: `Empresa ${n}`, email: null, created_at: '2026-01-01' }));
  const { auth, scopes } = session([{ sequence: 7, kind: 'tool.completed', payload: { action: 'leads.search', input: 'RR. HH.', result: { items: [], truncated: true } } }], leads);
  const list = await loadCoworkFullContactList(auth as never, RUN, 7);
  assert.equal(list.action, 'leads.search');
  assert.equal(list.input, 'RR. HH.');
  assert.equal(list.result.items.length, 45);
  assert.ok(scopes.filter(where => Object.keys(where).length).every(where => where.user_id === 'u1' && where.organization_id === 'o1'));
});

test('a read that is not a search of your contacts, or a turn that is not yours, is refused', async () => {
  const { auth } = session([{ sequence: 3, kind: 'tool.completed', payload: { action: 'crm.search', input: 'x', result: {} } }], []);
  await assert.rejects(loadCoworkFullContactList(auth as never, RUN, 3), (error: unknown) => error instanceof CoworkContactListRefused && error.status === 404);
  await assert.rejects(loadCoworkFullContactList(auth as never, RUN, 99), (error: unknown) => error instanceof CoworkContactListRefused);
  const other = session([], []);
  (other.auth.user as { id: string }).id = 'u2';
  await assert.rejects(loadCoworkFullContactList(other.auth as never, RUN, 3), (error: unknown) => error instanceof CoworkContactListRefused && error.status === 404);
  await assert.rejects(loadCoworkFullContactList(auth as never, 'nope', 3));
  await assert.rejects(loadCoworkFullContactList(auth as never, RUN, 0));
});

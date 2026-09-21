import test from 'node:test';
import assert from 'node:assert/strict';
import { readCoworkSavedSearches } from './saved-searches';
import { runCoworkReadLoop } from '@/lib/cowork/agent-loop';

const scope = { userId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' };
const own = { id: 'saved', user_id: scope.userId, organization_id: scope.organizationId,
  name: ' Gerentes ', criteria: { title: 'Gerente', personLocation: 'Chile' }, is_shared: false, created_at: '2026-09-20' };
function fixture(rows: unknown[], error: unknown = null) {
  const calls: unknown[][] = [];
  const chain = {
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return chain; },
    eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return chain; },
    or: (...args: unknown[]) => { calls.push(['or', ...args]); return chain; },
    order: (...args: unknown[]) => { calls.push(['order', ...args]); return chain; },
    limit: async (...args: unknown[]) => { calls.push(['limit', ...args]); return { data: rows, error }; },
  };
  return { calls, client: { from: (name: string) => { calls.push(['from', name]); return chain; } } };
}

test('saved searches enforce own/shared and org filters and normalize existing criteria', async () => {
  const f = fixture([own, { ...own, id: 'shared', user_id: 'other', is_shared: true }]);
  const result = await readCoworkSavedSearches(f.client as never, scope, '');
  assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'organization_id', scope.organizationId])));
  assert.ok(f.calls.some(call => call[0] === 'or' && call[1] === `user_id.eq.${scope.userId},is_shared.eq.true`));
  assert.deepEqual(result.items.map(item => item.visibility), ['own', 'shared']);
  assert.equal(result.items[0].name, 'Gerentes');
  assert.equal(result.items[0].criteria.title, 'Gerente');
  assert.equal(result.items[0].criteria.personLocation, 'Chile');
  assert.equal(result.truncated, false);
});

test('foreign/private rows, invalid arguments and storage errors fail closed', async () => {
  for (const row of [{ ...own, organization_id: 'foreign' }, { ...own, user_id: 'other' }]) {
    const f = fixture([row]);
    await assert.rejects(readCoworkSavedSearches(f.client as never, scope, ''), /alcance/);
  }
  const f = fixture([]);
  await assert.rejects(readCoworkSavedSearches(f.client as never, scope, 'unexpected'));
  await assert.rejects(readCoworkSavedSearches(f.client as never, { ...scope, userId: 'x,or.true' }, ''));
  assert.equal(f.calls.length, 0);
  const broken = fixture([], { message: 'sensitive internals' });
  await assert.rejects(readCoworkSavedSearches(broken.client as never, scope, ''), error => {
    assert.equal((error as Error).message, 'No se pudieron consultar las búsquedas guardadas.'); return true;
  });
});

test('list limits declare truncation and empty results are explicit', async () => {
  const f = fixture(Array.from({ length: 21 }, (_, index) => ({ ...own, id: String(index) })));
  const result = await readCoworkSavedSearches(f.client as never, scope, '');
  assert.equal(result.returned, 20); assert.equal(result.truncated, true);
  const empty = fixture([]);
  assert.equal((await readCoworkSavedSearches(empty.client as never, scope, '')).returned, 0);
});

test('agent reads saved searches directly and within a dependency plan', async () => {
  for (const planned of [false, true]) {
    let turn = 0;
    const actions: string[] = [];
    await runCoworkReadLoop({
      message: 'Mis búsquedas', signal: new AbortController().signal, authorize: async () => {},
      execute: async (action, input) => { actions.push(action); assert.equal(input, ''); return { items: [] }; },
      record: async () => {},
      decide: async () => {
        if (++turn > 1) return { action: 'answer', query: null, leadId: null, answer: { reply: 'Sin búsquedas', document: null } };
        return planned
          ? { action: 'reads.plan', query: null, leadId: null, answer: null,
            plan: [{ id: 'saved', dependsOn: [], read: { action: 'saved_searches.list', input: '' } }] }
          : { action: 'saved_searches.list', query: null, leadId: null, answer: null };
      },
    });
    assert.deepEqual(actions, ['saved_searches.list']);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { queryCoworkLeads } from './lead-tools';

function client() {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'or']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null }));
  return { calls, db: { from: (table: string) => { calls.push(['from', table]); return chain; } } as unknown as SupabaseClient };
}

test('reads always enforce user and organization and sanitize PostgREST grammar', async () => {
  const f = client();
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '%,id.not.is.null,(secret)');
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'owner'));
  assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org'));
  const filter = String(f.calls.find(call => call[0] === 'or')?.[1]);
  assert.equal(filter.includes('('), false);
  assert.equal(filter.split(',').length, 3);
  assert.equal(result.scope, 'own_saved_contacts');
  assert.equal(result.returned, 0);
});

test('detail lookup validates IDs and is bounded to one row', async () => {
  const f = client();
  await assert.rejects(queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', 'x,or.id'));
  await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', '00000000-0000-4000-8000-000000000001');
  assert.ok(f.calls.some(call => call[0] === 'limit' && call[1] === 1));
});

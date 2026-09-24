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
  const parts = filter.split(',');
  assert.ok(!filter.includes('('));
  assert.equal(parts.length, 12);
  assert.ok(parts.every(part => /^\w+\.ilike\.%[^%,()]*%$/.test(part)));
  assert.equal(result.scope, 'own_saved_contacts');
  assert.equal(result.returned, 0);
});

test('detail lookup validates IDs and is bounded to one row', async () => {
  const f = client();
  await assert.rejects(queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', 'x,or.id'));
  await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.get', '00000000-0000-4000-8000-000000000001');
  assert.ok(f.calls.some(call => call[0] === 'limit' && call[1] === 1));
});

function rowsClient(rows: unknown[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'or']) {
    chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null }));
  return { calls, db: { from: (table: string) => { calls.push(['from', table]); return chain; } } as unknown as SupabaseClient };
}

test('multi-term queries rank by overlap and declare partial matches', async () => {
  const rows = [
    { id: '1', name: 'Ana R.', title: 'Gerenta', company: 'Otra', email: null, city: null, country: null, created_at: '2026-01-03' },
    { id: '2', name: 'José C.', title: 'Reclutador Junior', company: 'GrupoExpro', email: null, city: null, country: null, created_at: '2026-01-02' },
  ];
  const f = rowsClient(rows);
  const result = await queryCoworkLeads(f.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'reclutador junior GrupoExpro Santiago');
  assert.deepEqual((result.items as Array<{ id: string }>).map(item => item.id), ['2', '1']);
  assert.equal(result.returned, 2);
  assert.equal(result.partial, true);
  assert.equal(result.terms, 4);
  assert.equal(result.truncated, false);
});

test('exact multi-term matches are not partial and empty queries list recent', async () => {
  const rows = [{ id: '2', name: 'José C.', title: 'Reclutador Junior', company: 'GrupoExpro', email: null, city: 'Santiago', country: null, created_at: '2026-01-02' }];
  const exact = rowsClient(rows);
  const full = await queryCoworkLeads(exact.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', 'junior grupoexpro santiago');
  assert.equal(full.partial, false);
  const listed = rowsClient(rows);
  const empty = await queryCoworkLeads(listed.db, { userId: 'owner', organizationId: 'org' }, 'leads.search', '');
  assert.ok(!listed.calls.some(call => call[0] === 'or'));
  assert.equal(empty.returned, 1);
  assert.equal(empty.partial, false);
});

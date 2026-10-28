import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ApolloAllocationRefusal, assertApolloAllocationAllows, loadApolloCreditAllocation } from './apollo-credit-allocation';

const row = { credits: 300, used: 18, remaining: 282, starts_at: '2026-10-28T20:00:00+00:00', ends_at: '2026-11-01T20:17:52+00:00', note: ' Ya se usaron los 2.500 créditos del plan. ' };
const client = (result: { data?: unknown; error?: unknown }, calls: unknown[] = []) => ({
  rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: result.data ?? null, error: result.error ?? null }; },
});

test('the share is read for the organization only, with what is left', async () => {
  const calls: unknown[] = [];
  const share = await loadApolloCreditAllocation('org-1', client({ data: [row] }, calls));
  assert.deepEqual(calls, [['apollo_credit_allocation_status_v1', { p_organization_id: 'org-1' }]]);
  assert.deepEqual(share, { credits: 300, used: 18, remaining: 282, startsAt: row.starts_at, endsAt: row.ends_at, note: 'Ya se usaron los 2.500 créditos del plan.' });
  assert.equal(await loadApolloCreditAllocation('org-1', client({ data: [] })), null, 'no open share');
});

test('before the migration no organization has a share; any other failure is not taken as one', async () => {
  assert.equal(await loadApolloCreditAllocation('org-1', client({ error: { code: 'PGRST202', message: 'missing' } })), null);
  await assert.rejects(loadApolloCreditAllocation('org-1', client({ error: { code: '57014', message: 'timeout' } })));
});

test('a lookup that does not fit is refused, and one that cannot be checked is not asked either', async () => {
  const exhausted = async () => ({ credits: 300, used: 300, remaining: 0, startsAt: row.starts_at, endsAt: row.ends_at, note: null });
  await assert.rejects(assertApolloAllocationAllows('org-1', 1, exhausted),
    (error: unknown) => error instanceof ApolloAllocationRefusal && /ya usó los 300 créditos de Apollo/.test(error.message));
  assert.equal(await assertApolloAllocationAllows('org-1', 0, async () => { throw new Error('never read'); }), null, 'nothing asked of Apollo');
  assert.equal(await assertApolloAllocationAllows('org-1', 9, async () => null), null, 'no share');
  await assert.rejects(assertApolloAllocationAllows('org-1', 1, async () => { throw new Error('db down: secret'); }),
    (error: unknown) => error instanceof ApolloAllocationRefusal && /No pudimos comprobar/.test(error.message) && !/secret/.test(error.message));
});

test('the database counts the window lookups of the organization alone, and only the server reads it', () => {
  const migration = readFileSync('supabase/migrations/20261028230000_apollo_credit_allocations.sql', 'utf8');
  assert.match(migration, /where c\.organization_id = p_organization_id/);
  assert.match(migration, /c\.created_at >= allocation\.starts_at and c\.created_at < allocation\.ends_at/);
  assert.match(migration, /then 1 else 0 end\) \+ \(case when c\.reveal_phone then 8 else 0 end\)/);
  assert.match(migration, /c\.terminal_state is null or c\.terminal_state = 'succeeded'/);
  assert.match(migration, /alter table public\.apollo_credit_allocations enable row level security/);
  assert.match(migration, /revoke all on table public\.apollo_credit_allocations from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.apollo_credit_allocation_status_v1\(uuid, timestamptz\) from public, anon, authenticated/);
  const route = readFileSync('src/app/api/dashboard/admin/apollo/route.ts', 'utf8');
  assert.match(route, /requireAdminDashboardAccess\(\)/);
  assert.match(route, /loadApolloCreditAllocation\(auth\.organizationId, auth\.supabase\)/);
  assert.doesNotMatch(route, /request|searchParams/, 'the organization comes from the membership, never from the request');
});

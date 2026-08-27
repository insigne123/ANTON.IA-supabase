import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { assertSafeTestTarget } from '../scripts/assert-test-target.mjs';
import { QA_IDENTITIES, QA_ORGANIZATIONS } from '../scripts/bootstrap-test-identities.mjs';

function createAuthenticatedClient(target, email, password) {
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  assert.ok(anonKey, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required for integration tests');

  const client = createClient(target.supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.auth.signInWithPassword({ email, password }).then(({ error }) => {
    assert.equal(error, null, `${email} should be able to sign in`);
    return client;
  });
}

test('QA identities are isolated by organization', async () => {
  const target = assertSafeTestTarget();
  assert.ok(['local', 'nonprod'].includes(target.kind));

  const password = String(process.env.QA_TEST_PASSWORD || '').trim();
  assert.ok(password, 'QA_TEST_PASSWORD is required for integration tests');

  const owner = await createAuthenticatedClient(target, QA_IDENTITIES.owner.email, password);
  const member = await createAuthenticatedClient(target, QA_IDENTITIES.member.email, password);
  const outsider = await createAuthenticatedClient(target, QA_IDENTITIES.outsider.email, password);

  const ownerPrimary = await owner
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.primary);
  assert.equal(ownerPrimary.error, null);
  assert.equal(ownerPrimary.data?.length, 1);

  const memberPrimary = await member
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.primary);
  assert.equal(memberPrimary.error, null);
  assert.equal(memberPrimary.data?.length, 1);

  const outsiderPrimary = await outsider
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.primary);
  assert.equal(outsiderPrimary.error, null);
  assert.equal(outsiderPrimary.data?.length, 0);

  const outsiderOrganization = await outsider
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.outsider);
  assert.equal(outsiderOrganization.error, null);
  assert.equal(outsiderOrganization.data?.length, 1);
});

test('legacy CRM tables enforce tenant RLS through PostgREST', async () => {
  const target = assertSafeTestTarget();
  const password = String(process.env.QA_TEST_PASSWORD || '').trim();
  assert.ok(password, 'QA_TEST_PASSWORD is required for integration tests');

  const owner = await createAuthenticatedClient(target, QA_IDENTITIES.owner.email, password);
  const outsider = await createAuthenticatedClient(target, QA_IDENTITIES.outsider.email, password);

  const ownerOrganization = await owner
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.primary)
    .single();
  assert.equal(ownerOrganization.error, null);

  const outsiderOrganization = await outsider
    .from('organizations')
    .select('id')
    .eq('name', QA_ORGANIZATIONS.outsider)
    .single();
  assert.equal(outsiderOrganization.error, null);

  const ownerRowId = 'qa-rls-primary';
  const outsiderRowId = 'qa-rls-outsider';

  try {
    const ownerUpsert = await owner.from('unified_crm_data').upsert({
      id: ownerRowId,
      organization_id: ownerOrganization.data.id,
      stage: 'qa',
    });
    assert.equal(ownerUpsert.error, null);

    const outsiderUpsert = await outsider.from('unified_crm_data').upsert({
      id: outsiderRowId,
      organization_id: outsiderOrganization.data.id,
      stage: 'qa',
    });
    assert.equal(outsiderUpsert.error, null);

    const ownerRows = await owner
      .from('unified_crm_data')
      .select('id')
      .in('id', [ownerRowId, outsiderRowId]);
    assert.equal(ownerRows.error, null);
    assert.deepEqual(ownerRows.data, [{ id: ownerRowId }]);

    const outsiderRows = await outsider
      .from('unified_crm_data')
      .select('id')
      .in('id', [ownerRowId, outsiderRowId]);
    assert.equal(outsiderRows.error, null);
    assert.deepEqual(outsiderRows.data, [{ id: outsiderRowId }]);

    const crossTenantUpdate = await outsider
      .from('unified_crm_data')
      .update({ stage: 'forged' })
      .eq('id', ownerRowId)
      .select('id');
    assert.equal(crossTenantUpdate.error, null);
    assert.deepEqual(crossTenantUpdate.data, []);

    const exceptionRead = await owner.from('antonia_exceptions').select('id').limit(1);
    assert.equal(exceptionRead.error?.code, '42501');
  } finally {
    await Promise.all([
      owner.from('unified_crm_data').delete().eq('id', ownerRowId),
      outsider.from('unified_crm_data').delete().eq('id', outsiderRowId),
    ]);
  }
});

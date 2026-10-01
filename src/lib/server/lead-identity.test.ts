import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEnrichedIdentity, identityFromProvider, identityPatch, providerFullName } from './lead-identity';

const PROVIDER = { full_name: 'Rafael Durán', first_name: 'Rafael', last_name: 'Durán', linkedin_url: 'https://linkedin.com/in/rafael-duran', title: 'Jefe de Operaciones' };

test('the provider name counts only when it is complete', () => {
  assert.equal(providerFullName(identityFromProvider(PROVIDER)), 'Rafael Durán');
  assert.equal(providerFullName({ fullName: 'Rafael Du***n' }), null);
  assert.equal(providerFullName({ fullName: '', firstName: 'Rafael', lastName: 'Durán' }), 'Rafael Durán');
  assert.equal(providerFullName({}), null);
});

test('only gaps are filled: a hidden or empty name, an empty LinkedIn or title', () => {
  const identity = identityFromProvider(PROVIDER);
  assert.deepEqual(identityPatch({ name: 'Rafael Du***n', linkedinUrl: null, title: '' }, identity),
    { name: 'Rafael Durán', linkedinUrl: 'https://www.linkedin.com/in/rafael-duran', title: 'Jefe de Operaciones' });
  assert.deepEqual(identityPatch({ name: 'Rafa Durán (cliente)', linkedinUrl: 'https://www.linkedin.com/in/x', title: 'Gerente' }, identity),
    { name: null, linkedinUrl: null, title: null }, 'what someone typed stays');
  assert.equal(identityPatch({ name: 'Rafael Du***n' }, { fullName: 'Rafael Du***n' }).name, null, 'a hidden name never replaces a hidden one');
});

/** A tiny stand-in for the Supabase query builder: records filters and updates. */
function fakeClient(rows: Record<string, Record<string, unknown>>) {
  const updates: Array<{ table: string; values: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let values: Record<string, unknown> | null = null;
      const builder: any = {
        select() { return builder; },
        update(next: Record<string, unknown>) { values = next; return builder; },
        eq(column: string, value: unknown) { filters.push(['eq', column, value]); return builder; },
        is(column: string, value: unknown) { filters.push(['is', column, value]); return builder; },
        maybeSingle: async () => {
          const id = filters.find(([, column]) => column === 'id')?.[2] as string;
          const row = rows[`${table}:${id}`];
          const owned = row && row.user_id === filters.find(([, column]) => column === 'user_id')?.[2]
            && row.organization_id === filters.find(([, column]) => column === 'organization_id')?.[2];
          return { data: owned ? row : null, error: null };
        },
        then(resolve: (value: unknown) => void) {
          if (values) updates.push({ table, values, filters });
          resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { client, updates };
}

test('the saved contact and the enriched one get the real name, scoped to the person and guarded by the old value', async () => {
  const { client, updates } = fakeClient({
    'leads:l1': { id: 'l1', user_id: 'u1', organization_id: 'o1', name: 'Rafael Du***n', linkedin_url: null, title: null, source_provider_id: 'ap-1' },
    'enriched_leads:e1': { id: 'e1', user_id: 'u1', organization_id: 'o1', full_name: 'Rafael Du***n', linkedin_url: null, title: 'Jefe' },
  });
  const changed = await applyEnrichedIdentity(client, {
    userId: 'u1', organizationId: 'o1', savedLeadId: 'l1', enrichedLeadId: 'e1', providerId: 'ap-1', identity: identityFromProvider(PROVIDER),
  });
  assert.deepEqual(changed, { savedLead: ['name', 'linkedin_url', 'title'], enrichedLead: ['full_name', 'linkedin_url'] });
  assert.deepEqual(updates[0].values, { name: 'Rafael Durán', linkedin_url: 'https://www.linkedin.com/in/rafael-duran', title: 'Jefe de Operaciones' });
  assert.deepEqual(updates[0].filters, [['eq', 'id', 'l1'], ['eq', 'user_id', 'u1'], ['eq', 'organization_id', 'o1'], ['eq', 'name', 'Rafael Du***n']]);
  assert.equal(updates[1].table, 'enriched_leads');
});

test('another person or another account is never touched', async () => {
  const { client, updates } = fakeClient({
    'leads:l1': { id: 'l1', user_id: 'u1', organization_id: 'o1', name: 'Rafael Du***n', source_provider_id: 'ap-OTHER' },
    'leads:l2': { id: 'l2', user_id: 'u2', organization_id: 'o1', name: 'Ana Pé***z' },
  });
  const identity = identityFromProvider(PROVIDER);
  assert.deepEqual((await applyEnrichedIdentity(client, { userId: 'u1', organizationId: 'o1', savedLeadId: 'l1', providerId: 'ap-1', identity })).savedLead, [],
    'a contact bound to another provider person stays as it is');
  assert.deepEqual((await applyEnrichedIdentity(client, { userId: 'u1', organizationId: 'o1', savedLeadId: 'l2', identity })).savedLead, [],
    'someone else’s contact is not even read');
  assert.equal(updates.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseOpportunities, opportunitiesGrantedUserIds, opportunitiesGrantsAvailable, setOpportunitiesGrant } from './grants';

type Row = Record<string, any>;
const confirmed = '2026-09-01T00:00:00Z';
const LIST = 'nicolas.yarur.g@yago.cl';

/** select/eq/limit/maybeSingle, upsert and delete over in-memory rows; `missing` answers like a table that does not exist. */
function fakeClient(rows: Row[] | 'missing') {
  return {
    rows,
    from() {
      const filters: Array<(row: Row) => boolean> = [];
      let removing = false;
      const result = () => {
        if (rows === 'missing') return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
        const matched = rows.filter(row => filters.every(keep => keep(row)));
        if (removing) { for (const row of matched) rows.splice(rows.indexOf(row), 1); return { data: null, error: null }; }
        return { data: matched, error: null };
      };
      const builder: any = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        limit() { return builder; },
        maybeSingle: async () => { const { data, error } = result(); return { data: data?.[0] ?? null, error }; },
        upsert: async (row: Row) => {
          if (rows === 'missing') return { error: { message: 'relation does not exist' } };
          if (!rows.some(item => item.organization_id === row.organization_id && item.user_id === row.user_id)) rows.push(row);
          return { error: null };
        },
        delete() { removing = true; return builder; },
        then(resolve: (value: unknown) => void) { resolve(result()); },
      };
      return builder;
    },
  } as any;
}

const person = (id: string, email: string, verified: string | null = confirmed) => ({ id, email, email_confirmed_at: verified });

test('the list keeps its access everywhere; an admin lets a confirmed member in, in that organization only', async () => {
  const client = fakeClient([{ organization_id: 'org', user_id: 'ana' }]);
  assert.equal(await canUseOpportunities(client, person('nico', LIST), 'otra', LIST), true, 'the list, in any organization');
  assert.equal(await canUseOpportunities(client, person('ana', 'ana@empresa.cl'), 'org', LIST), true, 'let in by an admin');
  assert.equal(await canUseOpportunities(client, person('ana', 'ana@empresa.cl'), 'otra', LIST), false, 'not in another organization');
  assert.equal(await canUseOpportunities(client, person('ana', 'ana@empresa.cl', null), 'org', LIST), false, 'an unconfirmed email never');
  assert.equal(await canUseOpportunities(client, person('luis', 'luis@empresa.cl'), 'org', LIST), false);
  assert.equal(await canUseOpportunities(client, null, 'org', LIST), false);
});

test('before its migration the table reads as nobody, and the list still works', async () => {
  const client = fakeClient('missing');
  assert.equal(await opportunitiesGrantsAvailable(client), false);
  assert.deepEqual([...await opportunitiesGrantedUserIds(client, 'org')], []);
  assert.equal(await canUseOpportunities(client, person('ana', 'ana@empresa.cl'), 'org', LIST), false);
  assert.equal(await canUseOpportunities(client, person('nico', LIST), 'org', LIST), true);
  await assert.rejects(setOpportunitiesGrant(client, { organizationId: 'org', userId: 'ana', grantedBy: 'nico', enabled: true }), /No se pudo cambiar el acceso/);
});

test('giving access twice keeps one row, and taking it away removes only that person in that organization', async () => {
  const rows: Row[] = [{ organization_id: 'otra', user_id: 'ana' }];
  const client = fakeClient(rows);
  assert.equal(await opportunitiesGrantsAvailable(client), true);
  await setOpportunitiesGrant(client, { organizationId: 'org', userId: 'ana', grantedBy: 'nico', enabled: true });
  await setOpportunitiesGrant(client, { organizationId: 'org', userId: 'ana', grantedBy: 'nico', enabled: true });
  assert.deepEqual([...await opportunitiesGrantedUserIds(client, 'org')], ['ana']);
  await setOpportunitiesGrant(client, { organizationId: 'org', userId: 'ana', grantedBy: 'nico', enabled: false });
  assert.deepEqual([...await opportunitiesGrantedUserIds(client, 'org')], []);
  assert.deepEqual(rows, [{ organization_id: 'otra', user_id: 'ana' }], 'the other organization keeps its access');
});

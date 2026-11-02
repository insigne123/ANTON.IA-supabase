import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from '../goals-alerts-test-fixtures';
import { createPrivateOpportunity } from './workspace-store';
import { findOpportunityDuplicates } from './workspace-duplicates';

const ORG = 'org-1';
const HASH = (n: number) => String(n).repeat(64).slice(0, 64);
const input = { requestId: 'c2d6a1f0-0000-4000-8000-000000000001', title: 'Servicio de evaluaciones psicolaborales', company: 'Municipalidad de Quilleco', kind: 'private_tender',
  description: '', url: null, deadline: null, amount: null, currency: 'CLP' } as any;

/** The tables in memory, and opportunity_can_read as the database answers it: an owner or admin reads all, a member what they take part in. */
function database(seed: Record<string, any[]> = {}) {
  const store = memory({ organization_members: [{ organization_id: ORG, user_id: 'u-admin', role: 'admin' }, { organization_id: ORG, user_id: 'u-ana', role: 'member' }],
    commercial_opportunities: [], opportunity_work: [], opportunity_participants: [], opportunity_activity: [], ...seed });
  const rpc = async (name: string, args: any) => {
    assert.equal(name, 'opportunity_can_read');
    const member = store.tables.organization_members.find(row => row.organization_id === args.p_org && row.user_id === args.p_user);
    const exists = store.tables.commercial_opportunities.some(row => row.organization_id === args.p_org && row.id === args.p_opportunity);
    const takes = store.tables.opportunity_participants.some(row => row.opportunity_id === args.p_opportunity && row.user_id === args.p_user);
    return { data: Boolean(member && exists && (['admin', 'owner'].includes(member.role) || takes)), error: null };
  };
  return { ...store, client: { ...store.client, rpc } };
}

test('a member who brings an opportunity works it: its responsible person and only participant, and they can open it', async () => {
  const db = database();
  const id = await createPrivateOpportunity(db.client, { organizationId: ORG, userId: 'u-ana', role: 'member' }, input);
  assert.equal(db.tables.commercial_opportunities.length, 1);
  assert.equal(db.tables.commercial_opportunities[0].data.createdBy, 'u-ana');
  assert.deepEqual(db.tables.opportunity_work.map(row => [row.opportunity_id, row.state, row.responsible_id, row.assigned_by, row.revision]), [[id, 'assigned', 'u-ana', 'u-ana', 1]]);
  assert.deepEqual(db.tables.opportunity_participants.map(row => [row.opportunity_id, row.user_id]), [[id, 'u-ana']]);
  assert.equal(db.tables.opportunity_activity.length, 1, 'its «created» line, which needs to read it');
  assert.equal((await db.client.rpc('opportunity_can_read', { p_org: ORG, p_user: 'u-ana', p_opportunity: id })).data, true);
  // The same form sent twice (a double click, a retry) is one opportunity, still theirs.
  assert.equal(await createPrivateOpportunity(db.client, { organizationId: ORG, userId: 'u-ana', role: 'member' }, input), id);
  assert.deepEqual([db.tables.commercial_opportunities.length, db.tables.opportunity_work.length, db.tables.opportunity_participants.length], [1, 1, 1]);
});

test('an administrator\'s stays to be assigned, as before', async () => {
  const db = database();
  await createPrivateOpportunity(db.client, { organizationId: ORG, userId: 'u-admin', role: 'admin' }, input);
  assert.equal(db.tables.commercial_opportunities.length, 1);
  assert.deepEqual([db.tables.opportunity_work.length, db.tables.opportunity_participants.length], [0, 0]);
});

test('the bases already loaded: where they are, the one with most first, and a member does not learn the title of one that is not theirs', async () => {
  const opportunity = (id: string, title: string, createdAt: string) => ({ id, organization_id: ORG, kind: 'private', title, created_at: createdAt });
  const document = (opportunityId: string, n: number, organizationId = ORG) => ({ organization_id: organizationId, opportunity_id: opportunityId, sha256: HASH(n) });
  const db = database({
    commercial_opportunities: [opportunity('op-1', 'ESVAL oficinas (22 oct)', '2026-10-22T19:04:04Z'), opportunity('op-2', 'ESVAL oficinas (28 oct)', '2026-10-28T15:39:27Z')],
    opportunity_documents: [document('op-1', 1), document('op-1', 2), document('op-2', 1), document('op-2', 2), document('op-2', 3), document('op-x', 3, 'org-2')],
    opportunity_participants: [{ organization_id: ORG, opportunity_id: 'op-1', user_id: 'u-ana' }],
  });
  const admin = await findOpportunityDuplicates(db.client, { organizationId: ORG, userId: 'u-admin', role: 'admin' }, [HASH(1), HASH(2), HASH(3)]);
  assert.deepEqual(admin.map(item => [item.id, item.matched, item.readable, item.title]), [['op-2', 3, true, 'ESVAL oficinas (28 oct)'], ['op-1', 2, true, 'ESVAL oficinas (22 oct)']]);
  const ana = await findOpportunityDuplicates(db.client, { organizationId: ORG, userId: 'u-ana', role: 'member' }, [HASH(1), HASH(2), HASH(3)]);
  assert.deepEqual(ana.map(item => [item.id, item.readable, item.title]), [['op-2', false, null], ['op-1', true, 'ESVAL oficinas (22 oct)']]);
  assert.deepEqual(await findOpportunityDuplicates(db.client, { organizationId: ORG, userId: 'u-admin', role: 'admin' }, [HASH(9)]), [], 'new files: nothing');
  assert.deepEqual(await findOpportunityDuplicates(db.client, { organizationId: ORG, userId: 'u-admin', role: 'admin' }, []), []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { AdminScopeError, periodBounds, readAdminFilters, scopeMemberIds } from './admin-scope';
import { readTeamFunnel } from './team-funnel';

const ORG = 'org-1';
const IN = '2026-10-20T15:00:00Z';
const BEFORE = '2026-09-20T15:00:00Z';
const row = (table: string, id: string, user: string, extra: Record<string, unknown> = {}) => ({ id: `${table}-${id}`, organization_id: ORG, user_id: user, ...extra });

const seed = () => ({
  leads: [
    ...['1', '2', '3', '4'].map(id => row('lead', id, 'u-ana', { created_at: IN })),
    row('lead', '5', 'u-leo', { created_at: IN }),
    row('lead', '6', 'u-ana', { created_at: BEFORE }), // before the period
    { ...row('lead', '7', 'u-ana', { created_at: IN }), organization_id: 'org-2' }, // another company
  ],
  enriched_leads: [
    row('enriched', '1', 'u-ana', { created_at: IN, email: 'uno@a.cl' }),
    row('enriched', '2', 'u-ana', { created_at: IN, email: '' }), // no email
    row('enriched', '3', 'u-ana', { created_at: IN, email: null }),
    row('enriched', '4', 'u-leo', { created_at: IN, email: 'cuatro@a.cl' }),
  ],
  lead_research_jobs: [
    row('research', '1', 'u-ana', { completed_at: IN, status: 'completed' }),
    row('research', '2', 'u-ana', { completed_at: IN, status: 'failed' }),
  ],
  messaging_drafts: [row('draft', '1', 'u-ana', { created_at: IN }), row('draft', '2', 'u-ana', { created_at: IN })],
  outbound_dispatches: [
    // Two emails to the same person count once; a WhatsApp dispatch and a failed one, none.
    row('dispatch', '1', 'u-ana', { completed_at: IN, status: 'sent', channel: 'email', recipient: 'Uno@A.cl' }),
    row('dispatch', '2', 'u-ana', { completed_at: IN, status: 'sent', channel: 'email', recipient: 'uno@a.cl' }),
    row('dispatch', '3', 'u-ana', { completed_at: IN, status: 'failed', channel: 'email', recipient: 'dos@a.cl' }),
    row('dispatch', '4', 'u-leo', { completed_at: IN, status: 'sent', channel: 'linkedin', recipient: null }),
  ],
  contacted_leads: [
    row('contacted', '1', 'u-ana', { replied_at: IN, email: 'uno@a.cl', reply_intent: 'positive' }),
    row('contacted', '2', 'u-ana', { replied_at: IN, email: 'tres@a.cl', reply_intent: 'auto_reply' }), // automatic
  ],
  contact_calls: [
    // Ana called the person she also wrote to: one contacted, one conversation.
    row('call', '1', 'u-ana', { outcome_at: IN, outcome: 'answered', contact_email: 'uno@a.cl', lead_id: 'enriched-1' }),
    // Leo: an answered WhatsApp, a call nobody took and a wrong number (that reached nobody).
    row('call', '2', 'u-leo', { outcome_at: IN, outcome: 'answered', channel: 'whatsapp', lead_id: 'enriched-4' }),
    row('call', '3', 'u-leo', { outcome_at: IN, outcome: 'no_answer', provider_person_id: 'p9' }),
    row('call', '4', 'u-leo', { outcome_at: IN, outcome: 'wrong_number', provider_person_id: 'p10' }),
    row('call', '5', 'u-leo', { outcome_at: null, outcome: null, provider_person_id: 'p11' }), // started, never told
  ],
});

const RANGE = { organizationId: ORG, from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z' };

test('each person\'s steps in the period, a person reached twice counted once, everyone listed', async () => {
  const { client } = memory(seed());
  const funnel = await readTeamFunnel(client, { ...RANGE, userIds: ['u-ana', 'u-leo', 'u-pia'] });
  assert.deepEqual(funnel.people, [
    { userId: 'u-leo', funnel: { saved: 1, withEmail: 1, researched: 0, drafts: 0, contacted: 2, conversations: 1 } },
    { userId: 'u-ana', funnel: { saved: 4, withEmail: 1, researched: 1, drafts: 2, contacted: 1, conversations: 1 } },
    { userId: 'u-pia', funnel: { saved: 0, withEmail: 0, researched: 0, drafts: 0, contacted: 0, conversations: 0 } },
  ]);
  assert.deepEqual(funnel.total, { saved: 5, withEmail: 2, researched: 1, drafts: 2, contacted: 3, conversations: 2 });
});

test('only the people asked for count, nobody reads nothing, and before the calls table only emails do', async () => {
  const { client } = memory(seed());
  const leo = await readTeamFunnel(client, { ...RANGE, userIds: ['u-leo'] });
  assert.deepEqual(leo.people.map(person => person.userId), ['u-leo']);
  assert.deepEqual(await readTeamFunnel(client, { ...RANGE, userIds: [] }), { total: { saved: 0, withEmail: 0, researched: 0, drafts: 0, contacted: 0, conversations: 0 }, people: [] });
  const withoutCalls = await readTeamFunnel(memory(seed(), { missing: ['contact_calls'] }).client, { ...RANGE, userIds: ['u-ana', 'u-leo'] });
  assert.deepEqual(withoutCalls.total, { saved: 5, withEmail: 2, researched: 1, drafts: 2, contacted: 1, conversations: 1 });
});

test('a table that fails is an error, not a team that did nothing', async () => {
  const { client } = memory(seed(), { missing: ['messaging_drafts'] });
  await assert.rejects(readTeamFunnel(client, { ...RANGE, userIds: ['u-ana'] }), /No pudimos leer el trabajo del equipo/);
});

test('the filters of «Uso y resultados»: a valid period, team and person, and the members they leave', async () => {
  const team = '6f1c2b6e-1d2a-4c3b-8a9d-0e1f2a3b4c5d';
  const ana = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const filters = readAdminFilters(new URLSearchParams({ from: '2026-10-01', to: '2026-10-31', groupId: team }));
  assert.deepEqual(filters, { from: '2026-10-01', to: '2026-10-31', groupId: team, userId: '' });
  assert.deepEqual(periodBounds(filters), { from: '2026-10-01T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z' });
  assert.throws(() => readAdminFilters(new URLSearchParams({ from: '2026-10-31', to: '2026-10-01' })), AdminScopeError);
  assert.throws(() => readAdminFilters(new URLSearchParams({ userId: 'nadie' })), /El filtro seleccionado no es válido/);

  const { client } = memory({
    organization_members: [{ organization_id: ORG, user_id: ana }, { organization_id: ORG, user_id: 'u-leo' }, { organization_id: 'org-2', user_id: 'u-x' }],
    organization_reporting_group_members: [
      { organization_id: ORG, group_id: team, user_id: ana, unassigned_at: null },
      { organization_id: ORG, group_id: team, user_id: 'u-leo', unassigned_at: '2026-10-15T00:00:00Z' }, // left the team
    ],
  });
  assert.deepEqual(await scopeMemberIds(client, ORG, { groupId: '', userId: '' }), [ana, 'u-leo']);
  assert.deepEqual(await scopeMemberIds(client, ORG, { groupId: team, userId: '' }), [ana]);
  assert.deepEqual(await scopeMemberIds(client, ORG, { groupId: '', userId: 'u-leo' }), ['u-leo']);
});

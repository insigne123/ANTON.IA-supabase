import assert from 'node:assert/strict';
import test from 'node:test';

import { memory } from './goals-alerts-test-fixtures';
import { readGoalCounts, readGoalSettings, readPersonGoal, readReadyToWrite, readTeamGoals, saveGoalSettings } from './weekly-goals';

const ORG = 'org-1';
// The week of Monday 19 Oct 2026 in Chile (UTC−3): from 03:00Z on Monday.
const WEEK = { from: '2026-10-19T03:00:00.000Z', to: '2026-10-21T12:00:00.000Z' };
const lead = (id: string, userId: string, email: string | null, at: string) => ({ id, organization_id: ORG, user_id: userId, email, created_at: at });
const dispatch = (id: string, userId: string, email: string, at: string, sentAt?: string) => ({ id, organization_id: ORG, user_id: userId, status: 'sent', channel: 'email',
  completed_at: at, reconciliation_details: sentAt ? { sentAt } : null, metadata: { recipient: { email } } });
const touch = (userId: string, contactedId: string, channel: string, at: string, state = 'done') => ({ organization_id: ORG, user_id: userId, contacted_id: contactedId, channel, state, done_at: at });
const members = [{ organization_id: ORG, user_id: 'u-admin', role: 'admin' }, { organization_id: ORG, user_id: 'u-ana', role: 'member' }, { organization_id: ORG, user_id: 'u-leo', role: 'member' }];

const seed = () => ({
  organization_members: members,
  enriched_leads: [
    lead('l1', 'u-ana', 'a@x.cl', '2026-10-19T15:00:00Z'), lead('l2', 'u-ana', 'A@x.cl', '2026-10-20T15:00:00Z'), // the same address twice
    lead('l3', 'u-ana', 'b@x.cl', '2026-10-20T16:00:00Z'), lead('l4', 'u-ana', null, '2026-10-20T16:00:00Z'), // no email yet
    lead('l5', 'u-ana', 'c@x.cl', '2026-10-17T16:00:00Z'), // last week
    lead('l6', 'u-leo', 'd@x.cl', '2026-10-19T18:00:00Z'),
  ],
  outbound_dispatches: [
    dispatch('d1', 'u-ana', 'a@x.cl', '2026-10-19T16:00:00Z'), dispatch('d2', 'u-ana', 'a@x.cl', '2026-10-20T16:00:00Z'), // one person, two emails
    dispatch('d3', 'u-ana', 'e@x.cl', '2026-10-20T17:00:00Z'),
    dispatch('d4', 'u-ana', 'f@x.cl', '2026-10-19T03:30:00Z', '2026-10-18T20:00:00Z'), // sent on Sunday, confirmed on Monday
    { ...dispatch('d5', 'u-ana', 'g@x.cl', '2026-10-20T17:00:00Z'), channel: 'linkedin' },
  ],
  contact_touches: [
    touch('u-ana', 'c-e', 'call', '2026-10-20T18:00:00Z'), // the person she also emailed
    touch('u-ana', 'c-h', 'linkedin', '2026-10-20T18:30:00Z'),
    touch('u-ana', 'c-i', 'linkedin', '2026-10-20T19:00:00Z', 'due'),
    touch('u-leo', 'c-j', 'call', '2026-10-19T19:00:00Z'),
  ],
  contacted_leads: [
    { id: 'c-e', organization_id: ORG, user_id: 'u-ana', email: 'E@x.cl', sent_at: '2026-10-20T17:00:00Z' },
    { id: 'c-h', organization_id: ORG, user_id: 'u-ana', email: null, sent_at: null },
  ],
});

test('progress counts people and addresses once, inside the week', async () => {
  const { client } = memory(seed());
  const counts = await readGoalCounts(client, ORG, WEEK);
  assert.deepEqual(counts.get('u-ana'), { found: 2, contacted: 3 }); // a@ and b@ found; a@, e@ (email and call) and the LinkedIn touch c-h
  assert.deepEqual(counts.get('u-leo'), { found: 1, contacted: 1 });
  const ana = await readGoalCounts(client, ORG, WEEK, 'u-ana');
  assert.deepEqual([...ana.keys()], ['u-ana']);
});

test('without the touches table the goal counts the emails only', async () => {
  const { client } = memory(seed(), { missing: ['contact_touches'] });
  assert.deepEqual((await readGoalCounts(client, ORG, WEEK)).get('u-ana'), { found: 2, contacted: 2 });
});

test('the goal is the person\'s, else the team\'s, else the default; nothing before the migration', async () => {
  const data = seed();
  const { client, tables } = memory(data);
  assert.deepEqual(await readGoalSettings(client, ORG), { team: null, people: new Map() });
  assert.deepEqual(await readPersonGoal(client, { organizationId: ORG, userId: 'u-ana' }, WEEK), { targets: { contacted: 10, found: 15 }, source: 'default', counts: { found: 2, contacted: 3 } });
  tables.weekly_goals.push({ organization_id: ORG, user_id: null, contacted: 20, found: 25 }, { organization_id: ORG, user_id: 'u-leo', contacted: 5, found: 5 },
    { organization_id: 'org-2', user_id: null, contacted: 1, found: 1 });
  const team = await readTeamGoals(client, ORG, WEEK);
  assert.deepEqual(team('u-ana'), { targets: { contacted: 20, found: 25 }, source: 'team', counts: { found: 2, contacted: 3 } });
  assert.deepEqual(team('u-leo'), { targets: { contacted: 5, found: 5 }, source: 'person', counts: { found: 1, contacted: 1 } });
  assert.deepEqual(team('u-admin'), { targets: { contacted: 20, found: 25 }, source: 'team', counts: { contacted: 0, found: 0 } });
  const { client: before } = memory(seed(), { missing: ['weekly_goals'] });
  assert.deepEqual((await readPersonGoal(before, { organizationId: ORG, userId: 'u-ana' }, WEEK)).source, 'default');
});

test('contacts ready to write are the addresses nobody wrote to', async () => {
  const { client } = memory(seed());
  // a@ was written to by dispatch only, not in contacted_leads: «Hoy» counts contacted_leads, and so does the goal step.
  assert.equal(await readReadyToWrite(client, { organizationId: ORG, userId: 'u-ana' }), 3);
});

test('only owners and admins change the goals, and only for their members', async () => {
  const { client, tables } = memory(seed());
  await assert.rejects(saveGoalSettings(client, { organizationId: ORG, userId: 'u-ana' }, { team: { contacted: 5, found: 5 }, people: [] }), { status: 403 });
  await assert.rejects(saveGoalSettings(client, { organizationId: ORG, userId: 'u-admin' }, { team: { contacted: 5, found: 5 }, people: [{ userId: 'u-stranger', targets: { contacted: 1, found: 1 } }] }), { status: 400 });
  assert.equal(tables.weekly_goals.length, 0);

  await saveGoalSettings(client, { organizationId: ORG, userId: 'u-admin' }, { team: { contacted: 12, found: 18 }, people: [{ userId: 'u-leo', targets: { contacted: 3, found: 4 } }] });
  const rows = () => tables.weekly_goals.map(row => [row.user_id, row.contacted, row.found, row.set_by]);
  assert.deepEqual(rows(), [[null, 12, 18, 'u-admin'], ['u-leo', 3, 4, 'u-admin']]);
  // Saving again replaces: the team's goal changes and Leo goes back to it.
  await saveGoalSettings(client, { organizationId: ORG, userId: 'u-admin' }, { team: { contacted: 8, found: 10 }, people: [{ userId: 'u-ana', targets: { contacted: 15, found: 20 } }] });
  assert.deepEqual(rows(), [[null, 8, 10, 'u-admin'], ['u-ana', 15, 20, 'u-admin']]);
});

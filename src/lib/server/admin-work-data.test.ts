import assert from 'node:assert/strict';
import test from 'node:test';

import { loadAdminWork } from './admin-work-data';
import { memory } from './goals-alerts-test-fixtures';

const ORG = 'org-1';
// Saturday 24 October 2026, 13:00 in Chile.
const NOW = new Date('2026-10-24T16:00:00.000Z');
const PERIOD = { from: '2026-10-18', to: '2026-10-24' };

test('the report of an organization reads its people, opportunities and Cowork, and only theirs', async () => {
  const { client } = memory({
    organization_members: [{ organization_id: ORG, user_id: 'ana' }, { organization_id: ORG, user_id: 'diego' }, { organization_id: 'other', user_id: 'zoe' }],
    profiles: [{ id: 'ana', full_name: 'Ana Soto' }, { id: 'diego', full_name: null, email: 'diego@empresa.cl' }],
    opportunity_work: [{ organization_id: ORG, opportunity_id: 'o1', state: 'working', responsible_id: 'diego' }, { organization_id: ORG, opportunity_id: 'o2', state: 'won', responsible_id: 'ana' },
      { organization_id: 'other', opportunity_id: 'x1', state: 'working', responsible_id: 'zoe' }],
    commercial_opportunities: [{ organization_id: ORG, id: 'o1', deadline_at: '2026-10-21T15:00:00Z' }],
    opportunity_participants: [{ organization_id: ORG, opportunity_id: 'o1', user_id: 'diego' }],
    // The columns the server reads by path (data->>to, usage->>costUsd) are given here by their alias, as PostgREST answers them.
    opportunity_activity: [{ organization_id: ORG, actor_id: 'ana', kind: 'state', to: 'won', created_at: '2026-10-22T15:00:00Z' },
      { organization_id: ORG, actor_id: 'diego', kind: 'note', to: null, created_at: '2026-10-10T15:00:00Z' }],
    cowork_runs: [{ organization_id: ORG, id: 'r1', user_id: 'ana', root_run_id: null, created_at: '2026-10-23T12:00:00Z' }],
    cowork_model_calls: [{ organization_id: ORG, user_id: 'ana', created_at: '2026-10-23T12:00:10Z', cost: '0.04' }, { organization_id: ORG, user_id: 'ana', created_at: '2026-10-24T14:00:00Z', cost: null }],
    opportunity_budget_months: [{ organization_id: ORG, period: '2026-10-01', spent_micro_usd: 3_400_000 }],
  });
  const report = await loadAdminWork(client, { id: ORG, name: 'Yago' }, PERIOD, NOW);
  assert.deepEqual(report.period, PERIOD);
  assert.deepEqual([report.opportunities.inPlay, report.opportunities.overdue, report.opportunities.won], [1, 1, 1], 'another organization never counts');
  assert.deepEqual(report.opportunities.people.map(person => [person.name, person.open, person.actions]), [['Ana Soto', 0, 1], ['diego@empresa.cl', 1, 0]],
    'whoever has no name yet goes by their email');
  assert.deepEqual([report.cowork.turns, Number(report.cowork.costUsd.toFixed(2)), report.cowork.unknownCost], [1, 0.04, 1]);
  assert.deepEqual(report.caps.find(cap => cap.id === 'opportunities')?.used, 3.4);
  assert.equal(report.caps.find(cap => cap.id === 'cowork')?.used, 1, 'today: one call of Ana');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_DAILY_CALLS, lastDays, workReport, type WorkReportInput } from './work';

// Saturday 24 October 2026, 13:00 in Chile; the period is the last 7 days.
const NOW = new Date('2026-10-24T16:00:00.000Z');
const base: WorkReportInput = {
  people: [{ id: 'ana', name: 'Ana Soto' }, { id: 'diego', name: 'Diego Paz' }, { id: 'maria', name: 'María Rojas' }],
  ...lastDays(7, NOW), now: NOW,
  work: [], participants: [], activity: [], waiting: 0, runs: [], calls: [], callsToday: [],
  budget: { spent: 3.4, cap: 20 }, credits: { used: 120, limit: 450 },
};

test('the period is the last days in Chile, today included', () => {
  assert.deepEqual(lastDays(7, NOW), { from: '2026-10-18', to: '2026-10-24' });
});

test('opportunities: what is in play, what passed its deadline, how the period ended and who worked them', () => {
  const report = workReport({ ...base, waiting: 2,
    work: [
      { opportunityId: 'o1', state: 'working', responsibleId: 'diego', deadlineAt: '2026-10-30T15:00:00Z' },
      { opportunityId: 'o2', state: 'assigned', responsibleId: 'diego', deadlineAt: '2026-10-20T15:00:00Z' },
      { opportunityId: 'o3', state: 'won', responsibleId: 'ana', deadlineAt: '2026-10-10T15:00:00Z' },
    ],
    participants: [{ opportunityId: 'o1', userId: 'diego' }, { opportunityId: 'o2', userId: 'diego' }, { opportunityId: 'o3', userId: 'ana' }],
    activity: [
      { actorId: 'ana', kind: 'state', to: 'won', createdAt: '2026-10-22T15:00:00Z' },
      { actorId: 'diego', kind: 'auto_state', to: 'submitted', createdAt: '2026-10-21T15:00:00Z' },
      { actorId: 'diego', kind: 'note', createdAt: '2026-10-23T15:00:00Z' },
      { actorId: 'diego', kind: 'state', to: 'lost', createdAt: '2026-10-01T15:00:00Z' },
    ] });
  const { people, ...summary } = report.opportunities;
  assert.deepEqual(summary, { inPlay: 2, overdue: 1, submitted: 1, won: 1, lost: 0, waiting: 2, activePeople: 2 });
  assert.deepEqual(people.map(person => [person.name, person.open, person.actions, person.submitted, person.won]), [['Diego Paz', 2, 2, 1, 0], ['Ana Soto', 0, 1, 0, 1]],
    'María did nothing: she is not listed; what Diego did before the period does not count');
});

test('Cowork: conversations, turns and cost of the period by person, and the cost not known is said apart', () => {
  const report = workReport({ ...base,
    runs: [
      { id: 'r1', userId: 'ana', rootRunId: null, createdAt: '2026-10-23T12:00:00Z' },
      { id: 'r2', userId: 'ana', rootRunId: 'r1', createdAt: '2026-10-23T12:05:00Z' },
      { id: 'r3', userId: 'maria', rootRunId: null, createdAt: '2026-10-24T13:00:00Z' },
      { id: 'r0', userId: 'diego', rootRunId: null, createdAt: '2026-10-02T13:00:00Z' },
    ],
    calls: [{ userId: 'ana', createdAt: '2026-10-23T12:00:10Z', costUsd: 0.012 }, { userId: 'ana', createdAt: '2026-10-23T12:05:10Z', costUsd: 0.008 },
      { userId: 'maria', createdAt: '2026-10-24T13:00:10Z', costUsd: null }],
    callsToday: [{ userId: 'maria' }, { userId: 'maria' }, { userId: 'ana' }] });
  const { people, ...summary } = report.cowork;
  assert.deepEqual({ ...summary, costUsd: Number(summary.costUsd.toFixed(3)) }, { conversations: 2, turns: 3, activePeople: 2, costUsd: 0.02, unknownCost: 1 });
  assert.deepEqual(people.map(person => [person.name, person.conversations, person.turns, Number(person.costUsd.toFixed(3))]), [['Ana Soto', 1, 2, 0.02], ['María Rojas', 1, 1, 0]]);
  const cowork = report.caps.find(cap => cap.id === 'cowork')!;
  assert.deepEqual([cowork.used, cowork.limit], [2, COWORK_DAILY_CALLS]);
  assert.match(cowork.detail, /^Quien más lo usó hoy, María Rojas, lleva 2 de 300 llamadas/);
});

test('the three budgets side by side, in words; without the credits read, two', () => {
  const report = workReport(base);
  assert.deepEqual(report.caps.map(cap => [cap.id, cap.used, cap.limit]), [['opportunities', 3.4, 20], ['cowork', 0, 300], ['credits', 120, 450]]);
  assert.equal(report.caps[0].detail, 'US$3,40 de US$20,00: búsquedas, informes y borradores de toda la empresa.');
  assert.match(report.caps[1].detail, /^Nadie lo usó hoy\./);
  assert.deepEqual(workReport({ ...base, credits: null }).caps.map(cap => cap.id), ['opportunities', 'cowork']);
});

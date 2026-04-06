import test from 'node:test';
import assert from 'node:assert/strict';

const missionGoals = await import('../src/lib/antonia-mission-goals.ts');

test('buildMissionGoalSummary creates outcome-based summary', () => {
  const summary = missionGoals.buildMissionGoalSummary({
    targetOutcome: 'meetings',
    targetMeetings: 7,
    targetTimelineDays: 30,
    jobTitle: 'Gerente de RRHH',
    industry: 'Retail',
    location: 'Chile',
    valueProposition: 'Reducir rotacion y cubrir dotacion mas rapido.',
  });

  assert.match(summary, /7 reuniones/i);
  assert.match(summary, /30 dias/i);
  assert.match(summary, /Gerente de RRHH/i);
  assert.match(summary, /Retail/i);
});

test('computeMissionGoalProgress evaluates meetings goal correctly', () => {
  const progress = missionGoals.computeMissionGoalProgress(
    { targetOutcome: 'meetings', targetMeetings: 5 },
    { meetings: 2 }
  );

  assert.equal(progress.label, 'Reuniones');
  assert.equal(progress.target, 5);
  assert.equal(progress.achieved, 2);
  assert.equal(progress.gap, 3);
  assert.equal(progress.status, 'on_track');
});

test('computeMissionGoalProgress evaluates positive replies goal correctly', () => {
  const progress = missionGoals.computeMissionGoalProgress(
    { targetOutcome: 'positive_replies', targetPositiveReplies: 10 },
    { positiveReplies: 1 }
  );

  assert.equal(progress.label, 'Respuestas positivas');
  assert.equal(progress.status, 'at_risk');
});

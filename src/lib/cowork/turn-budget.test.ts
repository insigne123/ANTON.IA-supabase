import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_MAX_COORDINATOR_CALLS, COWORK_TURN_DEFAULTS, coworkTurnCeiling } from './turn-budget';

test('the turn ceiling comes from the environment, bounded to what the worker and the database allow', () => {
  assert.deepEqual(coworkTurnCeiling({}), COWORK_TURN_DEFAULTS);
  assert.deepEqual(coworkTurnCeiling({ COWORK_MAX_DECISIONS_PER_TURN: '4', COWORK_MAX_READS_PER_TURN: '3', COWORK_TURN_SOFT_DEADLINE_SECONDS: '45' }),
    { decisions: 4, reads: 3, softDeadlineMs: 45_000 });
  // The database admits five coordinator calls per run; the worker's deadline leaves 75 s at most.
  assert.deepEqual(coworkTurnCeiling({ COWORK_MAX_DECISIONS_PER_TURN: '12', COWORK_MAX_READS_PER_TURN: '40', COWORK_TURN_SOFT_DEADLINE_SECONDS: '120' }),
    { decisions: COWORK_MAX_COORDINATOR_CALLS, reads: 9, softDeadlineMs: 75_000 });
  assert.deepEqual(coworkTurnCeiling({ COWORK_MAX_DECISIONS_PER_TURN: '1', COWORK_MAX_READS_PER_TURN: '0', COWORK_TURN_SOFT_DEADLINE_SECONDS: '5' }),
    { decisions: 2, reads: 1, softDeadlineMs: 20_000 });
  // A value that is not a number keeps the default.
  assert.deepEqual(coworkTurnCeiling({ COWORK_MAX_DECISIONS_PER_TURN: 'muchas', COWORK_MAX_READS_PER_TURN: ' ' }), COWORK_TURN_DEFAULTS);
});

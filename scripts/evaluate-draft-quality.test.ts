import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDraftQuality } from './evaluate-draft-quality';

test('six service comparison measures context availability honestly and exercises grounded guards', () => {
  const evaluation = evaluateDraftQuality();
  assert.equal(evaluation.liveLlmCalls, 0);
  assert.equal(evaluation.rows.length, 6);
  assert.equal(evaluation.rows.filter((row) => row.baselineCoverage.role).length, 0);
  assert.equal(evaluation.rows.filter((row) => row.baselineCoverage.priorBody).length, 0);
  assert.equal(evaluation.rows.filter((row) => row.baselineCoverage.capability).length, 4);
  for (const row of evaluation.rows) {
    assert.ok(Object.values(row.newCoverage).every(Boolean), row.service);
    assert.ok(row.baselineCoverage.fact, row.service);
    assert.ok(row.handwrittenPositivePassed, JSON.stringify(row));
    assert.ok(row.attacks.every((attack) => attack.blockedForExpectedReason), JSON.stringify(row));
  }
});

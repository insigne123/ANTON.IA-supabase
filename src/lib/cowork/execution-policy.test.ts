import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCoworkModeAvailable, coworkExecutionPolicy } from './execution-policy';

test('autonomy is disabled by server policy and never grants note writes', () => {
  assert.throws(() => assertCoworkModeAvailable('autonomous', false), /UNAVAILABLE/);
  assert.equal(coworkExecutionPolicy('autonomous', false).automaticExternalSearch, false);
  assert.equal(coworkExecutionPolicy('approval', true).automaticExternalSearch, false);
  const policy = coworkExecutionPolicy('autonomous', true);
  assert.equal(policy.automaticExternalSearch, true);
  assert.equal(policy.maxExternalSearchesPerRun, 1);
  assert.equal(policy.maxExternalResults, 25);
  assert.equal(policy.noteRequiresApproval, true);
});

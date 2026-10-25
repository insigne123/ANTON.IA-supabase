import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkAutoRetryDue } from './auto-retry';

test('only a fresh failure of the model service is retried by itself, once in a while (COW-22)', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const at = '2026-10-24T11:59:30Z';
  assert.equal(coworkAutoRetryDue({ category: 'model_timeout' }, at, now, null), true);
  assert.equal(coworkAutoRetryDue({ category: 'model_rate_limit' }, at, now, null), true);
  assert.equal(coworkAutoRetryDue({ category: 'model_unavailable' }, at, now, null), true);
  assert.equal(coworkAutoRetryDue({ category: 'model_budget_conversation' }, at, now, null), false, 'a limit is not passing');
  assert.equal(coworkAutoRetryDue({ category: 'model_quota' }, at, now, null), false, 'an account without credits is not passing');
  assert.equal(coworkAutoRetryDue({ category: 'unknown' }, at, now, null), false);
  assert.equal(coworkAutoRetryDue({ category: 'model_timeout' }, '2026-10-24T11:50:00Z', now, null), false, 'reopened later: the person decides');
  assert.equal(coworkAutoRetryDue({ category: 'model_timeout' }, at, now, now - 60_000), false, 'it failed again right after the retry');
  assert.equal(coworkAutoRetryDue({ category: 'model_timeout' }, at, now, now - 10 * 60_000), true);
  assert.equal(coworkAutoRetryDue(null, at, now, null), false);
});

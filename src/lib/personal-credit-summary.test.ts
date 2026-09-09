import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCreditStatus, personalCreditSummary } from './personal-credit-summary';

test('hybrid mode shows the personal allowance even when team quota binds', () => {
  assert.deepEqual(personalCreditSummary({
    mode: 'hybrid', binding: 'team', count: 100, limit: 100,
    user: { count: 11, limit: 50 }, team: { count: 100, limit: 100 },
  }), { used: 11, limit: 50, remaining: 39 });
});

test('team-only and missing hybrid personal buckets never become personal credits', () => {
  assert.equal(personalCreditSummary({ mode: 'team', binding: 'team', count: 11, limit: 500 }), null);
  assert.equal(personalCreditSummary({ mode: 'hybrid', binding: 'team', count: 11, limit: 500 }), null);
});

test('legacy personal and zero allowances remain valid without negative remaining', () => {
  assert.deepEqual(personalCreditSummary({ count: 11, limit: 50 }), { used: 11, limit: 50, remaining: 39 });
  assert.deepEqual(personalCreditSummary({ count: 11, limit: 0 }), { used: 11, limit: 0, remaining: 0 });
});

test('invalid responses are errors rather than invented zero balances', () => {
  for (const value of [undefined, {}, { count: -1, limit: 50 }, { count: 1, limit: '50' }, { count: 1, limit: 50, user: {} }]) {
    assert.throws(() => parseCreditStatus(value), /INVALID_CREDIT_STATUS/);
  }
});

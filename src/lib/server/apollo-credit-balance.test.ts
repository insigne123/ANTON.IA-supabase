import assert from 'node:assert/strict';
import test from 'node:test';

import { parseApolloCreditBalance } from './apollo-credit-balance';

test('Apollo balance prefers the latest team lead-credit cycle', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    usage: { creditUsage: { lead_credit: { limit: 3500, consumed: 3059, left_over: 441 } } },
    cycle_end: '2026-09-06T19:01:06.000Z',
    captured_at: '2026-08-24T23:00:03.906Z',
  }, {
    scope_type: 'user',
    usage: { creditFields: { num_credits_remaining: 400, effective_num_lead_credits: 3500 } },
    captured_at: '2026-08-24T23:00:03.906Z',
  }]);

  assert.deepEqual(balance, {
    remaining: 441,
    used: 2059,
    limit: 2500,
    cycleEnd: '2026-09-06T19:01:06.000Z',
    capturedAt: '2026-08-24T23:00:03.906Z',
  });
});

test('Apollo balance falls back to user credit fields', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'user',
    usage: { creditFields: { num_credits_remaining: 569, effective_num_lead_credits: 3500 } },
    cycle_end: '2026-09-06T19:01:06.000Z',
    captured_at: '2026-08-24T22:00:04.596Z',
  }]);

  assert.equal(balance?.remaining, 569);
  assert.equal(balance?.used, 1931);
  assert.equal(balance?.limit, 2500);
});

test('Apollo balance rejects incomplete snapshots', () => {
  assert.equal(parseApolloCreditBalance([{ scope_type: 'team', usage: {} }]), null);
  assert.equal(parseApolloCreditBalance([{
    scope_type: 'team',
    usage: { creditUsage: { lead_credit: { limit: null, left_over: null } } },
    captured_at: '2026-08-24T23:00:03.906Z',
  }]), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { isApolloCreditBalanceStale, parseApolloCreditBalance } from './apollo-credit-balance';

test('Apollo balance parses the legacy team payload', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-1',
    usage: { creditUsage: { lead_credit: { limit: 3_500, consumed: 3_059, left_over: 441 } } },
    cycle_end: '2026-09-06T19:01:06.000Z',
    captured_at: '2026-09-02T10:00:00.000Z',
  }]);

  assert.deepEqual(balance, {
    remaining: 441,
    used: 2_059,
    limit: 2_500,
    cycleEnd: '2026-09-06T19:01:06.000Z',
    capturedAt: '2026-09-02T10:00:00.000Z',
  });
});

test('Apollo balance parses the current gateway team payload including zero credits', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-1',
    usage: { creditUsage: { team_id: 'team-1', credits_used: 2_500, credits_remaining: 0 } },
    captured_at: '2026-09-02T11:00:00.000Z',
  }]);

  assert.equal(balance?.remaining, 0);
  assert.equal(balance?.used, 2_500);
});

test('Apollo balance parses the official nested credit usage payload', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-1',
    usage: {
      creditUsage: {
        credit_usage_stats: {
          lead_credit: { limit: 2_515, consumed: 17, left_over: 2_498 },
          direct_dial_credit: { limit: 2_500, consumed: 2_500, left_over: 0 },
        },
        current_credit_cycle: {
          start_date: '2026-09-01T20:17:52.000+00:00',
          end_date: '2026-10-01T20:17:52.000+00:00',
        },
      },
    },
    captured_at: '2026-09-03T00:00:00.000Z',
  }]);

  assert.deepEqual(balance, {
    remaining: 2_498,
    used: 2,
    limit: 2_500,
    cycleEnd: '2026-10-01T20:17:52.000+00:00',
    capturedAt: '2026-09-03T00:00:00.000Z',
  });
});

test('Apollo balance supports profile credit fields when team data is incomplete', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-1',
    usage: { creditUsage: {} },
    captured_at: '2026-09-02T11:00:00.000Z',
  }, {
    scope_type: 'user',
    provider_account_id: 'team-1',
    usage: { profileCreditUsage: { num_credits_remaining: 569, effective_num_lead_credits: 3_500 } },
    captured_at: '2026-09-02T11:00:00.000Z',
  }]);

  assert.equal(balance?.remaining, 569);
  assert.equal(balance?.used, 1_931);
});

test('Apollo balance never combines shared accounts', () => {
  const balance = parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-new',
    usage: { creditUsage: {} },
    captured_at: '2026-09-02T12:00:00.000Z',
  }, {
    scope_type: 'team',
    provider_account_id: 'team-old',
    usage: { creditUsage: { credits_remaining: 800, credits_used: 1_700 } },
    captured_at: '2026-09-02T11:00:00.000Z',
  }]);

  assert.equal(balance, null);
  assert.equal(parseApolloCreditBalance([{
    scope_type: 'team',
    provider_account_id: 'team-old',
    usage: { creditUsage: { credits_remaining: 800, credits_used: 1_700 } },
    captured_at: '2026-09-02T11:00:00.000Z',
  }], 'team-old')?.remaining, 800);
});

test('Apollo balance rejects incomplete snapshots and identifies stale values', () => {
  assert.equal(parseApolloCreditBalance([{ scope_type: 'team', usage: {} }]), null);
  assert.equal(isApolloCreditBalanceStale(
    { capturedAt: '2026-09-02T10:00:00.000Z' },
    Date.parse('2026-09-02T12:00:01.000Z'),
  ), true);
});

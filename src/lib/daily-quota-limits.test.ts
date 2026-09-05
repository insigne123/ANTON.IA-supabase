import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DAILY_CREDIT_LIMIT, DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';

test('account credits share a 50-operation daily limit while contacts remain separate', () => {
  assert.equal(DEFAULT_DAILY_CREDIT_LIMIT, 50);
  assert.deepEqual(DEFAULT_DAILY_QUOTA_LIMITS, {
    leadSearch: 50,
    enrich: 50,
    research: 50,
    contact: 100,
  });
});

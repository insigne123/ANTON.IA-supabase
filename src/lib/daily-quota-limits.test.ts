import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';

test('default account quotas allow 100 daily operations per resource', () => {
  assert.deepEqual(DEFAULT_DAILY_QUOTA_LIMITS, {
    leadSearch: 100,
    enrich: 100,
    research: 100,
    contact: 100,
  });
});

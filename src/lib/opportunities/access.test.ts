import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveOpportunitiesEnabled } from './access';

test('opportunities stay in maintenance unless explicitly enabled', () => {
  assert.equal(resolveOpportunitiesEnabled(), false);
  assert.equal(resolveOpportunitiesEnabled('false'), false);
  assert.equal(resolveOpportunitiesEnabled('true'), true);
  assert.equal(resolveOpportunitiesEnabled(' TRUE '), true);
});

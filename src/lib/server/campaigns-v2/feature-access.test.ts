import assert from 'node:assert/strict';
import test from 'node:test';

import { campaignV2CreatorAccessDecision } from './access-policy';

test('Campaign V2 mutations fail closed when the organization feature is disabled', () => {
  assert.equal(campaignV2CreatorAccessDecision({ enabled: false, creatorId: 'creator', userId: 'creator' }), 'not_found');
});

test('Campaign V2 mutations are creator-owned', () => {
  assert.equal(campaignV2CreatorAccessDecision({ enabled: true, creatorId: 'creator', userId: 'member' }), 'forbidden');
  assert.equal(campaignV2CreatorAccessDecision({ enabled: true, creatorId: 'creator', userId: 'creator' }), 'allowed');
});

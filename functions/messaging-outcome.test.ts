import test from 'node:test';
import assert from 'node:assert/strict';

import { getMessagingOutcomeEffects } from './messaging-outcome';

test('dry run has no durable sent-message effects', () => {
  assert.deepEqual(getMessagingOutcomeEffects({ dryRun: true, outcome: 'sent' }), {
    receiptStatus: 'dry_run',
    contactedCountDelta: 0,
    insertContactedLead: false,
    updateCampaignSentRecords: false,
    markLeadContacted: false,
    allowLeadStatusMutation: false,
  });
});

test('accepted live send enables all sent-message effects', () => {
  assert.deepEqual(getMessagingOutcomeEffects({ dryRun: false, outcome: 'sent' }), {
    receiptStatus: 'sent',
    contactedCountDelta: 1,
    insertContactedLead: true,
    updateCampaignSentRecords: true,
    markLeadContacted: true,
    allowLeadStatusMutation: true,
  });
});

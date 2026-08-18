import test from 'node:test';
import assert from 'node:assert/strict';

import { getCampaignReference, getCurrentCampaignFollowUp } from './campaign-followup';

test('campaign reference prefers the originating contacted lead campaign id', () => {
  assert.deepEqual(getCampaignReference({
    contactedLead: { campaign_id: 'campaign-contacted', data: { campaign_name: 'Origin campaign' } },
    lead: { campaignId: 'campaign-lead', campaignName: 'Lead campaign' },
    taskPayload: { campaignId: 'campaign-task', campaignName: 'Task campaign' },
  }), {
    campaignId: 'campaign-contacted',
    campaignName: 'Origin campaign',
  });
});

test('follow-up uses the same contacted-lead dispatch key as the campaign cron', () => {
  const steps = [{ name: 'Initial' }, { name: 'Follow-up' }];
  const result = getCurrentCampaignFollowUp({
    campaignId: 'campaign-1',
    contactedLeadId: 'contacted-1',
    leadId: 'lead-1',
    steps,
    sentRecords: { 'lead-1': { lastStepIdx: 0 } },
  });

  assert.equal(result.sentRecordKey, 'lead-1');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.step, steps[1]);
  assert.equal(result.idempotencyKey, 'campaign:campaign-1:contacted-1:step:1');
});

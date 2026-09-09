import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignAttemptAllowsRetry, describeCampaignFailure, withSentAttemptsAsDeliveries, type CampaignAttempt } from './bulk-campaign-attempts';

test('retry policy fails closed for attention, missing and invalid retry dates', () => {
  const attempt: CampaignAttempt = { draft_id: 'draft', state: 'retry_wait', code: 'quota', message: 'Wait', retry_at: null, updated_at: null };
  assert.equal(campaignAttemptAllowsRetry(attempt), false);
  assert.equal(campaignAttemptAllowsRetry({ ...attempt, retry_at: 'invalid' }), false);
  assert.equal(campaignAttemptAllowsRetry({ ...attempt, retry_at: '2026-09-10T00:00:00Z' }, Date.parse('2026-09-11')), true);
  assert.equal(campaignAttemptAllowsRetry({ ...attempt, state: 'attention', retry_at: '2026-09-10T00:00:00Z' }, Date.parse('2026-09-11')), false);
});
test('blocked contact needs attention; infrastructure failure is retryable and does not expose raw errors', () => {
  assert.equal(describeCampaignFailure('BULK_CAMPAIGN_CONTACT_BLOCKED').retryable, false);
  assert.equal(describeCampaignFailure('BULK_CAMPAIGN_ALREADY_SENT').retryable, false);
  assert.equal(describeCampaignFailure('provider_connection_unavailable').retryable, true);
  const raw = 'secret-token-in-provider-error';
  assert.equal(describeCampaignFailure(raw).message.includes(raw), false);
});
test('sent markers merge as sent deliveries without duplicating live rows', () => {
  const merged = withSentAttemptsAsDeliveries(
    [{ draft_id: 'live', status: 'sent', completed_at: '2026-09-01T00:00:00Z', error_message: null }],
    [
      { draft_id: 'live', state: 'sent', code: 'sent', message: 'ok', retry_at: null, updated_at: '2026-09-01T00:00:00Z' },
      { draft_id: 'retained', state: 'sent', code: 'sent', message: 'ok', retry_at: null, updated_at: '2026-09-02T00:00:00Z' },
      { draft_id: 'waiting', state: 'retry_wait', code: 'quota', message: 'wait', retry_at: '2026-09-03T00:00:00Z', updated_at: null },
    ],
  );
  assert.deepEqual(merged.map(row => row.draft_id), ['live', 'retained']);
  assert.equal(merged[1].status, 'sent');
  assert.equal(merged[1].completed_at, '2026-09-02T00:00:00Z');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRMED_SEND_COPY, attemptsConfirmedSent, bulkCampaignIdFromDispatchKey, campaignAttemptAllowsRetry, describeCampaignFailure, withConfirmedSends, withSentAttemptsAsDeliveries, type CampaignAttempt } from './bulk-campaign-attempts';

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

test('an Outlook send confirmed after its attempt reads as sent, and only that one (9 Nov 2026: 15 in production)', () => {
  const attempts: CampaignAttempt[] = [
    { draft_id: 'outlook', state: 'attention', code: 'invalid_provider_response', message: 'El envío está pendiente de confirmación. No se repetirá automáticamente.', retry_at: null, updated_at: null },
    { draft_id: 'quota', state: 'retry_wait', code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario.', retry_at: '2026-11-10T12:00:00Z', updated_at: null },
    { draft_id: 'failed', state: 'attention', code: 'never_sent', message: 'No salió.', retry_at: null, updated_at: null },
    { draft_id: 'done', state: 'sent', code: 'sent', message: CONFIRMED_SEND_COPY, retry_at: null, updated_at: null },
  ];
  const deliveries = [
    { draft_id: 'outlook', status: 'sent' }, { draft_id: 'failed', status: 'failed' }, { draft_id: 'done', status: 'sent' },
  ];
  assert.deepEqual(attemptsConfirmedSent(attempts, deliveries).map(attempt => attempt.draft_id), ['outlook']);
  const read = withConfirmedSends(attempts, deliveries);
  assert.deepEqual(read[0], { ...attempts[0], state: 'sent', code: 'sent', message: CONFIRMED_SEND_COPY, retry_at: null });
  assert.deepEqual(read.slice(1), attempts.slice(1), 'a wait, a failure and a confirmed send stay as they are');
  // Once retention removes the dispatch, the corrected attempt is what still says the e-mail went out.
  assert.deepEqual(withSentAttemptsAsDeliveries([], read).map(row => row.draft_id), ['outlook', 'done']);
});

test('the campaign of a bulk send is read from its dispatch key, and only from a bulk key', () => {
  const campaign = '60000000-0000-4000-8000-000000000001';
  const draft = '20000000-0000-4000-8000-000000000001';
  assert.equal(bulkCampaignIdFromDispatchKey(`bulk:${campaign}:${draft}`), campaign);
  assert.equal(bulkCampaignIdFromDispatchKey(`campaign:${campaign}:contact-1:step:0`), null);
  assert.equal(bulkCampaignIdFromDispatchKey('manual:ada'), null);
  assert.equal(bulkCampaignIdFromDispatchKey(`bulk:${draft}`), null);
  assert.equal(bulkCampaignIdFromDispatchKey(null), null);
});

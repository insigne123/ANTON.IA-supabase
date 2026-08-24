import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOpportunitySendRequests,
  reconcileOpportunitySendResults,
  sendOpportunityRequestsSequentially,
} from '@/lib/opportunity-bulk-send';

const drafts = [
  { recipientId: 'lead-1', email: 'one@example.com', subject: 'One', body: 'Hello one' },
  { recipientId: 'lead-2', email: 'two@example.com', subject: 'Two', body: 'Hello two' },
];

test('builds stable recipient keys within one compose and distinct keys across composes', () => {
  const first = buildOpportunitySendRequests({ composeId: 'compose-1', provider: 'gmail', drafts });
  const retry = buildOpportunitySendRequests({ composeId: 'compose-1', provider: 'gmail', drafts });
  const nextCompose = buildOpportunitySendRequests({ composeId: 'compose-2', provider: 'gmail', drafts });

  assert.equal(first[0].idempotencyKey, retry[0].idempotencyKey);
  assert.notEqual(first[0].idempotencyKey, first[1].idempotencyKey);
  assert.notEqual(first[0].idempotencyKey, nextCompose[0].idempotencyKey);
});

test('rotates an opportunity recipient key when composed content changes', () => {
  const first = buildOpportunitySendRequests({ composeId: 'compose-1', provider: 'gmail', drafts });
  const changed = buildOpportunitySendRequests({
    composeId: 'compose-1',
    provider: 'gmail',
    drafts: [{ ...drafts[0], body: 'Revised body' }],
  });

  assert.notEqual(first[0].idempotencyKey, changed[0].idempotencyKey);
});

test('sends requests sequentially and preserves failed recipients for retry', async () => {
  const requests = buildOpportunitySendRequests({ composeId: 'compose-1', provider: 'outlook', drafts });
  const order: string[] = [];
  const receipts = await sendOpportunityRequestsSequentially(requests, async (request) => {
    order.push(`start:${request.recipientId}`);
    if (request.recipientId === 'lead-2') throw new Error('provider rejected');
    order.push(`end:${request.recipientId}`);
    return { status: 'sent', receipt: { providerMessageId: 'message-1' } };
  });

  assert.deepEqual(order, ['start:lead-1', 'end:lead-1', 'start:lead-2']);
  assert.deepEqual(receipts.map((receipt) => receipt.status), ['sent', 'failed']);

  const reconciled = reconcileOpportunitySendResults(drafts, receipts);
  assert.equal(reconciled.sentCount, 1);
  assert.equal(reconciled.failedCount, 1);
  assert.deepEqual(reconciled.failedDrafts.map((draft) => draft.recipientId), ['lead-2']);
});

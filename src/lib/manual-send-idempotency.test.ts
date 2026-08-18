import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManualEmailOperation,
  resolveManualEmailOperation,
} from '@/lib/manual-send-idempotency';

const payload = {
  scope: 'manual-compose',
  recipientId: 'lead-1',
  email: 'one@example.com',
  subject: 'Hello',
  body: 'First message',
  provider: 'outlook',
  deliveryOptions: { pixel: true, links: false, readReceipt: false },
};

test('keeps one operation key across an unchanged manual retry', () => {
  let generated = 0;
  const createOperationId = () => `operation-${++generated}`;
  const first = resolveManualEmailOperation(null, payload, createOperationId);
  const retry = resolveManualEmailOperation(first, { ...payload }, createOperationId);

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.trackingId, first.trackingId);
  assert.equal(generated, 1);
});

test('rotates for changed content, recipient, and a new compose after success', () => {
  let generated = 0;
  const createOperationId = () => `operation-${++generated}`;
  const first = resolveManualEmailOperation(null, payload, createOperationId);
  const changedContent = resolveManualEmailOperation(first, { ...payload, body: 'Revised message' }, createOperationId);
  const changedRecipient = resolveManualEmailOperation(first, { ...payload, email: 'two@example.com' }, createOperationId);
  const changedScope = resolveManualEmailOperation(first, { ...payload, scope: 'another-compose' }, createOperationId);
  const nextCompose = resolveManualEmailOperation(null, payload, createOperationId);

  assert.notEqual(changedContent.idempotencyKey, first.idempotencyKey);
  assert.notEqual(changedRecipient.idempotencyKey, first.idempotencyKey);
  assert.notEqual(changedScope.idempotencyKey, first.idempotencyKey);
  assert.notEqual(nextCompose.idempotencyKey, first.idempotencyKey);
});

test('builds stable and distinct per-recipient keys within a bulk operation', () => {
  const first = buildManualEmailOperation('batch-1', { ...payload, scope: 'enriched-bulk' });
  const retry = buildManualEmailOperation('batch-1', { ...payload, scope: 'enriched-bulk' });
  const secondRecipient = buildManualEmailOperation('batch-1', {
    ...payload,
    scope: 'enriched-bulk',
    recipientId: 'lead-2',
    email: 'two@example.com',
  });
  const nextBatch = buildManualEmailOperation('batch-2', { ...payload, scope: 'enriched-bulk' });

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.trackingId, first.trackingId);
  assert.notEqual(secondRecipient.idempotencyKey, first.idempotencyKey);
  assert.notEqual(nextBatch.idempotencyKey, first.idempotencyKey);
});

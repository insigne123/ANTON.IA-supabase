import assert from 'node:assert/strict';
import test from 'node:test';

import { SupliaRuntimeError } from '@/lib/suplia/runtime';
import {
  classifySupliaBulkRecipientError,
  SupliaDeliveryReconciliationError,
  SupliaRecipientDeliveryError,
  throwForIncompleteSupliaBulkOutcomes,
  type SupliaBulkRecipientOutcome,
} from './suplia-bulk-send-outcomes';

const now = Date.parse('2026-08-13T12:00:00.000Z');

test('bulk recipient aggregation preserves deferred recipients and retry time', () => {
  const sent: SupliaBulkRecipientOutcome = { status: 'sent', to: 'sent@example.com', index: 0 };
  const deferred = classifySupliaBulkRecipientError(new SupliaRuntimeError('deferred', 'quota', {
    retryAfterMs: 60_000,
    metadata: { dispatchId: 'dispatch-2', code: 'daily_quota_exceeded' },
  }), { to: 'later@example.com', index: 1 }, now);

  assert.throws(
    () => throwForIncompleteSupliaBulkOutcomes([sent, deferred], now),
    (error: any) => {
      assert.equal(error instanceof SupliaRuntimeError, true);
      assert.equal(error.code, 'deferred');
      assert.equal(error.metadata.retryAt, '2026-08-13T12:01:00.000Z');
      assert.equal(error.metadata.recipientDetails[0].to, 'later@example.com');
      assert.equal(error.metadata.summary.sent, 1);
      return true;
    },
  );
});

test('unknown recipient outcomes require reconciliation instead of reporting completion', () => {
  const unknown = classifySupliaBulkRecipientError(new SupliaRecipientDeliveryError('unknown', 'provider outcome unknown: fetch failed', {
    dispatchId: 'dispatch-unknown',
    code: 'provider_outcome_unknown',
  }), { to: 'unknown@example.com', index: 0 }, now);

  assert.throws(
    () => throwForIncompleteSupliaBulkOutcomes([unknown], now),
    (error: any) => {
      assert.equal(error instanceof SupliaDeliveryReconciliationError, true);
      assert.equal(error.metadata.requiresReconciliation, true);
      assert.equal(error.metadata.recipientDetails[0].dispatchId, 'dispatch-unknown');
      return true;
    },
  );
});

test('confirmed permanent rejects remain non-retryable partial outcomes', () => {
  const rejected = classifySupliaBulkRecipientError(new SupliaRecipientDeliveryError('rejected', 'mailbox rejected'), {
    to: 'bad@example.com',
    index: 0,
  }, now);

  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.retryExpected, false);
  assert.doesNotThrow(() => throwForIncompleteSupliaBulkOutcomes([rejected], now));
});

test('untyped recipient failures are ambiguous and require reconciliation', () => {
  const unknown = classifySupliaBulkRecipientError(new Error('unexpected persistence failure'), {
    to: 'ambiguous@example.com',
    index: 0,
  }, now);

  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.requiresReconciliation, true);
});

test('unknown outcomes block automatic retry even when another recipient is deferred', () => {
  const deferred = classifySupliaBulkRecipientError(new SupliaRuntimeError('deferred', 'quota', {
    retryAfterMs: 60_000,
  }), { to: 'later@example.com', index: 0 }, now);
  const unknown = classifySupliaBulkRecipientError(new Error('provider outcome unknown'), {
    to: 'unknown@example.com',
    index: 1,
  }, now);

  assert.throws(
    () => throwForIncompleteSupliaBulkOutcomes([deferred, unknown], now),
    (error: any) => {
      assert.equal(error instanceof SupliaDeliveryReconciliationError, true);
      assert.equal(error.metadata.retryAt, '2026-08-13T12:01:00.000Z');
      assert.equal(error.metadata.recipientDetails.length, 2);
      return true;
    },
  );
});

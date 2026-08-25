import assert from 'node:assert/strict';
import test from 'node:test';

import { mapDurableSendReceipt } from './outbound-send-receipt';

test('maps a non-success response when it contains a durable dispatch receipt', () => {
  const result = mapDurableSendReceipt({
    success: false,
    status: 'deferred',
    error: 'Límite diario alcanzado',
    receipt: {
      dispatchId: 'dispatch-1',
      status: 'deferred',
      replayed: true,
      providerMessageId: null,
      errorCode: 'daily_quota_exceeded',
      retry: {
        retryable: true,
        phase: 'pre_provider',
        retryAt: '2026-08-26T00:00:00.000Z',
      },
    },
  });

  assert.deepEqual(result, {
    dispatchId: 'dispatch-1',
    status: 'deferred',
    replayed: true,
    providerMessageId: null,
    retry: {
      retryable: true,
      phase: 'pre_provider',
      retryAt: '2026-08-26T00:00:00.000Z',
    },
    error: {
      code: 'daily_quota_exceeded',
      message: 'Límite diario alcanzado',
    },
  });
});

test('does not treat a generic request failure as a durable receipt', () => {
  assert.equal(mapDurableSendReceipt({ error: 'Unauthorized', status: 'unknown' }), null);
  assert.equal(mapDurableSendReceipt({ receipt: { dispatchId: 'dispatch-1', status: 'conflict' } }), null);
});

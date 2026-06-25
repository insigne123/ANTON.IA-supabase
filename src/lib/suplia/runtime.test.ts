import test from 'node:test';
import assert from 'node:assert/strict';

import { getSupliaRetryAfterMs, getSupliaRuntimeErrorCode, isSupliaRuntimeError, isSupliaTransientError, SupliaRuntimeError } from './runtime';

test('runtime errors expose code and retry metadata', () => {
  const error = new SupliaRuntimeError('deferred', 'busy', { retryAfterMs: 12000 });

  assert.equal(isSupliaRuntimeError(error), true);
  assert.equal(isSupliaRuntimeError(error, 'deferred'), true);
  assert.equal(isSupliaRuntimeError(error, 'cancelled'), false);
  assert.equal(getSupliaRuntimeErrorCode(error), 'deferred');
  assert.equal(getSupliaRetryAfterMs(error), 12000);
  assert.equal(isSupliaTransientError(error), true);
});

test('plain rate-limit errors are treated as transient', () => {
  assert.equal(isSupliaTransientError(new Error('HTTP 429 rate limit')), true);
  assert.equal(isSupliaTransientError(new Error('validation failed')), false);
});

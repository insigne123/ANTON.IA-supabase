import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaResetSentence, quotaResetTime } from './quota-reset';

test('the daily reset reads in Chile time, not «medianoche UTC»', () => {
  assert.equal(quotaResetTime('2026-10-16T00:00:00Z'), '21:00', 'summer time, UTC-3');
  assert.equal(quotaResetTime('2026-06-16T00:00:00Z'), '20:00', 'winter time, UTC-4');
  assert.equal(quotaResetSentence('2026-10-16T00:00:00Z'), 'Se renueva cada día a las 21:00 (hora de Chile).');
  assert.equal(quotaResetSentence(null), 'Se renueva cada día.');
  assert.equal(quotaResetTime('no es fecha'), null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { emailDeliverability } from './email-deliverability';

test('only Apollo «verified» counts as safe; anything else warns before sending (audit P4)', () => {
  assert.equal(emailDeliverability('verified').verified, true);
  assert.equal(emailDeliverability(' Verified ').verified, true);
  for (const status of ['unknown', 'extrapolated', 'guessed', 'HIGH_PROBABILITY', '', null, undefined, 42]) {
    const result = emailDeliverability(status);
    assert.equal(result.verified, false, String(status));
    assert.equal(result.label, 'Sin verificar');
    assert.match(result.hint || '', /podría rebotar/);
  }
});

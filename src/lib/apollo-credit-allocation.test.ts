import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APOLLO_ALLOCATION_ERROR,
  apolloAllocationCopy,
  apolloAllocationCost,
  apolloAllocationEndLabel,
  apolloAllocationRefusal,
  enrichmentRefusalMessage,
  type ApolloCreditAllocation,
} from './apollo-credit-allocation';

const share = (remaining: number, credits = 300, extra: Partial<ApolloCreditAllocation> = {}): ApolloCreditAllocation => ({
  credits, used: credits - remaining, remaining, startsAt: '2026-10-28T20:00:00Z', endsAt: '2026-11-01T20:17:52Z', note: null,
  usedBefore: 0, showLimit: true, ...extra,
});

test('a share counts what Apollo charges: 1 for the email and 8 for the phone', () => {
  assert.equal(apolloAllocationCost({ revealEmail: true, revealPhone: false }), 1);
  assert.equal(apolloAllocationCost({ revealEmail: false, revealPhone: true }), 8);
  assert.equal(apolloAllocationCost({ revealEmail: true, revealPhone: true }), 8);
  assert.equal(apolloAllocationCost({ revealEmail: false, revealPhone: false }), 0);
});

test('the end of the window is said as the day in Chile', () => {
  assert.equal(apolloAllocationEndLabel('2026-11-01T20:17:52Z'), '1 de noviembre');
  assert.equal(apolloAllocationEndLabel('2026-11-01T02:00:00Z'), '31 de octubre', 'still the 31st in Santiago');
});

test('what fits passes; a used share and one that falls short are said as they are', () => {
  assert.equal(apolloAllocationRefusal(null, 50), null, 'no share, nothing to refuse');
  assert.equal(apolloAllocationRefusal(share(0), 0), null, 'nothing asked of Apollo');
  assert.equal(apolloAllocationRefusal(share(9), 9), null);
  assert.equal(apolloAllocationRefusal(share(0), 1),
    'Tu organización usó los créditos de Apollo disponibles hasta el 1 de noviembre. Los correos y teléfonos se pausan hasta entonces; las búsquedas siguen disponibles.');
  assert.equal(apolloAllocationRefusal(share(5), 18),
    'A tu organización le quedan 5 créditos de Apollo hasta el 1 de noviembre y esto usa hasta 18. Pide menos contactos o solo correos (1 crédito cada uno).');
});

test('an organization that does not see its share is not told how many are left', () => {
  const hidden = share(5, 700, { showLimit: false });
  const short = apolloAllocationRefusal(hidden, 18) || '';
  assert.equal(short, 'Esto usa hasta 18 créditos de Apollo y a tu organización no le alcanzan hasta el 1 de noviembre. Pide menos contactos o solo correos (1 crédito cada uno).');
  assert.doesNotMatch(short + (apolloAllocationRefusal(share(0, 700, { showLimit: false }), 1) || ''), /700|quedan 5/);
});

test('the screens show the refusals the server words, and nothing else', () => {
  assert.equal(enrichmentRefusalMessage({ error: APOLLO_ALLOCATION_ERROR, message: ' Ya usó sus créditos. ' }), 'Ya usó sus créditos.');
  assert.equal(enrichmentRefusalMessage({ error: 'LEAD_CLAIMED', message: 'Adjudicado a Ana Pérez: le quedan 12 días.' }), 'Adjudicado a Ana Pérez: le quedan 12 días.');
  assert.equal(enrichmentRefusalMessage({ error: 'SERVICE_ERROR', message: 'stack trace' }), null);
  assert.equal(enrichmentRefusalMessage({ error: APOLLO_ALLOCATION_ERROR }), null);
  assert.equal(enrichmentRefusalMessage(null), null);
});

test('the card says what is left and what was used in the cycle, the earlier use included', () => {
  const copy = apolloAllocationCopy(share(300, 300, { used: 0, usedBefore: 2_300 }));
  assert.equal(copy.summary, 'Quedan solo 300 créditos disponibles hasta el 1 de noviembre: ya se usaron 2.300.');
  assert.deepEqual([copy.used, copy.total, copy.remaining, copy.spent], [2_300, 2_600, 300, false]);
  const later = apolloAllocationCopy(share(282, 300, { usedBefore: 2_300 }));
  assert.equal(later.summary, 'Quedan solo 282 créditos disponibles hasta el 1 de noviembre: ya se usaron 2.318.');
  assert.match(copy.footnote, /El correo usa 1 crédito; correo y móvil, 8\./);
  assert.match(copy.footnote, /Las búsquedas no usan estos créditos/);
});

test('a used share says that emails and phones are paused, not searches', () => {
  const copy = apolloAllocationCopy(share(0, 300, { used: 305, usedBefore: 2_300 }));
  assert.equal(copy.spent, true);
  assert.equal(copy.used, 2_600, 'never more than what there was');
  assert.equal(copy.summary, 'Se usaron los 2.600 créditos disponibles. Los correos y teléfonos están pausados hasta el 1 de noviembre; las búsquedas siguen disponibles.');
});

test('an organization that does not see its share reads only what it used', () => {
  const copy = apolloAllocationCopy(share(650, 700, { usedBefore: 29, showLimit: false }));
  assert.deepEqual([copy.used, copy.total, copy.remaining, copy.spent], [79, null, null, false]);
  assert.equal(copy.summary, 'Tu organización lleva 79 créditos de Apollo usados en este ciclo, que termina el 1 de noviembre.');
  assert.doesNotMatch(copy.summary + copy.footnote, /700|650|quedan|disponibles/i);
});

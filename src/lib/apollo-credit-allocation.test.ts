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

const share = (remaining: number, credits = 300): ApolloCreditAllocation => ({
  credits, used: credits - remaining, remaining, startsAt: '2026-10-28T20:00:00Z', endsAt: '2026-11-01T20:17:52Z', note: null,
});

test('a share counts what Apollo charges: 1 for the email and 8 for the phone', () => {
  assert.equal(apolloAllocationCost({ revealEmail: true, revealPhone: false }), 1);
  assert.equal(apolloAllocationCost({ revealEmail: false, revealPhone: true }), 8);
  assert.equal(apolloAllocationCost({ revealEmail: true, revealPhone: true }), 9);
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
    'Tu organización ya usó los 300 créditos de Apollo que tiene hasta el 1 de noviembre. Los correos y teléfonos se pausan hasta entonces; las búsquedas siguen disponibles.');
  assert.equal(apolloAllocationRefusal(share(5, 700), 18),
    'A tu organización le quedan 5 créditos de Apollo hasta el 1 de noviembre y esto usa hasta 18. Pide menos contactos o solo correos (1 crédito cada uno).');
  assert.match(apolloAllocationRefusal(share(0, 1200), 1) || '', /los 1\.200 créditos/);
});

test('the screens show the refusals the server words, and nothing else', () => {
  assert.equal(enrichmentRefusalMessage({ error: APOLLO_ALLOCATION_ERROR, message: ' Ya usó sus créditos. ' }), 'Ya usó sus créditos.');
  assert.equal(enrichmentRefusalMessage({ error: 'LEAD_CLAIMED', message: 'Adjudicado a Ana Pérez: le quedan 12 días.' }), 'Adjudicado a Ana Pérez: le quedan 12 días.');
  assert.equal(enrichmentRefusalMessage({ error: 'SERVICE_ERROR', message: 'stack trace' }), null);
  assert.equal(enrichmentRefusalMessage({ error: APOLLO_ALLOCATION_ERROR }), null);
  assert.equal(enrichmentRefusalMessage(null), null);
});

test('the card says what the organization has, until when, and what each lookup uses', () => {
  const copy = apolloAllocationCopy(share(282));
  assert.equal(copy.spent, false);
  assert.equal(copy.summary, 'Tu organización tiene 300 créditos adicionales hasta el 1 de noviembre.');
  assert.match(copy.footnote, /Cada correo usa 1 crédito y cada teléfono, 8\./);
  assert.match(copy.footnote, /Las búsquedas no usan estos créditos/);
});

test('a used share says that emails and phones are paused, not searches', () => {
  const copy = apolloAllocationCopy({ ...share(0), used: 305 });
  assert.equal(copy.spent, true);
  assert.equal(copy.summary, 'Tu organización usó sus 300 créditos adicionales. Los correos y teléfonos están pausados hasta el 1 de noviembre; las búsquedas siguen disponibles.');
});


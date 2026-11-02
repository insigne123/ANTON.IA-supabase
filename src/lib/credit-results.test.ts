import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPTY_OUTCOMES, addOutcomes, costSentence, creditResultsSentence, creditsPer, monthName, monthStartOf, waitingSentence } from './credit-results';

const october = { credits: 2343, paid: 262, withPhone: 224, contacted: 2, conversations: 0, meetings: 0, waiting: 140 };

test('one sentence says what the credits got, with singulars when they apply', () => {
  assert.equal(creditResultsSentence(october), 'Con 2.343 créditos hubo datos de 262 personas: se contactó a 2, con 0 conversaciones y 0 reuniones.');
  assert.equal(creditResultsSentence({ ...EMPTY_OUTCOMES, credits: 1, paid: 1, contacted: 1, conversations: 1, meetings: 1 }),
    'Con 1 crédito hubo datos de 1 persona: se contactó a 1, con 1 conversación y 1 reunión.');
  assert.equal(creditResultsSentence(EMPTY_OUTCOMES), 'En este período no se usaron créditos de Apollo.');
});

test('the cost per conversation and per meeting shows only when there were some', () => {
  assert.equal(creditsPer(2343, 0), null);
  assert.equal(creditsPer(100, 3), 33);
  assert.equal(costSentence(october), null);
  assert.equal(costSentence({ ...october, conversations: 9, meetings: 3 }), '260 créditos por conversación · 781 por reunión');
  assert.equal(costSentence({ ...october, conversations: 9 }), '260 créditos por conversación');
});

test('the paid people still waiting are named, and nothing when there are none', () => {
  assert.equal(waitingSentence(october), '140 personas pagadas llevan más de 7 días sin contacto.');
  assert.equal(waitingSentence({ ...october, waiting: 1 }), '1 persona pagada lleva más de 7 días sin contacto.');
  assert.equal(waitingSentence({ ...october, waiting: 0 }), null);
});

test('outcomes add up field by field, and the month starts on the 1st with its name', () => {
  assert.deepEqual(addOutcomes(october, { ...EMPTY_OUTCOMES, credits: 7, paid: 1, waiting: 1 }), { ...october, credits: 2350, paid: 263, waiting: 141 });
  assert.equal(monthStartOf('2026-11-02'), '2026-11-01');
  assert.equal(monthName('2026-11-02'), 'noviembre');
  assert.equal(monthName('2026-01-31'), 'enero');
});

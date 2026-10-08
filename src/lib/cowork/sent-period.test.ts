import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coworkSentPeriod } from './sent-period';

test('a period in a contacted.search query becomes days, and the rest still searches', () => {
  assert.deepEqual(coworkSentPeriod('últimos 7 días'), { days: 7, rest: '' });
  assert.deepEqual(coworkSentPeriod('last_7_days'), { days: 7, rest: '' });
  assert.deepEqual(coworkSentPeriod('ultimos 30 dias'), { days: 30, rest: '' });
  assert.deepEqual(coworkSentPeriod('en los últimos 14 días'), { days: 14, rest: '' });
  assert.deepEqual(coworkSentPeriod('envíos de esta semana'), { days: 7, rest: '' });
  assert.deepEqual(coworkSentPeriod('este mes'), { days: 30, rest: '' });
  assert.deepEqual(coworkSentPeriod('hoy'), { days: 1, rest: '' });
  assert.deepEqual(coworkSentPeriod('Sodexo últimos 7 días'), { days: 7, rest: 'Sodexo' });
  assert.deepEqual(coworkSentPeriod('Banco de Chile este mes'), { days: 30, rest: 'Banco de Chile' });
});

test('a query without a period, or with an absurd one, stays a text search', () => {
  assert.equal(coworkSentPeriod(''), null);
  assert.equal(coworkSentPeriod('Marcela'), null);
  assert.equal(coworkSentPeriod('Hoyts'), null);
  assert.equal(coworkSentPeriod('Mesa Central'), null);
  assert.equal(coworkSentPeriod('últimos 900 días'), null);
});

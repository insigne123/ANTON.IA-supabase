import assert from 'node:assert/strict';
import test from 'node:test';

import { LEAD_CLAIM_DAYS, leadClaimDaysLeft, leadClaimRefusal, leadClaimText, withLeadClaimMessage } from './lead-claim';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('a claim lasts 30 days and says how many are left, at least one while it holds', () => {
  assert.equal(LEAD_CLAIM_DAYS, 30);
  assert.equal(leadClaimDaysLeft(new Date(NOW + 12 * DAY).toISOString(), NOW), 12);
  assert.equal(leadClaimDaysLeft(new Date(NOW + 11.2 * DAY).toISOString(), NOW), 12, 'a part of a day counts as a day');
  assert.equal(leadClaimDaysLeft(new Date(NOW + 60 * 1000).toISOString(), NOW), 1);
  assert.equal(leadClaimDaysLeft(new Date(NOW - 1).toISOString(), NOW), null, 'over');
  assert.equal(leadClaimDaysLeft('nunca', NOW), null);
});

test('«Adjudicado a Ana Pérez · le quedan 12 días», in singular on the last day', () => {
  assert.equal(leadClaimText('Ana Pérez', new Date(NOW + 12 * DAY).toISOString(), NOW), 'Adjudicado a Ana Pérez · le quedan 12 días');
  assert.equal(leadClaimText('Ana Pérez', new Date(NOW + 3600 * 1000).toISOString(), NOW), 'Adjudicado a Ana Pérez · le queda 1 día');
  assert.equal(leadClaimText('  ', null, NOW), 'Adjudicado a otra persona del equipo');
});

test('the database refusal reads as who holds the person and for how long; any other error is not one', () => {
  const error = { message: 'lead_claimed', code: 'P0001', hint: 'Adjudicado a Ana Pérez: le quedan 12 días.',
    details: JSON.stringify({ ownerName: 'Ana Pérez', claimedUntil: '2026-11-08T12:00:00Z', daysLeft: 12 }) };
  assert.deepEqual(leadClaimRefusal(error), { ownerName: 'Ana Pérez', daysLeft: 12, message: 'Adjudicado a Ana Pérez: le quedan 12 días.' });
  assert.deepEqual(leadClaimRefusal({ message: 'lead_claimed', details: 'no es json' }),
    { ownerName: 'otra persona del equipo', daysLeft: 1, message: 'Adjudicado a otra persona del equipo: le queda 1 día.' });
  for (const other of [null, 'lead_claimed', new Error('boom'), { message: 'duplicate key', code: '23505' }]) assert.equal(leadClaimRefusal(other), null);
  const wrapped = withLeadClaimMessage(error) as Error & { leadClaim?: unknown };
  assert.ok(wrapped instanceof Error);
  assert.equal(wrapped.message, 'Adjudicado a Ana Pérez: le quedan 12 días.');
  assert.equal(wrapped.name, 'LeadClaimedError');
  const other = new Error('boom');
  assert.equal(withLeadClaimMessage(other), other, 'any other error goes as it was');
});

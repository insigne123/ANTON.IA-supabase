import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkMessageContextPatchSchema, hashCoworkMessageContextPatch } from './message-context-proposal';

test('message context patch accepts scoped commercial fields and rejects empties', () => {
  const patch = { prohibitedTerms: ['antecedentes penales'],
    approvedClaims: [{ claim: 'Consulta judicial', evidence: 'Casos 2024' }],
    roleCta: { decisionMaker: 'Reunión de 15 minutos' } };
  assert.equal(coworkMessageContextPatchSchema.safeParse(patch).success, true);
  assert.equal(coworkMessageContextPatchSchema.safeParse({}).success, false);
  assert.equal(coworkMessageContextPatchSchema.safeParse({ trialOffer: '' }).success, false);
  assert.equal(coworkMessageContextPatchSchema.safeParse({ unknownField: 'x' }).success, false);
  assert.match(hashCoworkMessageContextPatch(patch), /^[a-f0-9]{64}$/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMessageTerms, extractDraftAssertions, pairAssertionsWithEvidence } from './message-checks';

test('terms match literally across accents and never paraphrase', () => {
  const blocked = checkMessageTerms('Revisamos antecedentes penales de candidatos.',
    { prohibitedTerms: ['antecedentes penales'], requiredTerms: ['due diligence'] });
  assert.equal(blocked.verdict, 'blocked');
  assert.deepEqual(blocked.prohibitedFound, ['antecedentes penales']);
  assert.deepEqual(blocked.requiredMissing, ['due diligence']);
  const clean = checkMessageTerms('Due diligence con trazabilidad auditable.',
    { prohibitedTerms: ['antecedentes penales'], requiredTerms: ['due diligence', 'trazabilidad'] });
  assert.equal(clean.verdict, 'pass');
  assert.deepEqual(clean.requiredMissing, []);
});
test('verdicts separate missing required terms, conflicts and unconfigured context', () => {
  assert.equal(checkMessageTerms('Hola.', { prohibitedTerms: [], requiredTerms: ['evidencia'] }).verdict, 'fail');
  assert.equal(checkMessageTerms('Hola.', { prohibitedTerms: [], requiredTerms: [] }).verdict, 'unconfigured');
  assert.equal(checkMessageTerms('Hola.', null).verdict, 'unconfigured');
  const conflict = checkMessageTerms('Hola mundo.', { prohibitedTerms: ['mundo'], requiredTerms: ['mundo'] });
  assert.equal(conflict.verdict, 'blocked');
  assert.deepEqual(conflict.conflictingTerms, ['mundo']);
});

test('assertions flag numbers, comparisons, guarantees and launches', () => {
  const found = extractDraftAssertions('Propuesta', 'Hacemos 1000 personas en 30 minutos, más barato y garantizado. Lanzamos PEP pronto. Subimos 25% la respuesta.');
  assert.deepEqual(found.map(item => item.id).sort(), ['comparative', 'guarantee', 'launch', 'number', 'quantity']);
  assert.equal(extractDraftAssertions(null, 'Hola, ¿conversamos?').length, 0);
});

test('evidence pairing never certifies semantics', () => {
  const paired = pairAssertionsWithEvidence([{ id: 'number', label: 'Cifra', excerpt: 'subimos 25%' }],
    [{ statement: 'Caso A', evidence: ['e1'] }], [{ claim: 'C1', evidence: 'E1' }]);
  assert.equal(paired[0].status, 'needs_human_judgment');
  assert.equal(paired[0].researchClaimsObserved, 1);
});

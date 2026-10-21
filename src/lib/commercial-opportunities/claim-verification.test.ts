import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClaimVerdicts, claimVerdictSchema, MAX_CLAIMS, reportClaims, unsupportedClaims } from './claim-verification';

const quote = (chunkId: string, text = 'texto de la cita') => ({ chunkId, quote: text });
const report = () => ({
  requirements: [
    { title: 'Boleta de garantía de seriedad', status: 'supported' as const, evidence: [quote('c1')], action: '', role: '', due: '' },
    { title: 'Certificado F30', status: 'pending' as const, evidence: [], action: '', role: '', due: '' },
    { title: 'Declaración jurada', status: 'supported' as const, evidence: [quote('c2')], action: '', role: '', due: '' },
  ],
  milestones: [{ label: 'Cierre de ofertas', date: '16 oct', state: 'documented' as const, citations: [quote('c3')] }, { label: 'Adjudicación', date: '30 oct', state: 'proposed' as const, citations: [] }],
  risks: [{ title: 'Multas por atraso', impact: 'high' as const, basis: 'documented' as const, mitigation: '', citations: [quote('c4')] }],
  sections: [{ id: 's1', title: 'Contrato', paragraphs: [], facts: [
    { text: 'Plazo de 30 días', state: 'documented' as const, citations: [quote('c5')] },
    { text: 'Pago a 30 días', state: 'documented' as const, citations: [] },
    { text: 'Precio referencial', state: 'calculated' as const, citations: [quote('c6')] },
  ] }],
});

test('the claims are what the report affirms as documented and has a quote for, with an id that finds them again', () => {
  const claims = reportClaims(report());
  assert.deepEqual(claims.map(claim => claim.id), ['req:0', 'req:2', 'mile:0', 'risk:0', 'fact:0.0']);
  assert.equal(claims[0].text, 'Boleta de garantía de seriedad');
  assert.equal(claims[2].text, 'Cierre de ofertas: 16 oct');
  assert.deepEqual(claims[0].quotes, [quote('c1')]);
});

test('a report with more claims than a reader can check keeps the first ones', () => {
  const many = report();
  many.sections[0].facts = Array.from({ length: 80 }, (_, i) => ({ text: `Hecho ${i}`, state: 'documented' as const, citations: [quote(`k${i}`)] }));
  assert.equal(reportClaims(many).length, MAX_CLAIMS);
});

test('only a clear «unrelated» or «contradicts» counts, and only for claims that exist', () => {
  const claims = reportClaims(report());
  const verdicts = claimVerdictSchema.parse({ results: [
    { id: 'req:0', verdict: 'supports', reason: 'Lo dice' }, { id: 'req:2', verdict: 'partial', reason: 'Lo insinúa' },
    { id: 'mile:0', verdict: 'unrelated', reason: 'Habla de otra fecha' }, { id: 'risk:0', verdict: 'contradicts', reason: 'Dice que no hay multas' },
    { id: 'fact:9.9', verdict: 'unrelated', reason: 'No existe' },
  ] });
  assert.deepEqual([...unsupportedClaims(verdicts, claims)].sort(), ['mile:0', 'risk:0']);
});

test('an unsupported claim becomes unknown, its text and quotes stay, and nothing else changes', () => {
  const before = report();
  const { report: after, downgraded } = applyClaimVerdicts(before, new Set(['req:2', 'mile:0', 'risk:0', 'fact:0.0']));
  assert.equal(downgraded, 4);
  assert.deepEqual(after.requirements.map(item => item.status), ['supported', 'pending', 'unknown']);
  assert.equal(after.requirements[2].title, 'Declaración jurada');
  assert.deepEqual(after.requirements[2].evidence, [quote('c2')]);
  assert.equal(after.milestones[0].state, 'unknown');
  assert.equal(after.milestones[1].state, 'proposed');
  assert.equal(after.risks[0].basis, 'unknown');
  assert.deepEqual(after.sections[0].facts.map(fact => fact.state), ['unknown', 'documented', 'calculated']);
  assert.equal(before.requirements[2].status, 'supported', 'the report it was given is not changed');
  const same = applyClaimVerdicts(before, new Set());
  assert.equal(same.report, before);
  assert.equal(same.downgraded, 0);
});

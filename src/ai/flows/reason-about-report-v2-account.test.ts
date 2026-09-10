import assert from 'node:assert/strict';
import test from 'node:test';

import type { AnalysisV2 } from '@/lib/report-v2-contracts';
import { buildReasonReportV2Prompt, reasonAboutReportV2Account } from './reason-about-report-v2-account';

const entity = {
  companyName: 'Example', companyDomain: 'example.test', contactCountry: 'PE' as const,
  operatingCountries: ['PE'], countryScopedPaths: { PE: '/peru/' }, excludedPaths: [],
  contact: { fullName: 'Test Person', title: 'Director', seniority: 'director' as const, department: 'Operations', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null },
  ambiguities: [],
};
const qualification = { verdict: 'qualified' as const, reasons: [], redirectTo: [], allowedDepth: 'deep' as const };
const claims = [{
  id: 'c01', internalId: '123e4567-e89b-42d3-a456-426614174000', type: 'fact' as const, dimension: 'company_size' as const,
  statement: 'Example employs 300 people.', evidenceIds: ['f_aaaaaaaaaa'], observedAt: '2026-01-01T00:00:00.000Z',
  freshnessDays: 10, jurisdiction: 'PE' as const, confidence: 0.9,
}];

function modelAnalysis(): AnalysisV2 {
  return {
    verdict: { headline: 'Proceed to discovery.', qualification: 'qualified', recommendedProduct: 'product-a', nextAction: 'Validate volume.', blockers: [] },
    buyingCommittee: [],
    volumeModel: null,
    signalIds: [],
    fitByProduct: [{ productKey: 'product-a', verdict: 'possible', rationale: 'Scale is in range.', claimIds: ['c01'], headquartersContextClaimIds: [], validationQuestion: 'Is the local process in scope?' }],
    entryAngle: { channel: 'email', timing: 'Now', hooks: ['Local scale'] },
    discoveryQuestions: [], objections: [], riskClaimIds: [], gapIds: [],
  };
}

test('P5 uses only Luna and replaces model arithmetic with configured volume calculations', async () => {
  let options: any = null;
  const result = await reasonAboutReportV2Account({
    entity,
    qualification,
    claims,
    signals: [],
    gaps: [],
    committee: [],
    sellerProfile: { products: [{ key: 'product-a', volumeAssumptions: { scenarioMultipliers: [1, 2, 3], minutesPerEvent: 6 } }] },
  }, { generate: (async (input: any) => { options = input; return modelAnalysis(); }) as any });
  assert.equal(options.provider, 'openai');
  assert.deepEqual(options.openAiModels, ['gpt-5.6-luna']);
  assert.equal(options.allowDefaultModelFallback, false);
  assert.ok(!options.prompt.includes(claims[0].internalId));
  assert.equal(result.analysis.volumeModel?.scenarios.length, 3);
  assert.equal(result.analysis.volumeModel?.scenarios[1].eventsPerYear, 600);
});

test('role-based discovery and hypothetical objections survive without unrelated evidence citations', async () => {
  const generated = modelAnalysis();
  generated.discoveryQuestions = [{ question: 'Que tareas de coordinacion concentran mas tiempo?', validatesClaimId: null }];
  generated.objections = [{ objection: 'Podrian preferir usar su plataforma actual.', derivedFrom: [], response: 'Explorar integracion antes de proponer reemplazo.' }];
  const result = await reasonAboutReportV2Account({ entity, qualification, claims, signals: [], gaps: [], committee: [], sellerProfile: { products: [{ key: 'product-a' }] } }, { generate: (async () => generated) as any });
  assert.deepEqual(result.analysis.discoveryQuestions, generated.discoveryQuestions);
  assert.deepEqual(result.analysis.objections, generated.objections);
});

test('P5 requires fit analysis for every tenant product and never invents missing product context', async () => {
  await assert.rejects(reasonAboutReportV2Account({
    entity,
    qualification,
    claims,
    signals: [],
    gaps: [],
    committee: [],
    sellerProfile: { products: [{ key: 'product-a' }, { key: 'product-b' }] },
  }, { generate: (async () => modelAnalysis()) as any }), /REPORT_V2_PRODUCT_FIT_INCOMPLETE/);
});

test('analyst preserves per-role hypotheses and individual pilot metrics without seller traction claims', () => {
  for (const title of ['Director de Finanzas', 'Coordinador de Reclutamiento', 'Director de TI']) {
    const prompt = buildReasonReportV2Prompt({ entity: { ...entity, contact: { ...entity.contact, title } }, qualification, claims: [], sellerProfile: { products: [{ key: 'automation' }] } });
    assert.ok(prompt.includes(title));
    assert.match(prompt, /fitByProduct.rationale conserva PARA CADA caso/);
    assert.match(prompt, /unidad y que comparar con la linea base/);
    assert.match(prompt, /facturacion, cobranza, cierre o excepciones/);
    assert.match(prompt, /Son hipotesis por validar, no problemas reales/);
    assert.match(prompt, /No lo sustituyas por ingreso de personal/);
    assert.match(prompt, /Inventar experiencia, traccion, clientes, conversaciones en curso o resultados del vendedor/);
    assert.match(prompt, /entryAngle.hooks usa una capacidad explicita y una pregunta exploratoria/);
  }
});

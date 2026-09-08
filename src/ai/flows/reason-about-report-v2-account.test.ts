import assert from 'node:assert/strict';
import test from 'node:test';

import type { AnalysisV2 } from '@/lib/report-v2-contracts';
import { reasonAboutReportV2Account } from './reason-about-report-v2-account';

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

test('P5 uses the critical OpenAI tier and replaces model arithmetic with configured volume calculations', async () => {
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
  assert.ok(options.openAiModels.length > 0);
  assert.ok(!options.prompt.includes(claims[0].internalId));
  assert.equal(result.analysis.volumeModel?.scenarios.length, 3);
  assert.equal(result.analysis.volumeModel?.scenarios[1].eventsPerYear, 600);
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

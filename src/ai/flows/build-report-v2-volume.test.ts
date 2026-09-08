import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReportV2VolumeModel } from './build-report-v2-volume';

const entity = {
  companyName: 'GrupoExpro',
  companyDomain: 'grupoexpro.com',
  contactCountry: 'PE' as const,
  operatingCountries: ['CL', 'PE', 'CO'],
  countryScopedPaths: { CL: '/chile/', PE: '/peru/' },
  excludedPaths: ['/chile/'],
  contact: {
    fullName: 'Bruno Sanchez Wieser', title: 'Coordinador de Reclutamiento', seniority: 'coordinator' as const,
    department: 'Recursos Humanos', tenureMonths: null, companyTenureMonths: null, linkedinUrl: null,
  },
  ambiguities: [],
};

const scaleClaim = {
  id: 'c01', internalId: 'internal-scale', type: 'fact' as const, dimension: 'company_size' as const,
  statement: 'GrupoExpro gestiona mas de 12000 colaboradores.', evidenceIds: ['f_aaaaaaaaaa'],
  observedAt: '2026-04-02T18:18:45.000Z', freshnessDays: 1, jurisdiction: 'GLOBAL' as const, confidence: 0.82,
};

test('builds three transparent scenarios only from a cited scale fact and tenant assumptions', () => {
  const result = buildReportV2VolumeModel({
    claims: [scaleClaim],
    entity,
    assumptions: { scenarioMultipliers: [1.5, 2.5, 3.5], minutesPerEvent: 5 },
  });
  assert.ok(result);
  assert.equal(result.model.baseClaimId, 'c01');
  assert.equal(result.model.scenarios.length, 3);
  assert.equal(result.model.scenarios[1].eventsPerYear, 30_000);
  assert.equal(result.model.scenarios[1].hoursPerMonth, 208.33333333333334);
  assert.ok(result.model.assumptions.every((assumption) => assumption.editable && assumption.rationale));
  assert.ok(result.model.caveats.length > 0);
  assert.equal(result.gap?.requiredField, 'volume.local_scale');
});

test('does not invent a volume model without tenant inputs or a scale fact', () => {
  assert.equal(buildReportV2VolumeModel({ claims: [scaleClaim], entity, assumptions: null }), null);
  assert.equal(buildReportV2VolumeModel({ claims: [], entity, assumptions: { scenarioMultipliers: [1, 2, 3], minutesPerEvent: 5 } }), null);
});

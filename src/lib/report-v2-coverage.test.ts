import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeReportV2Coverage,
  gapsFromMissingReportV2Fields,
  reportV2OperationalMetrics,
  validateReportV2CoverageGapConsistency,
} from './report-v2-coverage';

const section = (key: any, claimIds: string[]) => ({ key, title: key, paragraphs: [{ text: 'Cited content.', claimIds, context: 'target' as const }], blocks: [] });
const baseClaim = {
  id: 'c01', internalId: null, type: 'fact' as const, dimension: 'company_overview' as const,
  statement: 'Acme provides workforce services.', evidenceIds: ['f_aaaaaaaaaa'], observedAt: '2026-01-01T00:00:00.000Z',
  freshnessDays: 1, jurisdiction: 'PE' as const, confidence: 0.9,
};

test('coverage counts required cited fields and caps reports without a scale figure at 40 percent', () => {
  const requiredFields = Array.from({ length: 5 }, (_, index) => ({
    key: `field.${index}`,
    section: 'company' as const,
    dimensions: ['company_overview' as const],
    howToFind: 'Find it.',
    source: 'Public source.',
  }));
  const coverage = computeReportV2Coverage({ sections: [section('company', ['c01'])], claims: [baseClaim], requiredFields });
  assert.equal(coverage.filled.length, 5);
  assert.equal(coverage.ratio, 0.4);
});

test('missing fields and actionable gaps share one declarative source', () => {
  const requiredFields = [{
    key: 'snapshot.headcount', section: 'snapshot' as const, dimensions: ['company_size' as const],
    howToFind: 'Search public headcount.', source: 'Corporate or registry source.',
  }];
  const coverage = computeReportV2Coverage({ sections: [], claims: [], requiredFields });
  const gaps = gapsFromMissingReportV2Fields(coverage.missing, requiredFields);
  assert.equal(gaps[0].requiredField, coverage.missing[0]);
  assert.ok(gaps[0].howToFind);
  assert.doesNotThrow(() => validateReportV2CoverageGapConsistency({ coverage, evidenceGraph: { gaps } } as any));
  assert.throws(() => validateReportV2CoverageGapConsistency({ coverage, evidenceGraph: { gaps: [] } } as any), /COVERAGE_GAPS_MISMATCH/);
});

test('operational metrics contain counts and ratios but no report content', () => {
  const metrics = reportV2OperationalMetrics({
    sectionsAttempted: 2,
    sectionsAccepted: 1,
    sections: [section('company', ['c01'])],
    claims: [baseClaim],
    facts: [{ id: 'f_aaaaaaaaaa', sourceId: 'src_aaaaaaaaaa', text: 'Sensitive source text', observedAt: null, jurisdiction: 'PE', locator: null }],
    sources: [{
      id: 'src_aaaaaaaaaa', url: 'https://acme.example', canonicalUrl: 'https://acme.example', title: 'Sensitive title', sourceType: 'corporate', jurisdiction: 'PE',
      publishedAt: null, modifiedAt: null, retrievedAt: '2026-01-01T00:00:00.000Z', ownDomain: true, contentHash: 'a'.repeat(64),
    }],
    signals: [],
    committee: [],
  });
  assert.equal(metrics.sectionAcceptRate, 0.5);
  assert.equal(metrics.ownDomainSourceRatio, 1);
  assert.ok(!JSON.stringify(metrics).includes('Sensitive'));
});

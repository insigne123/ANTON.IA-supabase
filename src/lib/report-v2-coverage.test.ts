import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeReportV2Coverage,
  dedupeReportV2Claims,
  dedupeReportV2Facts,
  gapsFromMissingReportV2Fields,
  projectReportV2ModelEvidence,
  pruneReportV2ClaimsForProjection,
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

const factFixture = (id: string, text: string, sourceId = 'src_aaaaaaaaaa') => ({
  id,
  sourceId,
  text,
  observedAt: '2026-01-01T00:00:00.000Z',
  jurisdiction: 'PE' as const,
  locator: null,
});

const claimFixture = (id: string, statement: string, dimension: any = 'company_size', confidence = 0.8) => ({
  ...baseClaim,
  id,
  internalId: `internal-${id}`,
  dimension,
  statement,
  confidence,
});

test('fact dedup drops exact normalized duplicates and keeps input order', () => {
  const facts = [
    factFixture('f_aaaaaaaaaa', 'Acme gestiona 12.000 colaboradores.'),
    factFixture('f_bbbbbbbbbb', 'acme  GESTIONA 12 000 colaboradores!'),
    factFixture('f_cccccccccc', 'Acme opera en tres países.'),
  ];
  const deduped = dedupeReportV2Facts(facts as any);
  assert.deepEqual(deduped.map((fact) => fact.id), ['f_aaaaaaaaaa', 'f_cccccccccc']);
});

test('claim dedup merges near-duplicates preserving provenance with the higher confidence statement', () => {
  const kept = dedupeReportV2Claims([
    claimFixture('c01', 'Acme gestiona 12000 colaboradores en Chile y Peru.', 'company_size', 0.7),
    claimFixture('c02', 'Acme gestiona 12000 colaboradores en Chile y Peru confirmados.', 'company_size', 0.9),
    claimFixture('c03', 'Acme opera en el sector de servicios transitorios.', 'company_industry', 0.8),
  ] as any) as any[];
  assert.equal(kept.length, 2);
  const merged = kept.find((claim) => claim.id === 'c01');
  assert.ok(merged.statement.includes('confirmados'));
  assert.equal(merged.confidence, 0.9);
  assert.deepEqual(merged.evidenceIds, ['f_aaaaaaaaaa']);
});

test('claim pruning caps per dimension and total deterministically', () => {
  const serviceStatements = [
    'Acme ofrece reclutamiento y selección de personal temporal.',
    'Acme brinda outsourcing de remuneraciones y contratos.',
    'Acme opera casinos y alimentación para faenas mineras.',
    'Acme gestiona flotas de transporte para operaciones.',
    'Acme dicta capacitaciones de seguridad laboral.',
  ];
  const industryStatements = [
    'El sector de servicios transitorios creció en Chile.',
    'La industria de outsourcing enfrenta nueva regulación.',
    'El mercado laboral peruano demanda personal eventual.',
    'La minería chilena externaliza servicios de apoyo.',
    'El retail colombiano contrata personal de temporada.',
  ];
  const claims = [
    ...serviceStatements.map((statement, index) => claimFixture(`c0${index + 1}`, statement, 'company_service', 0.5 + index / 100)),
    ...industryStatements.map((statement, index) => claimFixture(`c0${index + 6}`, statement, 'company_industry', 0.6 + index / 100)),
  ];
  const first = pruneReportV2ClaimsForProjection(claims as any, { maxTotal: 3, maxPerDimension: 2 });
  const second = pruneReportV2ClaimsForProjection(claims as any, { maxTotal: 3, maxPerDimension: 2 });
  assert.deepEqual(first.map((claim) => claim.id), second.map((claim) => claim.id));
  assert.equal(first.length, 3);
  assert.ok(first.filter((claim) => claim.dimension === 'company_industry').length <= 2);
  assert.ok(first[0].confidence >= first[1].confidence && first[1].confidence >= first[2].confidence);
});

test('model projection preserves full payloads while restricting sources to referenced ones', () => {
  const facts = [
    factFixture('f_aaaaaaaaaa', 'Acme gestiona 12000 colaboradores.'),
    factFixture('f_bbbbbbbbbb', 'Texto huérfano sin claims.'),
  ];
  const sources = [
    { id: 'src_aaaaaaaaaa', url: 'https://acme.example/a', canonicalUrl: 'https://acme.example/a', title: 'A', sourceType: 'corporate', jurisdiction: 'PE', publishedAt: null, modifiedAt: null, retrievedAt: '2026-01-01T00:00:00.000Z', ownDomain: true, contentHash: 'a'.repeat(64) },
    { id: 'src_bbbbbbbbbb', url: 'https://other.example/b', canonicalUrl: 'https://other.example/b', title: 'B', sourceType: 'press', jurisdiction: 'PE', publishedAt: null, modifiedAt: null, retrievedAt: '2026-01-01T00:00:00.000Z', ownDomain: false, contentHash: 'b'.repeat(64) },
  ];
  const projection = projectReportV2ModelEvidence({
    sources: sources as any,
    facts: facts as any,
    claims: [claimFixture('c01', 'Acme gestiona 12000 colaboradores.')] as any,
  });
  assert.equal(projection.totals.facts, 2);
  assert.equal(projection.totals.sources, 2);
  assert.equal(facts.length, 2);
  assert.deepEqual(projection.sources.map((source) => source.id), ['src_aaaaaaaaaa']);
  assert.ok(projection.pruned.facts >= 1 && projection.pruned.sources >= 1);
});
test('projection preserves canonical citations and enforces budgets for derived dependencies', () => {
  const sources = [{ id: 'source-a' }, { id: 'source-b' }] as any;
  const facts = [
    { id: 'fact-a', sourceId: 'source-a', text: 'Same wording' },
    { id: 'fact-b', sourceId: 'source-b', text: 'Same wording' },
  ] as any;
  const claims = [
    { id: 'c01', type: 'fact', dimension: 'company_size', confidence: 0.5, evidenceIds: ['fact-b'] },
    { id: 'c02', type: 'derived', dimension: 'volume_estimate', confidence: 0.9, evidenceIds: ['fact-a'], inputs: ['c01'] },
  ] as any;
  const input = { sources, facts, claims };
  const before = JSON.stringify(input);
  const full = projectReportV2ModelEvidence({ ...input, budget: { maxFacts: 2 } });
  assert.deepEqual(full.claims.map((claim) => claim.id), ['c01', 'c02']);
  assert.deepEqual(full.claims[0].evidenceIds, ['fact-b']);
  const bounded = projectReportV2ModelEvidence({ ...input, budget: { maxFacts: 1 } });
  assert.deepEqual(bounded.claims.map((claim) => claim.id), ['c01']);
  assert.equal(bounded.facts.length, 1);
  assert.equal(JSON.stringify(input), before);
  const broken = projectReportV2ModelEvidence({ ...input, facts: [] });
  assert.equal(broken.claims.length, 0);
});

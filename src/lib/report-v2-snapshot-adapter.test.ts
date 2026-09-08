import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReportV2IntegrityIssues, ReportV2Schema } from '@/lib/report-v2-contracts';
import { projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { draftSnapshotFixture, DRAFT_FIXTURE_NOW } from '@/lib/server/draft-v2-test-fixtures';

const sellerProfile = {
  companyName: 'Northstar',
  products: [{ key: 'automation', name: 'Automation' }],
};

test('projects dated snapshot evidence into stable V2 facts, claims, and compact IDs', () => {
  const raw = structuredClone(draftSnapshotFixture());
  raw.subject.person.country = 'Chile';
  raw.evidence = raw.evidence.map((evidence) => ({ ...evidence, observedAt: '2026-08-20T12:00:00.000Z' }));
  const snapshot = ResearchSnapshotV1Schema.parse(raw);
  const first = projectResearchSnapshotV1ToReportV2({
    snapshot,
    sellerProfile,
    icpRules: null,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const second = projectResearchSnapshotV1ToReportV2({
    snapshot,
    sellerProfile,
    icpRules: null,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.entity.contactCountry, 'CL');
  assert.equal(first.qualification.allowedDepth, 'shallow');
  assert.deepEqual(first.claims.map((claim) => claim.id), ['c01', 'c02']);
  assert.deepEqual(Object.keys(first.shortIdMap), first.claims.map((claim) => claim.id));
  assert.deepEqual(Object.values(first.shortIdMap).sort(), ['claim-acme-overview', 'claim-ada-role']);
  assert.ok(first.claims.every((claim) => claim.type === 'fact' && claim.evidenceIds.length > 0));
  assert.ok(first.sources.every((source) => /^[a-f0-9]{64}$/.test(source.contentHash)));
});

test('keeps undated evidence as graph facts but never promotes it to a factual V2 claim', () => {
  const projection = projectResearchSnapshotV1ToReportV2({
    snapshot: draftSnapshotFixture(),
    sellerProfile,
    icpRules: null,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });

  assert.equal(projection.facts.length, 2);
  assert.ok(projection.facts.every((fact) => fact.observedAt === null));
  assert.equal(projection.claims.length, 0);
  assert.deepEqual(projection.shortIdMap, {});
});

test('projected graph can be embedded without dangling source, fact, or short-ID references', () => {
  const raw = structuredClone(draftSnapshotFixture());
  raw.evidence = raw.evidence.map((evidence) => ({ ...evidence, observedAt: '2026-08-20T12:00:00.000Z' }));
  const snapshot = ResearchSnapshotV1Schema.parse(raw);
  const projection = projectResearchSnapshotV1ToReportV2({
    snapshot,
    sellerProfile,
    icpRules: null,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const sections = [
    'verdict', 'snapshot', 'contact', 'committee', 'company', 'volume', 'regulatory', 'signals',
    'fit', 'angle', 'discovery', 'objections', 'risks', 'gaps', 'sources',
  ].map((key) => ({ key, title: key, paragraphs: [], blocks: [] }));
  const report = ReportV2Schema.parse({
    kind: 'research_report_document',
    schemaVersion: 'research-report-document/v2',
    id: 'report-v2:test',
    revision: 1,
    researchSnapshotId: snapshot.id,
    scope: { organizationId: snapshot.scope.organizationId, ownerUserId: snapshot.scope.ownerUserId },
    language: 'es',
    entity: projection.entity,
    qualification: projection.qualification,
    evidenceGraph: {
      sources: projection.sources,
      facts: projection.facts,
      claims: projection.claims,
      signals: [], gaps: [], assumptions: [], estimates: [], deliverables: [], shortIdMap: projection.shortIdMap,
    },
    analysis: {
      verdict: { headline: 'Revisar', qualification: projection.qualification.verdict, recommendedProduct: 'automation', nextAction: 'Validar', blockers: [] },
      buyingCommittee: projection.committee,
      volumeModel: null,
      signalIds: [], fitByProduct: [],
      entryAngle: { channel: 'email', timing: 'Ahora', hooks: [] },
      discoveryQuestions: [], objections: [], riskClaimIds: [], gapIds: [],
    },
    sections,
    coverage: { ratio: 0, filled: [], missing: [] },
    audit: { status: 'passed', model: 'test-auditor', issues: [] },
    synthesis: { status: 'partial', provider: 'openai', promptVersion: 'test/v1', generatedAt: DRAFT_FIXTURE_NOW.toISOString(), acceptedModelBySection: {} },
  });
  assert.deepEqual(collectReportV2IntegrityIssues(report), []);
});

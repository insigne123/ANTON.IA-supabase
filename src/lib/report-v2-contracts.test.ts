import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ClaimV2Schema,
  REPORT_V2_SCHEMA_VERSION,
  ReportV2SectionKeySchema,
  ReportV2IntegrityError,
  assignShortClaimIds,
  validateReportV2,
} from './report-v2-contracts';
import { buildStableReportV2Id } from './report-v2-ids';

const now = '2026-09-08T00:00:00.000Z';
const sourceId = buildStableReportV2Id('src', 'https://example.test/about');
const factId = buildStableReportV2Id('f', { sourceId, text: 'Example employs 300 people.' });

function validReport() {
  const assumption = {
    id: buildStableReportV2Id('asm', 'annual cycles'),
    label: 'Annual cycles',
    value: 2,
    rationale: 'Tenant-configured base scenario.',
    editable: true,
  };
  const claims = [
    {
      id: 'c01',
      internalId: 'internal-company-size',
      type: 'fact' as const,
      dimension: 'company_size' as const,
      statement: 'Example employs 300 people.',
      evidenceIds: [factId],
      observedAt: now,
      freshnessDays: 0,
      jurisdiction: 'PE' as const,
      confidence: 0.9,
    },
    {
      id: 'c02',
      internalId: null,
      type: 'hypothesis' as const,
      dimension: 'risk' as const,
      statement: 'Manual processing may create avoidable work.',
      evidenceIds: [],
      observedAt: null,
      freshnessDays: null,
      jurisdiction: 'PE' as const,
      confidence: 0.5,
      validationQuestion: 'How much work is currently manual?',
    },
  ];
  return {
    kind: 'research_report_document',
    schemaVersion: REPORT_V2_SCHEMA_VERSION,
    id: 'report-v2-test',
    revision: 1,
    researchSnapshotId: 'snapshot-test',
    scope: { organizationId: 'organization-test', ownerUserId: 'user-test' },
    language: 'es',
    entity: {
      companyName: 'Example',
      companyDomain: 'example.test',
      contactCountry: 'PE',
      operatingCountries: ['PE'],
      countryScopedPaths: { PE: '/peru/' },
      excludedPaths: [],
      contact: {
        fullName: 'Test Contact',
        title: 'Coordinator',
        seniority: 'coordinator',
        department: 'Operations',
        tenureMonths: null,
        companyTenureMonths: null,
        linkedinUrl: null,
      },
      ambiguities: [],
    },
    qualification: {
      verdict: 'qualified',
      reasons: [],
      redirectTo: [],
      allowedDepth: 'deep',
    },
    evidenceGraph: {
      sources: [{
        id: sourceId,
        url: 'https://example.test/about',
        canonicalUrl: 'https://example.test/about',
        title: 'About Example',
        sourceType: 'corporate',
        jurisdiction: 'PE',
        publishedAt: null,
        modifiedAt: now,
        retrievedAt: now,
        ownDomain: true,
        contentHash: 'a'.repeat(64),
      }],
      facts: [{
        id: factId,
        sourceId,
        text: 'Example employs 300 people.',
        observedAt: now,
        jurisdiction: 'PE',
        locator: 'paragraph:1',
      }],
      claims,
      signals: [],
      gaps: [],
      assumptions: [assumption],
      estimates: [],
      deliverables: [],
      shortIdMap: { c01: 'internal-company-size', c02: null },
    },
    analysis: {
      verdict: {
        headline: 'The account is qualified for a discovery conversation.',
        qualification: 'qualified',
        recommendedProduct: 'product-a',
        nextAction: 'Validate the current process.',
        blockers: [],
      },
      buyingCommittee: [],
      volumeModel: {
        baseClaimId: 'c01',
        assumptions: [assumption],
        scenarios: [
          { label: 'Low', multiplier: 1, eventsPerYear: 300, eventsPerMonth: 25, hoursPerMonth: 2 },
          { label: 'Base', multiplier: 2, eventsPerYear: 600, eventsPerMonth: 50, hoursPerMonth: 4 },
          { label: 'High', multiplier: 3, eventsPerYear: 900, eventsPerMonth: 75, hoursPerMonth: 6 },
        ],
        baseScenarioIndex: 1,
        caveats: [],
      },
      signalIds: [],
      fitByProduct: [{
        productKey: 'product-a',
        verdict: 'possible',
        rationale: 'The account size is in range.',
        claimIds: ['c01'],
        headquartersContextClaimIds: [],
        validationQuestion: 'Does the local operation own this process?',
      }],
      entryAngle: { channel: 'email', timing: 'After validation.', hooks: ['Local scale'] },
      discoveryQuestions: [{ question: 'How much work is currently manual?', validatesClaimId: 'c02' }],
      objections: [],
      riskClaimIds: ['c02'],
      gapIds: [],
    },
    sections: ReportV2SectionKeySchema.options.map((key) => ({
      key,
      title: key,
      paragraphs: key === 'fit' ? [{ text: 'The local operation is in scope.', claimIds: ['c01'], context: 'target' }] : [],
      blocks: [],
    })),
    coverage: { ratio: 1, filled: ['company_size'], missing: [] },
    audit: { status: 'passed', model: 'test-auditor', issues: [] },
    synthesis: {
      status: 'completed',
      provider: 'openai',
      promptVersion: 'report-v2/test',
      generatedAt: now,
      acceptedModelBySection: {},
    },
  };
}

test('assigns deterministic compact IDs and preserves the internal claim map', () => {
  assert.equal(buildStableReportV2Id('src', { b: 2, a: 1 }), buildStableReportV2Id('src', { a: 1, b: 2 }));
  const assigned = assignShortClaimIds([{ internalId: 'uuid-a', value: 1 }, { internalId: 'uuid-b', value: 2 }]);
  assert.deepEqual(assigned.claims.map((claim) => claim.id), ['c01', 'c02']);
  assert.deepEqual(assigned.shortIdMap, { c01: 'uuid-a', c02: 'uuid-b' });
});

test('enforces certainty-specific claim requirements', () => {
  assert.throws(() => ClaimV2Schema.parse({
    id: 'c01',
    internalId: null,
    type: 'fact',
    dimension: 'company_size',
    statement: 'Example employs 300 people.',
    evidenceIds: [],
    observedAt: now,
    freshnessDays: 0,
    jurisdiction: 'PE',
    confidence: 0.9,
  }));
  assert.throws(() => ClaimV2Schema.parse({
    id: 'c02',
    internalId: null,
    type: 'hypothesis',
    dimension: 'risk',
    statement: 'Manual processing may create avoidable work.',
    evidenceIds: [],
    observedAt: null,
    freshnessDays: null,
    jurisdiction: 'PE',
    confidence: 0.5,
    validationQuestion: 'Validate this later',
  }));
});

test('validates all 15 sections and evidence graph references', () => {
  const report = validateReportV2(validReport());
  assert.equal(report.sections.length, 15);
  assert.deepEqual(report.sections.map((section) => section.key), ReportV2SectionKeySchema.options);
});

test('rejects missing references and cross-jurisdiction fit claims', () => {
  const report: any = validReport();
  report.evidenceGraph.claims[0].jurisdiction = 'CL';
  assert.throws(
    () => validateReportV2(report),
    (error) => error instanceof ReportV2IntegrityError
      && error.issues.some((issue) => issue.startsWith('fit_jurisdiction_mismatch')),
  );
});

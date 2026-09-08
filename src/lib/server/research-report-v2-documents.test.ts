import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import { ReportV2Schema, validateReportV2, type ReportV2 } from '@/lib/report-v2-contracts';
import { projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { DRAFT_FIXTURE_NOW, draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';
import {
  RESEARCH_REPORT_V2_RUNTIME_VERSION,
  researchReportV2DocumentInternals,
  tryEnsureResearchReportDocumentV2,
  type StoredResearchReportDocumentV2,
} from '@/lib/server/research-report-v2-documents';

function fixture() {
  const raw = structuredClone(draftSnapshotFixture());
  raw.evidence = raw.evidence.map((evidence) => ({ ...evidence, observedAt: '2026-08-20T12:00:00.000Z' }));
  const snapshot = ResearchSnapshotV1Schema.parse(raw);
  const sellerProfile = { companyName: 'Northstar', products: [{ key: 'ops', name: 'Ops' }] };
  const projection = projectResearchSnapshotV1ToReportV2({
    snapshot,
    sellerProfile,
    icpRules: null,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const sectionKeys = [
    'verdict', 'snapshot', 'contact', 'committee', 'company', 'volume', 'regulatory', 'signals',
    'fit', 'angle', 'discovery', 'objections', 'risks', 'gaps', 'sources',
  ] as const;
  const document = validateReportV2(ReportV2Schema.parse({
    kind: 'research_report_document',
    schemaVersion: 'research-report-document/v2',
    id: 'report-v2:fixture',
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
      verdict: { headline: 'Revisar', qualification: projection.qualification.verdict, recommendedProduct: 'ops', nextAction: 'Validar', blockers: [] },
      buyingCommittee: projection.committee,
      volumeModel: null,
      signalIds: [], fitByProduct: [],
      entryAngle: { channel: 'email', timing: 'Ahora', hooks: [] },
      discoveryQuestions: [], objections: [], riskClaimIds: [], gapIds: [],
    },
    sections: sectionKeys.map((key) => ({ key, title: key, paragraphs: [], blocks: [] })),
    coverage: { ratio: 0, filled: [], missing: [] },
    audit: { status: 'passed', model: 'audit-test', issues: [] },
    synthesis: {
      status: 'partial', provider: 'openai', promptVersion: RESEARCH_REPORT_V2_RUNTIME_VERSION,
      generatedAt: DRAFT_FIXTURE_NOW.toISOString(), acceptedModelBySection: {},
    },
  }));
  const stored: StoredResearchReportDocumentV2 = {
    id: '60000000-0000-4000-8000-000000000001',
    researchSnapshotId: snapshot.id,
    organizationId: snapshot.scope.organizationId!,
    userId: snapshot.scope.ownerUserId,
    schemaVersion: 'research-report-document/v2',
    deliveryState: 'visible',
    status: 'partial',
    generationMethod: 'model',
    provider: 'openai',
    model: 'test-model',
    promptVersion: RESEARCH_REPORT_V2_RUNTIME_VERSION,
    contentHash: canonicalSha256(document),
    retryable: true,
    errorCode: 'report_v2_sections_incomplete',
    errorMessage: 'Incomplete.',
    document,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
    createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
  return { snapshot, sellerProfile, projection, document, stored };
}

test('persists Report V2 and completes the matching durable claim atomically with retryability', async () => {
  const value = fixture();
  let completedRetryable: boolean | undefined;
  const result = await tryEnsureResearchReportDocumentV2({
    snapshot: value.snapshot,
    access: { organizationId: value.snapshot.scope.organizationId!, userId: value.snapshot.scope.ownerUserId },
    sellerProfile: value.sellerProfile,
    icpRules: null,
    synthesisContextHash: 'a'.repeat(64),
    deliveryState: 'visible',
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  }, {
    loadForUpdate: async () => null,
    loadState: async () => null,
    claim: async () => ({ state: { id: 'state-id' }, claimToken: 'claim-token' }) as any,
    project: () => value.projection,
    synthesize: async () => ({
      document: value.document,
      metrics: { sectionAcceptRate: 0.8, claimsPerSource: {}, ownDomainSourceRatio: 1, signalsWithDateCount: 0, committeeMembersFound: 0 },
      metadata: { retryable: true, errorCode: 'report_v2_sections_incomplete', errorMessage: 'Incomplete.' },
    }),
    persist: async (input) => {
      completedRetryable = input.synthesis.metadata.retryable;
      return { document: value.stored, synthesis: { status: 'partial', retryable: true } as any };
    },
  });

  assert.equal(result.document, value.stored);
  assert.equal(result.synthesis?.status, 'partial');
  assert.equal(completedRetryable, true);
});

test('rejects a stored V2 row when its canonical content hash does not match', () => {
  const { stored } = fixture();
  const row = {
    id: stored.id,
    research_snapshot_id: stored.researchSnapshotId,
    organization_id: stored.organizationId,
    user_id: stored.userId,
    schema_version: stored.schemaVersion,
    delivery_state: stored.deliveryState,
    status: stored.status,
    generation_method: stored.generationMethod,
    provider: stored.provider,
    model: stored.model,
    prompt_version: stored.promptVersion,
    revision: stored.document.revision,
    content_hash: '0'.repeat(64),
    retryable: stored.retryable,
    error_code: stored.errorCode,
    error_message: stored.errorMessage,
    document: stored.document as ReportV2,
    generated_at: stored.generatedAt,
    created_at: stored.createdAt,
    updated_at: stored.updatedAt,
  };
  assert.equal(researchReportV2DocumentInternals.mapStoredDocumentV2(row), null);
});

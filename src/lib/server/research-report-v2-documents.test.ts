import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalSha256 } from '@/lib/messaging-contracts';
import { ReportV2Schema, validateReportV2, type ReportV2 } from '@/lib/report-v2-contracts';
import { projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { ResearchSnapshotV1Schema } from '@/lib/research-contracts';
import { DRAFT_FIXTURE_NOW, draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';
import {
  RESEARCH_REPORT_V2_RUNTIME_VERSION,
  loadResearchReportDocumentV2,
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
    research: async () => ({ ...value.projection, researchWarnings: [], researchMetrics: { queries: 0, pages: 0, elapsedMs: 0 } }),
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

test('exhausts the editorial retry after the second claimed V2 attempt and exposes an actionable task', async () => {
  const value = fixture();
  const failure: { value: { retryable?: boolean; errorCode?: string; errorMessage?: string } | null } = { value: null };
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
    claim: async () => ({ state: { id: 'state-id', attemptCount: 2 }, claimToken: 'claim-token' }) as any,
    project: () => value.projection,
    research: async () => ({ ...value.projection, researchWarnings: [], researchMetrics: { queries: 0, pages: 0, elapsedMs: 0 } }),
    synthesize: async () => { throw new Error('editor failure'); },
    fail: async (input) => {
      failure.value = input;
      return { status: 'failed_permanent', retryable: false } as any;
    },
  });

  assert.equal(result.document, null);
  assert.equal(failure.value?.retryable, false);
  assert.equal(failure.value?.errorCode, 'report_v2_generation_failed');
  assert.match(failure.value?.errorMessage || '', /Tarea accionable/);
});

test('cached synthesis requires matching delivery, context, runtime and durable document pointer', async () => {
  for (const mismatch of ['none', 'delivery', 'context', 'runtime', 'pointer', 'retryable']) {
    const value = fixture();
    value.stored.retryable = false;
    if (mismatch === 'delivery') value.stored.deliveryState = 'suppressed';
    if (mismatch === 'runtime') value.stored.promptVersion = 'old';
    const state = { reportDocumentId: mismatch === 'pointer' ? 'other' : value.stored.id, sellerProfileHash: mismatch === 'context' ? 'b'.repeat(64) : 'a'.repeat(64), status: 'partial', retryable: mismatch === 'retryable' } as any;
    let claims = 0;
    let persisted = 0;
    const result = await tryEnsureResearchReportDocumentV2({
      snapshot: value.snapshot, access: { organizationId: value.stored.organizationId, userId: value.stored.userId },
      sellerProfile: value.sellerProfile, icpRules: null, synthesisContextHash: 'a'.repeat(64), deliveryState: 'visible',
    }, {
      loadForUpdate: async () => value.stored,
      loadState: async () => state,
      claim: async () => { claims++; return null; },
      persist: async () => { persisted++; throw new Error('Unexpected write'); },
      synthesize: async () => { throw new Error('Unexpected paid call'); },
    });
    assert.equal(claims, mismatch === 'none' ? 0 : 1);
    assert.equal(persisted, 0);
    assert.equal(result.metrics, null);
    // Internal update reads may return suppressed content, but never promote it.
    assert.equal(result.document?.deliveryState, value.stored.deliveryState);
  }
});

test('scope mismatch rejects before cache access or synthesis', async () => {
  for (const mismatch of ['owner', 'organization']) {
    const value = fixture();
    await assert.rejects(tryEnsureResearchReportDocumentV2({
      snapshot: value.snapshot,
      access: { organizationId: mismatch === 'organization' ? 'other-org' : value.stored.organizationId, userId: mismatch === 'owner' ? 'other-owner' : value.stored.userId },
      sellerProfile: value.sellerProfile, icpRules: null, synthesisContextHash: 'a'.repeat(64), deliveryState: 'visible',
    }, { loadForUpdate: async () => { assert.fail('must not read cache'); } }), /SCOPE_MISMATCH/);
  }
});

test('public document reads constrain snapshot, owner, organizations and visible delivery', async () => {
  const filters: unknown[][] = [];
  const query = {
    select() { return query; }, eq(...args: unknown[]) { filters.push(args); return query; },
    in(...args: unknown[]) { filters.push(args); return query; }, order() { return query; }, limit() { return query; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  await loadResearchReportDocumentV2({ researchSnapshotId: 'snapshot', access: { organizationId: 'org', organizationIds: ['org', 'shared'], userId: 'owner' } }, { from: () => query });
  assert.ok(filters.some(([key, value]) => key === 'delivery_state' && value === 'visible'));
  assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'owner'));
  assert.ok(filters.some(([key, value]) => key === 'research_snapshot_id' && value === 'snapshot'));
  assert.deepEqual(filters.find(([key]) => key === 'organization_id'), ['organization_id', ['org', 'shared']]);
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

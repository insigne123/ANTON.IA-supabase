import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ReportSynthesisFailed,
  RESEARCH_REPORT_PROMPT_VERSION,
  buildDeterministicResearchReportDocumentV1,
  sellerProfileHash,
  type ResearchReportSynthesisResult,
} from '@/ai/flows/synthesize-research-report';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  type ResearchReportSynthesisState,
} from '@/lib/server/research-report-synthesis-state';
import { DRAFT_FIXTURE_IDS, DRAFT_FIXTURE_NOW, draftSnapshotFixture } from './draft-v2-test-fixtures';
import {
  ResearchReportDocumentUnavailable,
  ensureResearchReportDocument,
  researchReportDocumentInternals,
  tryEnsureResearchReportDocument,
  type StoredResearchReportDocument,
} from './research-report-documents';

const foundationMigration = readFileSync('supabase/migrations/20260908173355_report_v2_foundation.sql', 'utf8');
const pipeline = readFileSync('src/lib/server/native-research.ts', 'utf8');
const detailRoute = readFileSync('src/app/api/native-research/[reportId]/route.ts', 'utf8');
const reportStore = readFileSync('src/lib/server/research-report-documents.ts', 'utf8');

function modelSynthesis(): ResearchReportSynthesisResult {
  const snapshot = draftSnapshotFixture();
  const base = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const document = {
    ...base,
    synthesis: {
      ...base.synthesis,
      method: 'model' as const,
      model: 'test-model',
    },
  };
  return {
    document,
    metadata: {
      status: 'partial',
      generationMethod: 'model',
      provider: 'openai',
      model: 'test-model',
      promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
      sellerProfileHash: document.synthesis.sellerProfileHash!,
      retryable: false,
      errorCode: null,
      errorMessage: null,
    },
  };
}

function storedModel(): StoredResearchReportDocument {
  const synthesis = modelSynthesis();
  return {
    id: 'stored-report-id',
    researchSnapshotId: synthesis.document.researchSnapshotId,
    organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user,
    schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    deliveryState: 'visible',
    status: synthesis.metadata.status,
    generationMethod: 'model',
    provider: 'openai',
    model: synthesis.metadata.model,
    promptVersion: synthesis.metadata.promptVersion,
    contentHash: canonicalSha256(synthesis.document),
    retryable: false,
    errorCode: null,
    errorMessage: null,
    document: synthesis.document,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
    createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
}

function synthesisState(status: ResearchReportSynthesisState['status']): ResearchReportSynthesisState {
  return {
    id: 'synthesis-state-id',
    researchSnapshotId: draftSnapshotFixture().id,
    organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user,
    schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    status,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
    sellerProfileHash: sellerProfileHash(null),
    attemptCount: status === 'running' ? 1 : 0,
    retryable: !['completed', 'partial', 'failed_permanent'].includes(status),
    errorCode: null,
    errorMessage: null,
    claimToken: status === 'running' ? 'claim-token' : null,
    claimedAt: status === 'running' ? DRAFT_FIXTURE_NOW.toISOString() : null,
    nextRetryAt: DRAFT_FIXTURE_NOW.toISOString(),
    reportDocumentId: null,
    completedAt: null,
    createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
}

test('report foundation supports versioned documents and service-owned synthesis states', () => {
  assert.match(foundationMigration, /research_report_documents_snapshot_schema_generated_idx/);
  assert.doesNotMatch(foundationMigration, /research_report_documents_snapshot_schema_key/);
  assert.match(foundationMigration, /persist_research_report_synthesis_result_v1/);
  assert.match(foundationMigration, /delivery_state in \('visible', 'suppressed'\)/);
  assert.match(foundationMigration, /research-report-document\/v2/);
  assert.match(foundationMigration, /create table if not exists public\.research_report_synthesis_states/);
  assert.match(foundationMigration, /grant select on table public\.research_report_synthesis_states to authenticated/);
  assert.match(foundationMigration, /grant all on table public\.research_report_synthesis_states to service_role/);
  assert.doesNotMatch(foundationMigration, /for (?:insert|update|delete) to authenticated/i);
  assert.match(foundationMigration, /interval '1 minute'/);
  assert.match(foundationMigration, /interval '5 minutes'/);
  assert.match(foundationMigration, /interval '30 minutes'/);
  assert.match(foundationMigration, /attempt_count between 0 and 4/);
  assert.match(foundationMigration, /attempt_count < 4/);
  assert.match(foundationMigration, /failed_permanent/);
  assert.match(foundationMigration, /report_v2_migration_canonical_jsonb/);
  assert.match(foundationMigration, /RESEARCH_REPORT_EXISTING_CONTENT_HASH_INVALID/);
  assert.match(foundationMigration, /revoke all on table public\.messaging_draft_generation_metadata from public, anon, authenticated/);
  assert.match(reportStore, /\.eq\('schema_version', RESEARCH_REPORT_V1_SCHEMA_VERSION\)/);
  assert.match(reportStore, /\.eq\('delivery_state', 'visible'\)/);
  assert.match(reportStore, /\.eq\('generation_method', 'model'\)/);
  assert.match(reportStore, /persistResearchReportSynthesisResult/);
});

test('native processing owns synthesis while detail GET remains read-only', () => {
  assert.match(pipeline, /tryEnsureResearchReportDocument\(\{ snapshot, access, sellerProfile \}\)/);
  assert.match(pipeline, /processResearchReportSynthesisQueue/);
  assert.match(detailRoute, /loadResearchReportDocument/);
  assert.match(detailRoute, /loadResearchReportSynthesisState/);
  assert.match(detailRoute, /retryResearchReportSynthesis/);
  assert.doesNotMatch(detailRoute, /ensureResearchReportDocument/);
  assert.doesNotMatch(detailRoute, /loadSellerProfile/);
});

test('successful synthesis is persisted and completes its durable claim', async () => {
  const snapshot = draftSnapshotFixture();
  const synthesis = modelSynthesis();
  const stored = storedModel();
  let persists = 0;

  const result = await tryEnsureResearchReportDocument({
    snapshot,
    access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user },
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  }, {
    load: async () => null,
    claim: async () => ({ state: synthesisState('running'), claimToken: 'claim-token' }),
    synthesize: async () => synthesis,
    persist: async () => {
      persists += 1;
      return { document: stored, synthesis: { ...synthesisState('completed'), reportDocumentId: stored.id } };
    },
  });

  assert.equal(result.document, stored);
  assert.equal(result.synthesis?.status, 'completed');
  assert.equal(persists, 1);
});

test('total model failure schedules a retry without persisting a document', async () => {
  const snapshot = draftSnapshotFixture();
  let persists = 0;
  let failures = 0;
  const retryState = {
    ...synthesisState('retry_scheduled'),
    attemptCount: 1,
    retryable: true,
    errorCode: 'report_synthesis_failed',
  };
  const dependencies = {
    load: async () => null,
    claim: async () => ({ state: synthesisState('running'), claimToken: 'claim-token' }),
    synthesize: async () => { throw new ReportSynthesisFailed(5); },
    persist: async () => {
      persists += 1;
      return { document: storedModel(), synthesis: synthesisState('completed') };
    },
    fail: async () => { failures += 1; return retryState; },
  };

  const result = await tryEnsureResearchReportDocument({
    snapshot,
    access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user },
  }, dependencies);
  assert.equal(result.document, null);
  assert.equal(result.synthesis?.status, 'retry_scheduled');
  assert.equal(persists, 0);
  assert.equal(failures, 1);

  await assert.rejects(
    () => ensureResearchReportDocument({
      snapshot,
      access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user },
    }, dependencies),
    ResearchReportDocumentUnavailable,
  );
});

test('a current model document is reused without acquiring another claim', async () => {
  const snapshot = draftSnapshotFixture();
  const stored = storedModel();
  let claims = 0;
  const result = await ensureResearchReportDocument({
    snapshot,
    access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user },
  }, {
    load: async () => stored,
    loadState: async () => ({ ...synthesisState('completed'), reportDocumentId: stored.id }),
    claim: async () => { claims += 1; return null; },
  });
  assert.equal(result, stored);
  assert.equal(claims, 0);
});

test('report transitions remain version-local and never prefer fallback', () => {
  const stored = storedModel();
  const fallback = { ...stored, generationMethod: 'fallback' as const, retryable: true };
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(null, 'model'), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(fallback, 'model'), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(stored, 'fallback'), false);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(stored, 'model'), false);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition({ ...stored, promptVersion: 'legacy/v1' }, 'model'), true);
});

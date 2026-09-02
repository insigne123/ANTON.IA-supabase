import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDeterministicResearchReportDocumentV1,
  RESEARCH_REPORT_PROMPT_VERSION,
  sellerProfileHash,
  type ResearchReportSynthesisResult,
} from '@/ai/flows/synthesize-research-report';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { DRAFT_FIXTURE_IDS, DRAFT_FIXTURE_NOW, draftSnapshotFixture } from './draft-v2-test-fixtures';
import {
  ensureResearchReportDocument,
  researchReportDocumentInternals,
  type StoredResearchReportDocument,
} from './research-report-documents';

const migration = readFileSync('supabase/migrations/20260824180000_research_report_documents.sql', 'utf8');
const pipeline = readFileSync('src/lib/server/native-research.ts', 'utf8');
const detailRoute = readFileSync('src/app/api/native-research/[reportId]/route.ts', 'utf8');

test('report document migration is tenant-readable and service-write-only', () => {
  assert.match(migration, /research_snapshot_id uuid not null unique/);
  assert.match(migration, /foreign key \(research_snapshot_id, organization_id, user_id\)[\s\S]+research_snapshots\(id, organization_id, user_id\) on delete cascade/);
  assert.match(migration, /alter table public\.research_report_documents enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /organization_members/);
  assert.match(migration, /revoke all on table public\.research_report_documents from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.research_report_documents to authenticated/);
  assert.match(migration, /grant all on table public\.research_report_documents to service_role/);
  assert.doesNotMatch(migration, /for (?:insert|update|delete) to authenticated/i);
});

test('native processing checkpoints the snapshot before synthesis and detail GET exposes the document', () => {
  const normalFlow = pipeline.slice(
    pipeline.indexOf('const output = buildSnapshot'),
    pipeline.indexOf("console.info('[native-research] completed"),
  );
  const terminal = normalFlow.indexOf("phase: 'store_terminal'");
  const snapshotRow = normalFlow.indexOf('persistNativeSnapshotRow');
  const synthesis = normalFlow.indexOf('ensureNativeResearchReport');
  const settlement = normalFlow.indexOf('updateRunItem');
  assert.ok(terminal >= 0 && snapshotRow > terminal && synthesis > snapshotRow && settlement > synthesis);
  assert.match(pipeline, /terminalCheckpointStored = true/);
  assert.match(pipeline, /ensureResearchReportDocument\(\{ snapshot, access, sellerProfile \}\)/);
  assert.match(detailRoute, /ensureResearchReportDocument/);
  assert.match(detailRoute, /loadSellerProfile/);
  assert.match(detailRoute, /reportDocument: reportDocument\?\.document \|\| null/);
  assert.match(detailRoute, /reportSynthesis:/);
});

test('a historical snapshot without a report is lazily synthesized and persisted through dependency seams', async () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const synthesis: ResearchReportSynthesisResult = {
    document,
    metadata: {
      status: 'partial',
      generationMethod: 'fallback',
      provider: 'openai',
      model: null,
      promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
      sellerProfileHash: document.synthesis.sellerProfileHash!,
      retryable: true,
      errorCode: 'report_synthesis_failed',
      errorMessage: 'Deterministic test fallback.',
    },
  };
  const stored: StoredResearchReportDocument = {
    id: 'stored-report-id',
    researchSnapshotId: snapshot.id,
    organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user,
    status: 'partial',
    generationMethod: 'fallback',
    provider: 'openai',
    model: null,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
    contentHash: canonicalSha256(document),
    retryable: true,
    errorCode: 'report_synthesis_failed',
    errorMessage: 'Deterministic test fallback.',
    document,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
    createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
  let synthesizeCalls = 0;
  let upsertCalls = 0;

  const result = await ensureResearchReportDocument({
    snapshot,
    access: {
      organizationId: DRAFT_FIXTURE_IDS.organization,
      userId: DRAFT_FIXTURE_IDS.user,
    },
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  }, {
    load: async () => null,
    synthesize: async () => {
      synthesizeCalls += 1;
      return synthesis;
    },
    upsert: async (input) => {
      upsertCalls += 1;
      assert.equal(input.snapshot.id, snapshot.id);
      assert.equal(input.synthesis, synthesis);
      return stored;
    },
  });

  assert.equal(result, stored);
  assert.equal(synthesizeCalls, 1);
  assert.equal(upsertCalls, 1);
});

test('report persistence permits fallback-to-model and prompt-version upgrades', () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({
    snapshot,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  });
  const fallback: StoredResearchReportDocument = {
    id: 'stored-report-id',
    researchSnapshotId: snapshot.id,
    organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user,
    status: 'partial',
    generationMethod: 'fallback',
    provider: 'openai',
    model: null,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
    contentHash: canonicalSha256(document),
    retryable: true,
    errorCode: 'report_synthesis_failed',
    errorMessage: 'Retryable fallback.',
    document,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(),
    createdAt: DRAFT_FIXTURE_NOW.toISOString(),
    updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
  const model = { ...fallback, generationMethod: 'model' as const, retryable: false };

  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(null, 'fallback'), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(fallback, 'model'), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(fallback, 'fallback'), false);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(model, 'model'), false);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(model, 'fallback'), false);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition({ ...model, promptVersion: 'legacy/v1' }, 'model'), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition({ ...model, promptVersion: 'legacy/v1' }, 'fallback'), true);

  const sellerProfile = { companyName: 'Northstar', services: ['Automatizacion de operaciones'] };
  const profileHash = sellerProfileHash(sellerProfile);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition(fallback, 'fallback', RESEARCH_REPORT_PROMPT_VERSION, profileHash), true);
  assert.equal(researchReportDocumentInternals.shouldPersistResearchReportTransition({
    ...fallback,
    document: { ...fallback.document, synthesis: { ...fallback.document.synthesis, sellerProfileHash: profileHash } },
  }, 'fallback', RESEARCH_REPORT_PROMPT_VERSION, profileHash), false);
});

test('retryable fallback reports retry synthesis while model reports remain immutable', async () => {
  const snapshot = draftSnapshotFixture();
  const document = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt: DRAFT_FIXTURE_NOW.toISOString() });
  const fallback: StoredResearchReportDocument = {
    id: 'stored-report-id', researchSnapshotId: snapshot.id, organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user, status: 'partial', generationMethod: 'fallback', provider: 'openai', model: null,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION, contentHash: canonicalSha256(document), retryable: true,
    errorCode: 'report_synthesis_failed', errorMessage: 'Retryable fallback.', document,
    generatedAt: DRAFT_FIXTURE_NOW.toISOString(), createdAt: DRAFT_FIXTURE_NOW.toISOString(), updatedAt: DRAFT_FIXTURE_NOW.toISOString(),
  };
  let synthesizeCalls = 0;
  let upsertCalls = 0;
  const synthesis: ResearchReportSynthesisResult = {
    document,
    metadata: {
      status: 'partial', generationMethod: 'fallback', provider: 'openai', model: null,
       promptVersion: RESEARCH_REPORT_PROMPT_VERSION, retryable: true,
       sellerProfileHash: document.synthesis.sellerProfileHash!,
       errorCode: 'report_synthesis_failed', errorMessage: 'Retryable fallback.',
    },
  };
  const dependencies = {
    load: async () => fallback,
    synthesize: async () => { synthesizeCalls += 1; return synthesis; },
    upsert: async () => { upsertCalls += 1; return fallback; },
  };

  await ensureResearchReportDocument({ snapshot, access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user } }, dependencies);
  assert.equal(synthesizeCalls, 1);
  assert.equal(upsertCalls, 1);

  synthesizeCalls = 0;
  await ensureResearchReportDocument({ snapshot, access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user } }, {
    ...dependencies,
    load: async () => ({ ...fallback, generationMethod: 'model', retryable: false }),
  });
  assert.equal(synthesizeCalls, 0);
});

test('legacy report coverage is regenerated before current strict validation', async () => {
  const snapshot = draftSnapshotFixture();
  const generatedAt = DRAFT_FIXTURE_NOW.toISOString();
  const currentDocument = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt });
  const legacyDocument = {
    ...currentDocument,
    completeness: {
      ...currentDocument.completeness,
      claimCoverage: { available: 3, represented: 3, score: 1 },
    },
    synthesis: { ...currentDocument.synthesis, promptVersion: 'legacy/v4' },
  };
  const legacy: StoredResearchReportDocument = {
    id: 'stored-report-id', researchSnapshotId: snapshot.id, organizationId: DRAFT_FIXTURE_IDS.organization,
    userId: DRAFT_FIXTURE_IDS.user, status: 'completed', generationMethod: 'model', provider: 'openai', model: 'legacy-model',
    promptVersion: 'legacy/v4', contentHash: canonicalSha256(legacyDocument), retryable: false,
    errorCode: null, errorMessage: null, document: legacyDocument, generatedAt,
    createdAt: generatedAt, updatedAt: generatedAt,
  };
  const synthesis: ResearchReportSynthesisResult = {
    document: currentDocument,
    metadata: {
      status: currentDocument.synthesis.status,
      generationMethod: currentDocument.synthesis.method,
      provider: 'openai', model: null, promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
      sellerProfileHash: currentDocument.synthesis.sellerProfileHash!, retryable: true,
      errorCode: 'report_synthesis_failed', errorMessage: 'Fallback exhaustivo.',
    },
  };
  let synthesizeCalls = 0;

  const result = await ensureResearchReportDocument({
    snapshot,
    access: { organizationId: DRAFT_FIXTURE_IDS.organization, userId: DRAFT_FIXTURE_IDS.user },
  }, {
    load: async () => legacy,
    synthesize: async () => { synthesizeCalls += 1; return synthesis; },
    upsert: async () => ({
      ...legacy,
      status: synthesis.metadata.status,
      generationMethod: synthesis.metadata.generationMethod,
      promptVersion: synthesis.metadata.promptVersion,
      document: synthesis.document,
    }),
  });

  assert.equal(synthesizeCalls, 1);
  assert.equal(result.promptVersion, RESEARCH_REPORT_PROMPT_VERSION);
  assert.deepEqual(result.document.completeness.claimCoverage, { available: 2, represented: 2, score: 1 });
});

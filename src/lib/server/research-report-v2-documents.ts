import { AUDIT_REPORT_V2_PROMPT_VERSION } from '@/ai/flows/audit-report-v2';
import { REASON_REPORT_V2_PROMPT_VERSION, type SellerProfileContextV2 } from '@/ai/flows/reason-about-report-v2-account';
import { SYNTHESIZE_REPORT_V2_PROMPT_VERSION, ReportV2SynthesisFailed, synthesizeReportV2 } from '@/ai/flows/synthesize-report-v2';
import { WRITE_REPORT_V2_SECTION_PROMPT_VERSION } from '@/ai/flows/write-report-v2-section';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { REPORT_V2_SCHEMA_VERSION, validateReportV2, type ReportV2 } from '@/lib/report-v2-contracts';
import { REPORT_V2_SNAPSHOT_ADAPTER_VERSION, projectResearchSnapshotV1ToReportV2 } from '@/lib/report-v2-snapshot-adapter';
import { ResearchSnapshotV1Schema, type ResearchSnapshotV1 } from '@/lib/research-contracts';
import {
  RESEARCH_REPORT_V2_SCHEMA_VERSION,
  claimResearchReportSynthesis,
  failResearchReportSynthesis,
  loadResearchReportSynthesisState,
  mapResearchReportSynthesisState,
  type ResearchReportSynthesisState,
} from '@/lib/server/research-report-synthesis-state';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import type { IcpRulesV2 } from '@/qualification/icp-gate';
import type { ResearchReportDocumentAccess } from './research-report-documents';

export const RESEARCH_REPORT_V2_RUNTIME_VERSION = `report-v2/runtime/1:${canonicalSha256({
  synthesis: SYNTHESIZE_REPORT_V2_PROMPT_VERSION,
  adapter: REPORT_V2_SNAPSHOT_ADAPTER_VERSION,
  reason: REASON_REPORT_V2_PROMPT_VERSION,
  write: WRITE_REPORT_V2_SECTION_PROMPT_VERSION,
  audit: AUDIT_REPORT_V2_PROMPT_VERSION,
}).slice(0, 16)}`;

type ReportV2SynthesisResult = Awaited<ReturnType<typeof synthesizeReportV2>>;

export type StoredResearchReportDocumentV2 = {
  id: string;
  researchSnapshotId: string;
  organizationId: string;
  userId: string;
  schemaVersion: typeof REPORT_V2_SCHEMA_VERSION;
  deliveryState: 'visible' | 'suppressed';
  status: 'completed' | 'partial';
  generationMethod: 'model';
  provider: 'openai';
  model: string | null;
  promptVersion: string;
  contentHash: string;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  document: ReportV2;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportV2GenerationAttempt = {
  document: StoredResearchReportDocumentV2 | null;
  synthesis: ResearchReportSynthesisState | null;
  metrics: ReportV2SynthesisResult['metrics'] | null;
};

export type EnsureResearchReportDocumentV2Dependencies = {
  load?: typeof loadResearchReportDocumentV2;
  loadForUpdate?: typeof loadResearchReportDocumentV2ForUpdate;
  loadState?: typeof loadResearchReportSynthesisState;
  claim?: typeof claimResearchReportSynthesis;
  project?: typeof projectResearchSnapshotV1ToReportV2;
  synthesize?: typeof synthesizeReportV2;
  persist?: typeof persistResearchReportSynthesisResultV2;
  fail?: typeof failResearchReportSynthesis;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function sameInstant(left: unknown, right: unknown) {
  const leftMs = Date.parse(text(left));
  const rightMs = Date.parse(text(right));
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function readableOrganizationIds(access: ResearchReportDocumentAccess) {
  return [...new Set([access.organizationId, ...(access.organizationIds || [])].map(text).filter(Boolean))];
}

function applyReadableScope(query: any, access: ResearchReportDocumentAccess) {
  const organizations = readableOrganizationIds(access);
  return organizations.length === 1
    ? query.eq('organization_id', organizations[0])
    : query.in('organization_id', organizations);
}

function mapStoredDocumentV2(value: any): StoredResearchReportDocumentV2 | null {
  if (!value) return null;
  const status = text(value.status);
  const deliveryState = text(value.delivery_state || 'visible');
  let document: ReportV2;
  try {
    document = validateReportV2(value.document);
  } catch {
    return null;
  }
  if (
    (status !== 'completed' && status !== 'partial')
    || deliveryState !== 'visible' && deliveryState !== 'suppressed'
    || text(value.generation_method) !== 'model'
    || text(value.provider) !== 'openai'
    || text(value.schema_version) !== RESEARCH_REPORT_V2_SCHEMA_VERSION
    || document.schemaVersion !== RESEARCH_REPORT_V2_SCHEMA_VERSION
    || document.researchSnapshotId !== text(value.research_snapshot_id)
    || document.scope.organizationId !== text(value.organization_id)
    || document.scope.ownerUserId !== text(value.user_id)
    || document.revision !== Number(value.revision)
    || document.synthesis.status !== status
    || document.synthesis.promptVersion !== text(value.prompt_version)
    || !sameInstant(document.synthesis.generatedAt, value.generated_at)
    || canonicalSha256(document) !== text(value.content_hash)
  ) return null;
  return {
    id: text(value.id),
    researchSnapshotId: text(value.research_snapshot_id),
    organizationId: text(value.organization_id),
    userId: text(value.user_id),
    schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
    deliveryState,
    status,
    generationMethod: 'model',
    provider: 'openai',
    model: text(value.model) || null,
    promptVersion: text(value.prompt_version),
    contentHash: text(value.content_hash),
    retryable: value.retryable === true,
    errorCode: text(value.error_code) || null,
    errorMessage: text(value.error_message) || null,
    document,
    generatedAt: text(value.generated_at),
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
  };
}

async function loadDocument(input: {
  researchSnapshotId: string;
  access: ResearchReportDocumentAccess;
  visibleOnly: boolean;
  reportDocumentId?: string;
}, admin: any) {
  let query = admin
    .from('research_report_documents')
    .select('*')
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('schema_version', RESEARCH_REPORT_V2_SCHEMA_VERSION)
    .eq('generation_method', 'model')
    .eq('user_id', input.access.userId);
  if (input.reportDocumentId) query = query.eq('id', input.reportDocumentId);
  if (input.visibleOnly) query = query.eq('delivery_state', 'visible');
  query = query.order('revision', { ascending: false }).order('generated_at', { ascending: false }).limit(1);
  const { data, error } = await applyReadableScope(query, input.access).maybeSingle();
  if (error) throw error;
  const stored = mapStoredDocumentV2(data);
  if (data && !stored) throw new Error('RESEARCH_REPORT_V2_DOCUMENT_INVALID');
  return stored;
}

export async function loadResearchReportDocumentV2(input: {
  researchSnapshotId: string;
  access: ResearchReportDocumentAccess;
  reportDocumentId?: string;
  includeSuppressed?: boolean;
}, admin: any = getSupabaseAdminClient()) {
  return loadDocument({ ...input, visibleOnly: input.includeSuppressed !== true }, admin);
}

export async function loadResearchReportDocumentV2ForUpdate(input: {
  researchSnapshotId: string;
  access: ResearchReportDocumentAccess;
  reportDocumentId?: string;
}, admin: any = getSupabaseAdminClient()) {
  return loadDocument({ ...input, visibleOnly: false }, admin);
}

export async function upsertResearchReportDocumentV2(input: {
  snapshot: ResearchSnapshotV1;
  synthesis: ReportV2SynthesisResult;
  deliveryState: 'visible' | 'suppressed';
}, admin: any = getSupabaseAdminClient()) {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  if (!snapshot.scope.organizationId) throw new Error('REPORT_V2_ORGANIZATION_REQUIRED');
  const document = validateReportV2(input.synthesis.document);
  if (
    document.researchSnapshotId !== snapshot.id
    || document.scope.organizationId !== snapshot.scope.organizationId
    || document.scope.ownerUserId !== snapshot.scope.ownerUserId
  ) throw new Error('RESEARCH_REPORT_V2_DOCUMENT_SCOPE_MISMATCH');
  const contentHash = canonicalSha256(document);
  const now = new Date().toISOString();
  const row = {
    research_snapshot_id: snapshot.id,
    organization_id: snapshot.scope.organizationId,
    user_id: snapshot.scope.ownerUserId,
    status: document.synthesis.status,
    generation_method: 'model',
    provider: 'openai',
    model: [...new Set(Object.values(document.synthesis.acceptedModelBySection).filter((model) => model !== 'deterministic' && model !== 'omitted'))].join(',').slice(0, 500) || null,
    prompt_version: document.synthesis.promptVersion,
    schema_version: RESEARCH_REPORT_V2_SCHEMA_VERSION,
    delivery_state: input.deliveryState,
    revision: document.revision,
    document,
    content_hash: contentHash,
    retryable: input.synthesis.metadata.retryable,
    error_code: input.synthesis.metadata.errorCode,
    error_message: input.synthesis.metadata.errorMessage,
    generated_at: document.synthesis.generatedAt,
    updated_at: now,
  };
  const { data, error } = await admin.from('research_report_documents').insert(row).select('*').single();
  if (error && text(error.code) !== '23505') throw error;
  if (data) {
    const stored = mapStoredDocumentV2(data);
    if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_V2_DOCUMENT_PERSISTENCE_CONFLICT');
    return stored;
  }
  const query = admin
    .from('research_report_documents')
    .select('*')
    .eq('research_snapshot_id', snapshot.id)
    .eq('schema_version', RESEARCH_REPORT_V2_SCHEMA_VERSION)
    .eq('revision', document.revision)
    .eq('organization_id', snapshot.scope.organizationId)
    .eq('user_id', snapshot.scope.ownerUserId);
  const { data: winnerData, error: winnerError } = await query.maybeSingle();
  if (winnerError) throw winnerError;
  const winner = mapStoredDocumentV2(winnerData);
  if (!winner || winner.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_V2_DOCUMENT_PERSISTENCE_CONFLICT');
  return winner;
}

export async function persistResearchReportSynthesisResultV2(input: {
  snapshot: ResearchSnapshotV1;
  synthesis: ReportV2SynthesisResult;
  deliveryState: 'visible' | 'suppressed';
  stateId: string;
  claimToken: string;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  const document = validateReportV2(input.synthesis.document);
  const contentHash = canonicalSha256(document);
  const models = [...new Set(Object.values(document.synthesis.acceptedModelBySection)
    .filter((model) => model !== 'deterministic' && model !== 'omitted'))].join(',').slice(0, 500) || null;
  const { data, error } = await admin.rpc('persist_research_report_synthesis_result_v1', {
    p_state_id: input.stateId,
    p_claim_token: input.claimToken,
    p_status: document.synthesis.status,
    p_generation_method: 'model',
    p_provider: 'openai',
    p_model: models,
    p_prompt_version: document.synthesis.promptVersion,
    p_schema_version: RESEARCH_REPORT_V2_SCHEMA_VERSION,
    p_delivery_state: input.deliveryState,
    p_document: document,
    p_content_hash: contentHash,
    p_retryable: input.synthesis.metadata.retryable,
    p_error_code: input.synthesis.metadata.errorCode,
    p_error_message: input.synthesis.metadata.errorMessage,
    p_generated_at: document.synthesis.generatedAt,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  const stored = mapStoredDocumentV2(result?.report_document);
  if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_V2_SYNTHESIS_PERSISTENCE_CONFLICT');
  const synthesis = mapResearchReportSynthesisState(result?.synthesis_state);
  if (!synthesis || synthesis.reportDocumentId !== stored.id) throw new Error('RESEARCH_REPORT_V2_SYNTHESIS_PERSISTENCE_CONFLICT');
  return { document: stored, synthesis };
}

function permanentFailure(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return /REPORT_V2_(?:ORGANIZATION_REQUIRED|COMPANY_DOMAIN_REQUIRED|ICP_CONFIGURATION_INVALID)|REPORT_V2_PRODUCT_FIT_INCOMPLETE/.test(message);
}

export async function tryEnsureResearchReportDocumentV2(input: {
  snapshot: ResearchSnapshotV1;
  access: ResearchReportDocumentAccess;
  sellerProfile: SellerProfileContextV2;
  icpRules: IcpRulesV2 | null;
  synthesisContextHash: string;
  deliveryState: 'visible' | 'suppressed';
  generatedAt?: string;
}, dependencies: EnsureResearchReportDocumentV2Dependencies = {}): Promise<ReportV2GenerationAttempt> {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  const organizations = new Set(readableOrganizationIds(input.access));
  if (
    snapshot.scope.ownerUserId !== input.access.userId
    || !snapshot.scope.organizationId
    || !organizations.has(snapshot.scope.organizationId)
  ) throw new Error('RESEARCH_REPORT_V2_DOCUMENT_SCOPE_MISMATCH');
  const loadForUpdate = dependencies.loadForUpdate || loadResearchReportDocumentV2ForUpdate;
  let existing = await loadForUpdate({ researchSnapshotId: snapshot.id, access: input.access });
  const loadState = dependencies.loadState || loadResearchReportSynthesisState;
  const currentState = await loadState({
    researchSnapshotId: snapshot.id,
    schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
    access: input.access,
  });
  const expectedDeliveryState = input.deliveryState;
  if (
    existing
    && currentState?.reportDocumentId === existing.id
    && existing.promptVersion === RESEARCH_REPORT_V2_RUNTIME_VERSION
    && existing.deliveryState === expectedDeliveryState
    && currentState?.sellerProfileHash === input.synthesisContextHash
    && (currentState.status === 'completed' || currentState.status === 'partial' && !currentState.retryable)
  ) return { document: existing, synthesis: currentState, metrics: null };

  const claim = dependencies.claim || claimResearchReportSynthesis;
  const claimed = await claim({
    researchSnapshotId: snapshot.id,
    schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
    promptVersion: RESEARCH_REPORT_V2_RUNTIME_VERSION,
    sellerProfileHash: input.synthesisContextHash,
    now: input.generatedAt,
  });
  if (!claimed) {
    const state = await loadState({ researchSnapshotId: snapshot.id, schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION, access: input.access });
    return {
      document: state?.reportDocumentId
        ? await loadForUpdate({
            researchSnapshotId: snapshot.id,
            reportDocumentId: state.reportDocumentId,
            access: input.access,
          })
        : null,
      synthesis: state,
      metrics: null,
    };
  }
  existing = await loadForUpdate({ researchSnapshotId: snapshot.id, access: input.access }) || existing;

  try {
    const generatedAt = input.generatedAt || new Date().toISOString();
    const project = dependencies.project || projectResearchSnapshotV1ToReportV2;
    const projection = project({ snapshot, sellerProfile: input.sellerProfile, icpRules: input.icpRules, generatedAt });
    const synthesize = dependencies.synthesize || synthesizeReportV2;
    const synthesis = await synthesize({
      researchSnapshotId: snapshot.id,
      scope: { organizationId: snapshot.scope.organizationId, ownerUserId: snapshot.scope.ownerUserId },
      language: snapshot.request.language,
      ...projection,
      sellerProfile: input.sellerProfile,
      generatedAt,
      promptVersion: RESEARCH_REPORT_V2_RUNTIME_VERSION,
      revision: (existing?.document.revision || 0) + 1,
      synthesisContextHash: input.synthesisContextHash,
    });
    const persist = dependencies.persist || persistResearchReportSynthesisResultV2;
    const persisted = await persist({
      snapshot,
      synthesis,
      deliveryState: input.deliveryState,
      stateId: claimed.state.id,
      claimToken: claimed.claimToken,
      now: generatedAt,
    });
    return { ...persisted, metrics: synthesis.metrics };
  } catch (error) {
    const retryable = error instanceof ReportV2SynthesisFailed ? error.retryable : !permanentFailure(error);
    const fail = dependencies.fail || failResearchReportSynthesis;
    const state = await fail({
      stateId: claimed.state.id,
      claimToken: claimed.claimToken,
      organizationId: snapshot.scope.organizationId,
      researchSnapshotId: snapshot.id,
      schemaVersion: RESEARCH_REPORT_V2_SCHEMA_VERSION,
      errorCode: error instanceof ReportV2SynthesisFailed ? error.code : retryable ? 'report_v2_generation_failed' : 'report_v2_input_invalid',
      errorMessage: error instanceof Error ? error.message : 'Report V2 generation failed.',
      retryable,
      now: input.generatedAt,
    });
    return { document: existing, synthesis: state, metrics: null };
  }
}

export function researchReportDocumentV2Metadata(document: StoredResearchReportDocumentV2) {
  return {
    id: document.id,
    schemaVersion: document.schemaVersion,
    revision: document.document.revision,
    status: document.status,
    generationMethod: document.generationMethod,
    provider: document.provider,
    model: document.model,
    promptVersion: document.promptVersion,
    contentHash: document.contentHash,
    retryable: document.retryable,
    errorCode: document.errorCode,
    errorMessage: document.errorMessage,
    generatedAt: document.generatedAt,
  };
}

export const researchReportV2DocumentInternals = { mapStoredDocumentV2, permanentFailure };

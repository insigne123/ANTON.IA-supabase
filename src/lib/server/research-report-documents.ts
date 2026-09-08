import { canonicalSha256 } from '@/lib/messaging-contracts';
import {
  ResearchReportDocumentV1Schema,
  validateResearchReportDocumentCitationsV1,
  type ResearchReportDocumentV1,
  type ResearchReportSellerContextV1,
} from '@/lib/research-report-contracts';
import { ResearchSnapshotV1Schema, type ResearchSnapshotV1 } from '@/lib/research-contracts';
import {
  RESEARCH_REPORT_PROMPT_VERSION,
  ReportSynthesisFailed,
  sellerProfileHash,
  synthesizeResearchReportDocumentV1,
  type ResearchReportSynthesisResult,
} from '@/ai/flows/synthesize-research-report';
import {
  RESEARCH_REPORT_V1_SCHEMA_VERSION,
  claimResearchReportSynthesis,
  failResearchReportSynthesis,
  loadResearchReportSynthesisState,
  mapResearchReportSynthesisState,
  publicResearchReportSynthesisState,
  type ResearchReportSynthesisState,
} from '@/lib/server/research-report-synthesis-state';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type ResearchReportDocumentAccess = {
  organizationId: string;
  organizationIds?: string[];
  userId: string;
};

export type StoredResearchReportDocument = {
  id: string;
  researchSnapshotId: string;
  organizationId: string;
  userId: string;
  schemaVersion: typeof RESEARCH_REPORT_V1_SCHEMA_VERSION;
  deliveryState: 'visible' | 'suppressed';
  status: 'completed' | 'partial';
  generationMethod: 'model' | 'fallback';
  provider: 'openai';
  model: string | null;
  promptVersion: string;
  contentHash: string;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  document: ResearchReportDocumentV1;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type EnsureResearchReportDocumentDependencies = {
  load?: typeof loadResearchReportDocument;
  synthesize?: typeof synthesizeResearchReportDocumentV1;
  persist?: typeof persistResearchReportSynthesisResult;
  loadState?: typeof loadResearchReportSynthesisState;
  claim?: typeof claimResearchReportSynthesis;
  fail?: typeof failResearchReportSynthesis;
};

export type ResearchReportGenerationAttempt = {
  document: StoredResearchReportDocument | null;
  synthesis: ResearchReportSynthesisState | null;
};

export class ResearchReportDocumentUnavailable extends Error {
  readonly synthesis: ReturnType<typeof publicResearchReportSynthesisState>;

  constructor(synthesis: ResearchReportSynthesisState | null) {
    super('RESEARCH_REPORT_DOCUMENT_UNAVAILABLE');
    this.name = 'ResearchReportDocumentUnavailable';
    this.synthesis = publicResearchReportSynthesisState(synthesis);
  }
}

function shouldPersistResearchReportTransition(
  existing: StoredResearchReportDocument | null,
  incomingMethod: ResearchReportSynthesisResult['metadata']['generationMethod'],
  incomingPromptVersion = RESEARCH_REPORT_PROMPT_VERSION,
  incomingSellerProfileHash?: string,
) {
  return !existing
    || (existing.generationMethod === 'fallback' && incomingMethod === 'model')
    || (existing.status === 'partial' && existing.retryable && incomingMethod === 'model')
    || existing.promptVersion !== incomingPromptVersion
    || (incomingSellerProfileHash !== undefined
      && existing.document.synthesis.sellerProfileHash !== incomingSellerProfileHash);
}

function text(value: unknown) {
  return String(value || '').trim();
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
  const organizationIds = readableOrganizationIds(access);
  return organizationIds.length === 1
    ? query.eq('organization_id', organizationIds[0])
    : query.in('organization_id', organizationIds);
}

function mapStoredDocument(value: any): StoredResearchReportDocument | null {
  if (!value) return null;
  const status = text(value.status);
  const generationMethod = text(value.generation_method);
  const schemaVersion = text(value.schema_version);
  const deliveryState = text(value.delivery_state || 'visible');
  const document = ResearchReportDocumentV1Schema.safeParse(value.document);
  if (
    !document.success
    || (status !== 'completed' && status !== 'partial')
    || (generationMethod !== 'model' && generationMethod !== 'fallback')
    || schemaVersion !== RESEARCH_REPORT_V1_SCHEMA_VERSION
    || (deliveryState !== 'visible' && deliveryState !== 'suppressed')
    || text(value.provider) !== 'openai'
    || document.data.researchSnapshotId !== text(value.research_snapshot_id)
    || document.data.scope.organizationId !== text(value.organization_id)
    || document.data.scope.ownerUserId !== text(value.user_id)
    || document.data.revision !== Number(value.revision)
    || !sameInstant(document.data.synthesis.generatedAt, value.generated_at)
    || canonicalSha256(document.data) !== text(value.content_hash)
  ) return null;
  return {
    id: text(value.id),
    researchSnapshotId: text(value.research_snapshot_id),
    organizationId: text(value.organization_id),
    userId: text(value.user_id),
    schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    deliveryState,
    status,
    generationMethod,
    provider: 'openai',
    model: text(value.model) || null,
    promptVersion: text(value.prompt_version),
    contentHash: text(value.content_hash),
    retryable: value.retryable === true,
    errorCode: text(value.error_code) || null,
    errorMessage: text(value.error_message) || null,
    document: document.data,
    generatedAt: text(value.generated_at),
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
  };
}

export async function loadResearchReportDocument(input: {
  researchSnapshotId: string;
  access: ResearchReportDocumentAccess;
  reportDocumentId?: string;
  includeSuppressed?: boolean;
}, admin: any = getSupabaseAdminClient()) {
  let query = admin
    .from('research_report_documents')
    .select('*')
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('schema_version', RESEARCH_REPORT_V1_SCHEMA_VERSION)
    .eq('generation_method', 'model')
    .eq('user_id', input.access.userId);
  if (input.reportDocumentId) query = query.eq('id', input.reportDocumentId);
  if (input.includeSuppressed !== true) query = query.eq('delivery_state', 'visible');
  query = query.order('generated_at', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  const { data, error } = await applyReadableScope(query, input.access).maybeSingle();
  if (error) throw error;
  const stored = mapStoredDocument(data);
  if (data && !stored) throw new Error('RESEARCH_REPORT_DOCUMENT_INVALID');
  return stored;
}

async function loadResearchReportDocumentForUpdate(input: {
  researchSnapshotId: string;
  access: ResearchReportDocumentAccess;
}, admin: any) {
  const query = admin
    .from('research_report_documents')
    .select('*')
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('schema_version', RESEARCH_REPORT_V1_SCHEMA_VERSION)
    .eq('user_id', input.access.userId)
    .order('generated_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const { data, error } = await applyReadableScope(query, input.access).maybeSingle();
  if (error) throw error;
  const stored = mapStoredDocument(data);
  if (data && !stored) throw new Error('RESEARCH_REPORT_DOCUMENT_INVALID');
  return stored;
}

export async function upsertResearchReportDocument(input: {
  snapshot: ResearchSnapshotV1;
  synthesis: ResearchReportSynthesisResult;
}, admin: any = getSupabaseAdminClient()) {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  if (!snapshot.scope.organizationId) throw new Error('RESEARCH_REPORT_ORGANIZATION_REQUIRED');
  if (input.synthesis.metadata.generationMethod !== 'model') {
    throw new Error('RESEARCH_REPORT_FALLBACK_NOT_PUBLISHABLE');
  }

  let existing = await loadResearchReportDocumentForUpdate({
    researchSnapshotId: snapshot.id,
    access: {
      organizationId: snapshot.scope.organizationId,
      userId: snapshot.scope.ownerUserId,
    },
  }, admin);
  if (!shouldPersistResearchReportTransition(
    existing,
    input.synthesis.metadata.generationMethod,
    input.synthesis.metadata.promptVersion,
    input.synthesis.metadata.sellerProfileHash,
  )) return existing!;

  const document = validateResearchReportDocumentCitationsV1(input.synthesis.document, snapshot);
  const contentHash = canonicalSha256(document);
  const now = new Date().toISOString();
  const row = {
    research_snapshot_id: snapshot.id,
    organization_id: snapshot.scope.organizationId,
    user_id: snapshot.scope.ownerUserId,
    status: input.synthesis.metadata.status,
    generation_method: input.synthesis.metadata.generationMethod,
    provider: input.synthesis.metadata.provider,
    model: input.synthesis.metadata.model,
    prompt_version: input.synthesis.metadata.promptVersion,
    schema_version: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    delivery_state: 'visible',
    revision: document.revision,
    synthesis_context_hash: input.synthesis.metadata.sellerProfileHash,
    document,
    content_hash: contentHash,
    retryable: input.synthesis.metadata.retryable,
    error_code: input.synthesis.metadata.errorCode,
    error_message: input.synthesis.metadata.errorMessage,
    generated_at: document.synthesis.generatedAt,
    updated_at: now,
  };

  const { data, error } = await admin
    .from('research_report_documents')
    .insert(row)
    .select('*')
    .single();
  if (error) throw error;
  const stored = mapStoredDocument(data);
  if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_DOCUMENT_PERSISTENCE_CONFLICT');
  return stored;
}

export async function persistResearchReportSynthesisResult(input: {
  snapshot: ResearchSnapshotV1;
  synthesis: ResearchReportSynthesisResult;
  stateId: string;
  claimToken: string;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  const document = validateResearchReportDocumentCitationsV1(input.synthesis.document, snapshot);
  const contentHash = canonicalSha256(document);
  const { data, error } = await admin.rpc('persist_research_report_synthesis_result_v1', {
    p_state_id: input.stateId,
    p_claim_token: input.claimToken,
    p_status: input.synthesis.metadata.status,
    p_generation_method: input.synthesis.metadata.generationMethod,
    p_provider: input.synthesis.metadata.provider,
    p_model: input.synthesis.metadata.model,
    p_prompt_version: input.synthesis.metadata.promptVersion,
    p_schema_version: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    p_delivery_state: 'visible',
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
  const stored = mapStoredDocument(result?.report_document);
  if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_SYNTHESIS_PERSISTENCE_CONFLICT');
  const synthesis = mapResearchReportSynthesisState(result?.synthesis_state);
  if (!synthesis || synthesis.reportDocumentId !== stored.id) throw new Error('RESEARCH_REPORT_SYNTHESIS_PERSISTENCE_CONFLICT');
  return { document: stored, synthesis };
}

export async function tryEnsureResearchReportDocument(input: {
  snapshot: ResearchSnapshotV1;
  access: ResearchReportDocumentAccess;
  sellerProfile?: Partial<ResearchReportSellerContextV1> | null;
  generatedAt?: string;
}, dependencies: EnsureResearchReportDocumentDependencies = {}): Promise<ResearchReportGenerationAttempt> {
  const snapshot = ResearchSnapshotV1Schema.parse(input.snapshot);
  const readableOrganizations = new Set(readableOrganizationIds(input.access));
  if (
    snapshot.scope.ownerUserId !== input.access.userId
    || !snapshot.scope.organizationId
    || !readableOrganizations.has(snapshot.scope.organizationId)
  ) {
    throw new Error('RESEARCH_REPORT_DOCUMENT_SCOPE_MISMATCH');
  }

  const load = dependencies.load || loadResearchReportDocument;
  const existing = await load({ researchSnapshotId: snapshot.id, access: input.access });
  const expectedSellerProfileHash = sellerProfileHash(input.sellerProfile);
  if (existing) {
    const needsRetry = existing.status === 'partial' && existing.retryable;
    const needsPromptUpgrade = existing.promptVersion !== RESEARCH_REPORT_PROMPT_VERSION;
    const needsSellerProfileUpgrade = existing.document.synthesis.sellerProfileHash !== expectedSellerProfileHash;
    if (!needsRetry && !needsPromptUpgrade && !needsSellerProfileUpgrade) {
      validateResearchReportDocumentCitationsV1(existing.document, snapshot);
      const loadState = dependencies.loadState || loadResearchReportSynthesisState;
      const state = await loadState({
        researchSnapshotId: snapshot.id,
        schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
        access: input.access,
      });
      const stateDocument = state?.reportDocumentId === existing.id
        ? existing
        : state?.reportDocumentId
          ? await load({
              researchSnapshotId: snapshot.id,
              reportDocumentId: state.reportDocumentId,
              access: input.access,
            })
          : null;
      return {
        document: stateDocument?.id === state?.reportDocumentId ? stateDocument : null,
        synthesis: state,
      };
    }
  }

  const claim = dependencies.claim || claimResearchReportSynthesis;
  const claimed = await claim({
    researchSnapshotId: snapshot.id,
    schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
    promptVersion: RESEARCH_REPORT_PROMPT_VERSION,
    sellerProfileHash: expectedSellerProfileHash,
    now: input.generatedAt,
  });
  if (!claimed) {
    const loadState = dependencies.loadState || loadResearchReportSynthesisState;
    const state = await loadState({
      researchSnapshotId: snapshot.id,
      schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
      access: input.access,
    });
    const stateDocument = state?.reportDocumentId === existing?.id
      ? existing
      : state?.reportDocumentId
        ? await load({
            researchSnapshotId: snapshot.id,
            reportDocumentId: state.reportDocumentId,
            access: input.access,
          })
        : null;
    return {
      document: stateDocument?.id === state?.reportDocumentId ? stateDocument : null,
      synthesis: state,
    };
  }

  const synthesize = dependencies.synthesize || synthesizeResearchReportDocumentV1;
  try {
    const synthesis = await synthesize({
      snapshot,
      sellerProfile: input.sellerProfile,
      generatedAt: input.generatedAt,
    });
    validateResearchReportDocumentCitationsV1(synthesis.document, snapshot);
    const persist = dependencies.persist || persistResearchReportSynthesisResult;
    const persisted = await persist({
      snapshot,
      synthesis,
      stateId: claimed.state.id,
      claimToken: claimed.claimToken,
      now: input.generatedAt,
    });
    validateResearchReportDocumentCitationsV1(persisted.document.document, snapshot);
    return persisted;
  } catch (error) {
    const failure = error instanceof ReportSynthesisFailed
      ? error
      : new ReportSynthesisFailed(0, error);
    const fail = dependencies.fail || failResearchReportSynthesis;
    const state = await fail({
      stateId: claimed.state.id,
      claimToken: claimed.claimToken,
      organizationId: snapshot.scope.organizationId,
      researchSnapshotId: snapshot.id,
      schemaVersion: RESEARCH_REPORT_V1_SCHEMA_VERSION,
      errorCode: failure.code,
      errorMessage: failure.message,
      retryable: failure.retryable,
      now: input.generatedAt,
    });
    return { document: existing, synthesis: state };
  }
}

export async function ensureResearchReportDocument(input: {
  snapshot: ResearchSnapshotV1;
  access: ResearchReportDocumentAccess;
  sellerProfile?: Partial<ResearchReportSellerContextV1> | null;
  generatedAt?: string;
}, dependencies: EnsureResearchReportDocumentDependencies = {}) {
  const result = await tryEnsureResearchReportDocument(input, dependencies);
  if (!result.document) throw new ResearchReportDocumentUnavailable(result.synthesis);
  return result.document;
}

export function researchReportDocumentMetadata(document: StoredResearchReportDocument) {
  return {
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

export const researchReportDocumentInternals = { mapStoredDocument, shouldPersistResearchReportTransition };

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
  sellerProfileHash,
  synthesizeResearchReportDocumentV1,
  type ResearchReportSynthesisResult,
} from '@/ai/flows/synthesize-research-report';
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
  upsert?: typeof upsertResearchReportDocument;
};

function shouldPersistResearchReportTransition(
  existing: StoredResearchReportDocument | null,
  incomingMethod: ResearchReportSynthesisResult['metadata']['generationMethod'],
  incomingPromptVersion = RESEARCH_REPORT_PROMPT_VERSION,
  incomingSellerProfileHash?: string,
) {
  return !existing
    || (existing.generationMethod === 'fallback' && incomingMethod === 'model')
    || existing.promptVersion !== incomingPromptVersion
    || (incomingSellerProfileHash !== undefined
      && existing.document.synthesis.sellerProfileHash !== incomingSellerProfileHash);
}

function text(value: unknown) {
  return String(value || '').trim();
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
  const document = ResearchReportDocumentV1Schema.safeParse(value.document);
  if (
    !document.success
    || (status !== 'completed' && status !== 'partial')
    || (generationMethod !== 'model' && generationMethod !== 'fallback')
    || text(value.provider) !== 'openai'
  ) return null;
  return {
    id: text(value.id),
    researchSnapshotId: text(value.research_snapshot_id),
    organizationId: text(value.organization_id),
    userId: text(value.user_id),
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
}, admin: any = getSupabaseAdminClient()) {
  const query = admin
    .from('research_report_documents')
    .select('*')
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('user_id', input.access.userId);
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

  let existing = await loadResearchReportDocument({
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
    schema_version: 'research-report-document/v1',
    document,
    content_hash: contentHash,
    retryable: input.synthesis.metadata.retryable,
    error_code: input.synthesis.metadata.errorCode,
    error_message: input.synthesis.metadata.errorMessage,
    generated_at: document.synthesis.generatedAt,
    updated_at: now,
  };

  if (!existing) {
    const { data, error } = await admin
      .from('research_report_documents')
      .insert(row)
      .select('*')
      .single();
    if (!error) {
      const stored = mapStoredDocument(data);
      if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_DOCUMENT_PERSISTENCE_CONFLICT');
      return stored;
    }
    if (text(error.code) !== '23505') throw error;
    existing = await loadResearchReportDocument({
      researchSnapshotId: snapshot.id,
      access: { organizationId: snapshot.scope.organizationId, userId: snapshot.scope.ownerUserId },
    }, admin);
    if (!existing) throw error;
    if (!shouldPersistResearchReportTransition(
      existing,
      input.synthesis.metadata.generationMethod,
      input.synthesis.metadata.promptVersion,
      input.synthesis.metadata.sellerProfileHash,
    )) return existing;
  }

  const { data, error } = await admin
    .from('research_report_documents')
    .update(row)
    .eq('research_snapshot_id', snapshot.id)
    .eq('organization_id', snapshot.scope.organizationId)
    .eq('user_id', snapshot.scope.ownerUserId)
    .eq('prompt_version', existing.promptVersion)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    const stored = mapStoredDocument(data);
    if (!stored || stored.contentHash !== contentHash) throw new Error('RESEARCH_REPORT_DOCUMENT_PERSISTENCE_CONFLICT');
    return stored;
  }
  const winner = await loadResearchReportDocument({
    researchSnapshotId: snapshot.id,
    access: { organizationId: snapshot.scope.organizationId, userId: snapshot.scope.ownerUserId },
  }, admin);
  if (!winner) throw new Error('RESEARCH_REPORT_DOCUMENT_PERSISTENCE_CONFLICT');
  return winner;
}

export async function ensureResearchReportDocument(input: {
  snapshot: ResearchSnapshotV1;
  access: ResearchReportDocumentAccess;
  sellerProfile?: Partial<ResearchReportSellerContextV1> | null;
  generatedAt?: string;
}, dependencies: EnsureResearchReportDocumentDependencies = {}) {
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
    const needsRetry = existing.generationMethod === 'fallback' && existing.retryable;
    const needsPromptUpgrade = existing.promptVersion !== RESEARCH_REPORT_PROMPT_VERSION;
    const needsSellerProfileUpgrade = existing.document.synthesis.sellerProfileHash !== expectedSellerProfileHash;
    if (!needsRetry && !needsPromptUpgrade && !needsSellerProfileUpgrade) {
      validateResearchReportDocumentCitationsV1(existing.document, snapshot);
      return existing;
    }
  }

  const synthesize = dependencies.synthesize || synthesizeResearchReportDocumentV1;
  const synthesis = await synthesize({
    snapshot,
    sellerProfile: input.sellerProfile,
    generatedAt: input.generatedAt,
  });
  validateResearchReportDocumentCitationsV1(synthesis.document, snapshot);
  const upsert = dependencies.upsert || upsertResearchReportDocument;
  const persisted = await upsert({ snapshot, synthesis });
  validateResearchReportDocumentCitationsV1(persisted.document, snapshot);
  return persisted;
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

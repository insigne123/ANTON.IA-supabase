import { randomUUID } from 'node:crypto';

import { REPORT_V2_SCHEMA_VERSION } from '@/lib/report-v2-contracts';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const RESEARCH_REPORT_V1_SCHEMA_VERSION = 'research-report-document/v1';
export const RESEARCH_REPORT_V2_SCHEMA_VERSION = REPORT_V2_SCHEMA_VERSION;

export type ResearchReportSchemaVersion =
  | typeof RESEARCH_REPORT_V1_SCHEMA_VERSION
  | typeof RESEARCH_REPORT_V2_SCHEMA_VERSION;

export type ResearchReportSynthesisStateStatus =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'completed'
  | 'partial'
  | 'failed_permanent';

export type ResearchReportSynthesisState = {
  id: string;
  researchSnapshotId: string;
  organizationId: string;
  userId: string;
  schemaVersion: ResearchReportSchemaVersion;
  status: ResearchReportSynthesisStateStatus;
  promptVersion: string;
  sellerProfileHash: string;
  attemptCount: number;
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  claimToken: string | null;
  claimedAt: string | null;
  nextRetryAt: string | null;
  reportDocumentId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResearchReportSynthesisAccess = {
  organizationId: string;
  organizationIds?: string[];
  userId: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function mapResearchReportSynthesisState(value: any): ResearchReportSynthesisState | null {
  if (!value) return null;
  const schemaVersion = text(value.schema_version);
  const status = text(value.status);
  if (
    ![RESEARCH_REPORT_V1_SCHEMA_VERSION, RESEARCH_REPORT_V2_SCHEMA_VERSION].includes(schemaVersion)
    || !['queued', 'running', 'retry_scheduled', 'completed', 'partial', 'failed_permanent'].includes(status)
  ) return null;
  return {
    id: text(value.id),
    researchSnapshotId: text(value.research_snapshot_id),
    organizationId: text(value.organization_id),
    userId: text(value.user_id),
    schemaVersion: schemaVersion as ResearchReportSchemaVersion,
    status: status as ResearchReportSynthesisStateStatus,
    promptVersion: text(value.prompt_version),
    sellerProfileHash: text(value.seller_profile_hash),
    attemptCount: Math.max(0, Number(value.attempt_count) || 0),
    retryable: value.retryable === true,
    errorCode: text(value.error_code) || null,
    errorMessage: text(value.error_message) || null,
    claimToken: text(value.claim_token) || null,
    claimedAt: text(value.claimed_at) || null,
    nextRetryAt: text(value.next_retry_at) || null,
    reportDocumentId: text(value.report_document_id) || null,
    completedAt: text(value.completed_at) || null,
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
  };
}

function readableOrganizationIds(access: ResearchReportSynthesisAccess) {
  return [...new Set([access.organizationId, ...(access.organizationIds || [])].map(text).filter(Boolean))];
}

export async function loadResearchReportSynthesisState(input: {
  researchSnapshotId: string;
  schemaVersion: ResearchReportSchemaVersion;
  access: ResearchReportSynthesisAccess;
}, admin: any = getSupabaseAdminClient()) {
  const organizations = readableOrganizationIds(input.access);
  let query = admin
    .from('research_report_synthesis_states')
    .select('*')
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('schema_version', input.schemaVersion)
    .eq('user_id', input.access.userId);
  query = organizations.length === 1
    ? query.eq('organization_id', organizations[0])
    : query.in('organization_id', organizations);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  const state = mapResearchReportSynthesisState(data);
  if (data && !state) throw new Error('RESEARCH_REPORT_SYNTHESIS_STATE_INVALID');
  return state;
}

export async function claimResearchReportSynthesis(input: {
  researchSnapshotId: string;
  schemaVersion: ResearchReportSchemaVersion;
  promptVersion: string;
  sellerProfileHash: string;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const claimToken: string = randomUUID();
  const { data, error } = await admin.rpc('claim_research_report_synthesis_v1', {
    p_research_snapshot_id: input.researchSnapshotId,
    p_schema_version: input.schemaVersion,
    p_prompt_version: input.promptVersion,
    p_seller_profile_hash: input.sellerProfileHash,
    p_claim_token: claimToken,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  const state = mapResearchReportSynthesisState(Array.isArray(data) ? data[0] : data);
  return state ? { state, claimToken } : null;
}

export async function enqueueResearchReportSynthesis(input: {
  researchSnapshotId: string;
  schemaVersion: ResearchReportSchemaVersion;
  promptVersion: string;
  sellerProfileHash: string;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('enqueue_research_report_synthesis_v1', {
    p_research_snapshot_id: input.researchSnapshotId,
    p_schema_version: input.schemaVersion,
    p_prompt_version: input.promptVersion,
    p_seller_profile_hash: input.sellerProfileHash,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  const state = mapResearchReportSynthesisState(Array.isArray(data) ? data[0] : data);
  if (!state) throw new Error('RESEARCH_REPORT_SYNTHESIS_ENQUEUE_FAILED');
  return state;
}

export async function completeResearchReportSynthesis(input: {
  stateId: string;
  claimToken: string;
  status: 'completed' | 'partial';
  reportDocumentId: string;
  retryable?: boolean;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('complete_research_report_synthesis_v1', {
    p_state_id: input.stateId,
    p_claim_token: input.claimToken,
    p_status: input.status,
    p_report_document_id: input.reportDocumentId,
    p_retryable: input.retryable === true,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  const state = mapResearchReportSynthesisState(Array.isArray(data) ? data[0] : data);
  if (!state) throw new Error('RESEARCH_REPORT_SYNTHESIS_COMPLETE_CONFLICT');
  return state;
}

export async function failResearchReportSynthesis(input: {
  stateId: string;
  claimToken: string;
  organizationId: string;
  researchSnapshotId: string;
  schemaVersion: ResearchReportSchemaVersion;
  errorCode: string;
  errorMessage: string;
  retryable?: boolean;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('fail_research_report_synthesis_v1', {
    p_state_id: input.stateId,
    p_claim_token: input.claimToken,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable !== false,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  const state = mapResearchReportSynthesisState(Array.isArray(data) ? data[0] : data);
  if (!state) throw new Error('RESEARCH_REPORT_SYNTHESIS_FAIL_CONFLICT');
  if (state.status === 'failed_permanent') {
    await createAntoniaException(admin, {
      organizationId: input.organizationId,
      category: 'research_report_synthesis',
      severity: 'high',
      title: 'No se pudo sintetizar un reporte de investigacion',
      description: 'La investigacion esta disponible, pero la sintesis agoto sus reintentos.',
      dedupeKey: `research-report-synthesis:${input.researchSnapshotId}:${input.schemaVersion}`,
      payload: {
        researchSnapshotId: input.researchSnapshotId,
        schemaVersion: input.schemaVersion,
        errorCode: input.errorCode,
        attemptCount: state.attemptCount,
      },
    });
  }
  return state;
}

export async function rejectResearchReportSynthesisCandidate(input: {
  stateId: string;
  errorCode: string;
  errorMessage: string;
  retryable?: boolean;
  now?: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('reject_research_report_synthesis_candidate_v1', {
    p_state_id: input.stateId,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable !== false,
    p_now: input.now || new Date().toISOString(),
  });
  if (error) throw error;
  return mapResearchReportSynthesisState(Array.isArray(data) ? data[0] : data);
}

export async function retryResearchReportSynthesis(input: {
  researchSnapshotId: string;
  schemaVersion: ResearchReportSchemaVersion;
  access: ResearchReportSynthesisAccess;
  now?: string;
}, admin: any = getSupabaseAdminClient()): Promise<ResearchReportSynthesisState> {
  const organizations = readableOrganizationIds(input.access);
  let query = admin
    .from('research_report_synthesis_states')
    .update({
      status: 'queued',
      attempt_count: 0,
      retryable: true,
      next_retry_at: input.now || new Date().toISOString(),
      error_code: null,
      error_message: null,
      claim_token: null,
      claimed_at: null,
      completed_at: null,
    })
    .eq('research_snapshot_id', input.researchSnapshotId)
    .eq('schema_version', input.schemaVersion)
    .eq('user_id', input.access.userId)
    .eq('status', 'failed_permanent')
    .select('*');
  query = organizations.length === 1
    ? query.eq('organization_id', organizations[0])
    : query.in('organization_id', organizations);
  const { data, error } = await query.maybeSingle();

  if (error) throw new Error(`REPORT_SYNTHESIS_RETRY_FAILED:${error.message}`);
  if (!data) throw new Error('REPORT_SYNTHESIS_NOT_RETRYABLE');
  const state = mapResearchReportSynthesisState(data);
  if (!state) throw new Error('RESEARCH_REPORT_SYNTHESIS_STATE_INVALID');
  return state;
}

export function publicResearchReportSynthesisState(state: ResearchReportSynthesisState | null) {
  if (!state) return null;
  return {
    status: state.status,
    retryable: state.retryable,
    attemptCount: state.attemptCount,
    nextRetryAt: state.nextRetryAt,
    errorCode: state.errorCode,
    generatedAt: state.completedAt,
    updatedAt: state.updatedAt,
  };
}

export const researchReportSynthesisStateInternals = { mapState: mapResearchReportSynthesisState };

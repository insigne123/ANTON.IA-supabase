import { createHash } from 'node:crypto';

import { adaptLegacyResearchPayloadV1 } from '@/lib/legacy-research-adapter';
import type { LeadResearchReport } from '@/lib/types';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type LeadResearchJobAccess = {
  userId: string;
  organizationId?: string | null;
  scopeKey: string;
};

export type LeadResearchJobLead = {
  leadRef: string;
  leadId?: string | null;
  email?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
};

export type LeadResearchJob = LeadResearchJobAccess & LeadResearchJobLead & {
  providerReportId: string;
  status: string;
  researchSnapshotId?: string | null;
};

export type LeadResearchJobCompletion = {
  providerStatus: string;
  report?: LeadResearchReport | null;
};

export type LeadResearchRequestJob = LeadResearchJobAccess & LeadResearchJobLead & {
  id: string;
  requestIdempotencyKey: string;
  providerReportId: string | null;
  status: string;
  requestClaimState: 'pre_provider' | 'retryable' | 'provider_submitting' | 'terminal_pending' | 'submitted' | 'provider_failed' | 'provider_unknown';
  requestPayload: Record<string, any>;
  resultPayload: Record<string, any> | null;
  researchSnapshotId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type LeadResearchRequestClaim = {
  created: boolean;
  claimed: boolean;
  recovered: boolean;
  claimToken: string | null;
  job: LeadResearchRequestJob;
};

export type LeadResearchJobsRepository = {
  findByProviderReportId: (
    providerReportId: string,
    access: LeadResearchJobAccess,
  ) => Promise<LeadResearchJob | null>;
  insert: (job: LeadResearchJob) => Promise<void>;
  updateStatus: (
    providerReportId: string,
    access: LeadResearchJobAccess,
    completion: LeadResearchJobCompletion,
  ) => Promise<string | null | void>;
};

function normalize(value: unknown) {
  return String(value || '').trim();
}

function normalizeProviderStatus(value: unknown) {
  return normalize(value).toLowerCase() || 'queued';
}

function objectPayload(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function mapRequestJobRow(row: any): LeadResearchRequestJob | null {
  const id = normalize(row?.id);
  const userId = normalize(row?.user_id);
  const organizationId = normalize(row?.organization_id) || null;
  const scopeKey = normalize(row?.scope_key);
  const requestIdempotencyKey = normalize(row?.request_idempotency_key);
  const requestClaimState = normalize(row?.request_claim_state) as LeadResearchRequestJob['requestClaimState'];
  if (!id || !userId || !scopeKey || !requestIdempotencyKey || !requestClaimState) return null;

  return {
    id,
    userId,
    organizationId,
    scopeKey,
    requestIdempotencyKey,
    providerReportId: normalize(row?.provider_report_id) || null,
    leadRef: normalize(row?.lead_ref),
    leadId: normalize(row?.lead_id) || null,
    email: normalize(row?.email).toLowerCase() || null,
    companyName: normalize(row?.company_name) || null,
    companyDomain: normalize(row?.company_domain).toLowerCase() || null,
    status: normalizeProviderStatus(row?.status),
    requestClaimState,
    requestPayload: objectPayload(row?.request_payload),
    resultPayload: row?.result_payload == null ? null : objectPayload(row.result_payload),
    researchSnapshotId: normalize(row?.research_snapshot_id) || null,
    errorCode: normalize(row?.error_code) || null,
    errorMessage: normalize(row?.error_message) || null,
  };
}

function getRequestClaimRpcResult(data: any): LeadResearchRequestClaim {
  const job = mapRequestJobRow(data?.job);
  if (!job) throw new Error('INVALID_LEAD_RESEARCH_REQUEST_CLAIM_RESPONSE');
  const claimed = Boolean(data?.claimed);
  const claimToken = normalize(data?.claim_token) || null;
  if (claimed && !claimToken) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_TOKEN_MISSING');
  return {
    created: Boolean(data?.created),
    claimed,
    recovered: Boolean(data?.recovered),
    claimToken,
    job,
  };
}

function mapJobRow(row: any): LeadResearchJob | null {
  const requestPayload = row?.request_payload && typeof row.request_payload === 'object'
    ? row.request_payload
    : {};
  const resultPayload = row?.result_payload && typeof row.result_payload === 'object'
    ? row.result_payload
    : {};
  const providerReportId = normalize(row?.provider_report_id || requestPayload.provider_report_id);
  const userId = normalize(row?.user_id);
  const organizationId = normalize(row?.organization_id);
  const scopeKey = normalize(row?.scope_key || requestPayload.scope_key) || organizationId || `user:${userId}`;
  if (!providerReportId || !userId || !scopeKey) return null;

  return {
    providerReportId,
    userId,
    organizationId,
    scopeKey,
    leadRef: normalize(row?.lead_ref),
    leadId: normalize(row?.lead_id || requestPayload.lead_id) || null,
    email: normalize(row?.email || requestPayload.email).toLowerCase() || null,
    companyName: normalize(row?.company_name || requestPayload.company_name) || null,
    companyDomain: normalize(row?.company_domain || requestPayload.company_domain).toLowerCase() || null,
    status: normalizeProviderStatus(resultPayload.provider_status || requestPayload.provider_status || row?.status),
    researchSnapshotId: normalize(row?.research_snapshot_id) || null,
  };
}

function buildRequestPayload(job: LeadResearchJob) {
  return {
    provider_report_id: job.providerReportId,
    scope_key: job.scopeKey,
    lead_id: job.leadId || null,
    email: job.email || null,
    company_name: job.companyName || null,
    company_domain: job.companyDomain || null,
    provider_status: normalizeProviderStatus(job.status),
  };
}

function buildJobResultPayload(providerStatus: string, report?: LeadResearchReport | null) {
  if (!report) return { provider_status: providerStatus };
  const payload = JSON.parse(JSON.stringify(report));
  payload.provider_status = providerStatus;
  return payload;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function deterministicLeadResearchSnapshotId(input: {
  providerReportId: string;
  scopeKey: string;
  userId: string;
}) {
  const value = createHash('sha256')
    .update(`lead-research-snapshot:v1:${normalize(input.scopeKey)}:${normalize(input.userId)}:${normalize(input.providerReportId)}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  value[12] = '5';
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  const uuid = value.join('');
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`;
}

export async function persistLeadResearchSnapshotIdempotently(input: {
  snapshotId: string;
  insertIfAbsent: () => Promise<void>;
  verifyOwnedSnapshot: () => Promise<boolean>;
  compareAndSetJobSnapshot: () => Promise<void>;
  readJobSnapshotId: () => Promise<string | null>;
}) {
  await input.insertIfAbsent();
  if (!await input.verifyOwnedSnapshot()) throw new Error('LEAD_RESEARCH_SNAPSHOT_ID_CONFLICT');
  await input.compareAndSetJobSnapshot();

  const winnerSnapshotId = normalize(await input.readJobSnapshotId());
  if (!winnerSnapshotId) throw new Error('LEAD_RESEARCH_SNAPSHOT_LINK_FAILED');
  return winnerSnapshotId;
}

function createSupabaseLeadResearchJobsRepository(): LeadResearchJobsRepository {
  function scopeQuery(query: any, access: LeadResearchJobAccess) {
    const organizationId = normalize(access.organizationId);
    return organizationId
      ? query.eq('organization_id', organizationId)
      : query.is('organization_id', null);
  }

  return {
    async findByProviderReportId(providerReportId, access) {
      const query = getSupabaseAdminClient()
        .from('lead_research_jobs')
        .select('scope_key,organization_id,user_id,provider_report_id,lead_ref,lead_id,email,company_name,company_domain,status,request_payload,result_payload,research_snapshot_id')
        .eq('scope_key', access.scopeKey)
        .eq('user_id', access.userId)
        .eq('provider_report_id', providerReportId);
      const { data, error } = await scopeQuery(query, access).maybeSingle();
      if (error) throw error;
      return mapJobRow(data);
    },
    async insert(job) {
      const organizationId = normalize(job.organizationId);
      const providerStatus = normalizeProviderStatus(job.status);
      const running = isActiveLeadResearchJobStatus(providerStatus) && providerStatus !== 'queued';
      const nowIso = new Date().toISOString();
      const { error } = await getSupabaseAdminClient()
        .from('lead_research_jobs')
        .insert({
          organization_id: organizationId || null,
          user_id: job.userId,
          scope_key: job.scopeKey,
          provider_report_id: job.providerReportId,
          lead_ref: job.leadRef,
          lead_id: job.leadId || null,
          email: job.email || null,
          company_name: job.companyName || null,
          company_domain: job.companyDomain || null,
          provider: 'lead-research',
          status: running ? 'running' : 'queued',
          request_payload: buildRequestPayload(job),
          attempt_count: running ? 1 : 0,
          max_attempts: 1,
          started_at: running ? nowIso : null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      if (error) throw error;
    },
    async updateStatus(providerReportId, access, completion) {
      const organizationId = normalize(access.organizationId);
      const providerStatus = normalizeProviderStatus(completion.providerStatus);
      const nowIso = new Date().toISOString();

      const currentQuery = getSupabaseAdminClient()
        .from('lead_research_jobs')
        .select('status,started_at,research_snapshot_id,request_claim_state,lead_id,email,company_name,company_domain')
        .eq('scope_key', access.scopeKey)
        .eq('user_id', access.userId)
        .eq('provider_report_id', providerReportId);
      const { data: current, error: currentError } = await scopeQuery(currentQuery, access).maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new Error('LEAD_RESEARCH_JOB_NOT_FOUND');
      const startedAt = current.started_at || nowIso;
      const existingSnapshotId = normalize(current.research_snapshot_id);
      if (existingSnapshotId) return existingSnapshotId;

      if (isActiveLeadResearchJobStatus(providerStatus)) {
        const updateQuery = getSupabaseAdminClient()
          .from('lead_research_jobs')
          .update({
            status: 'running',
            result_payload: { provider_status: providerStatus },
            attempt_count: 1,
            started_at: startedAt,
            updated_at: nowIso,
          })
          .eq('scope_key', access.scopeKey)
          .eq('user_id', access.userId)
          .eq('provider_report_id', providerReportId);
        const { error } = await scopeQuery(updateQuery, access);
        if (error) throw error;
        return null;
      }

      const report = completion.report;
      if (providerStatus === 'cancelled') {
        if (current.status === 'queued') {
          const startQuery = getSupabaseAdminClient()
            .from('lead_research_jobs')
            .update({ status: 'running', attempt_count: 1, started_at: startedAt, updated_at: nowIso })
            .eq('scope_key', access.scopeKey)
            .eq('user_id', access.userId)
            .eq('provider_report_id', providerReportId);
          const { error: startError } = await scopeQuery(startQuery, access);
          if (startError) throw startError;
        }
        const cancelQuery = getSupabaseAdminClient()
          .from('lead_research_jobs')
          .update({
            status: 'cancelled',
            result_payload: { provider_status: providerStatus },
            attempt_count: 1,
            completed_at: nowIso,
            updated_at: nowIso,
          })
          .eq('scope_key', access.scopeKey)
          .eq('user_id', access.userId)
          .eq('provider_report_id', providerReportId);
        const { error } = await scopeQuery(cancelQuery, access);
        if (error) throw error;
        return null;
      }

      if (providerStatus === 'failed' || providerStatus === 'insufficient_data' || !report) {
        const errorMessage = normalize(report?.raw?.message || report?.raw?.error) || `Provider status: ${providerStatus}`;
        const failedStatus = providerStatus === 'insufficient_data' ? 'insufficient_data' : 'failed';
        const failureQuery = getSupabaseAdminClient()
          .from('lead_research_jobs')
          .update({
            status: failedStatus,
            result_payload: buildJobResultPayload(providerStatus, report),
            error_code: providerStatus,
            error_message: errorMessage,
            attempt_count: 1,
            started_at: startedAt,
            completed_at: nowIso,
            updated_at: nowIso,
          })
          .eq('scope_key', access.scopeKey)
          .eq('user_id', access.userId)
          .eq('provider_report_id', providerReportId);
        const { error } = await scopeQuery(failureQuery, access);
        if (error) throw error;
        return null;
      }

      const snapshotId = deterministicLeadResearchSnapshotId({
        providerReportId,
        scopeKey: access.scopeKey,
        userId: access.userId,
      });
      const adapted = adaptLegacyResearchPayloadV1(report.raw || report, {
        scope: organizationId
          ? { kind: 'organization', organizationId, ownerUserId: access.userId }
          : { kind: 'user', organizationId: null, ownerUserId: access.userId },
        leadRef: normalize(report.meta?.leadRef),
        subject: {
          leadId: normalize((report.meta as any)?.leadId || current.lead_id) || undefined,
          email: normalize((report.meta as any)?.email || current.email).toLowerCase() || undefined,
          company: {
            name: normalize(report.company?.name || current.company_name) || undefined,
            domain: normalize(report.company?.domain || current.company_domain).toLowerCase() || undefined,
            websiteUrl: normalize(report.company?.website) || undefined,
            linkedinUrl: normalize(report.company?.linkedin) || undefined,
            country: normalize(report.company?.country) || undefined,
          },
        },
        provider: 'lead-research',
        providerJobId: providerReportId,
        snapshotId,
        now: () => nowIso,
      });
      const snapshotPayload = adapted.snapshot;
      const serialized = stableJson(snapshotPayload);
      const capturedAtMs = Date.parse(String(snapshotPayload.createdAt || report.createdAt || ''));
      const capturedAt = Number.isFinite(capturedAtMs) ? new Date(capturedAtMs).toISOString() : nowIso;
      const completedStatus = snapshotPayload.lifecycle.status;
      return persistLeadResearchSnapshotIdempotently({
        snapshotId,
        async insertIfAbsent() {
          const { error } = await getSupabaseAdminClient()
            .from('research_snapshots')
            .upsert({
              id: snapshotId,
              scope_key: access.scopeKey,
              organization_id: organizationId || null,
              user_id: access.userId,
              lead_ref: snapshotPayload.subject.leadRef,
              source: 'lead-research',
              schema_version: 1,
              payload: snapshotPayload,
              content_hash: createHash('sha256').update(serialized).digest('hex'),
              captured_at: capturedAt,
              created_at: nowIso,
            }, { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
        },
        async verifyOwnedSnapshot() {
          const snapshotQuery = getSupabaseAdminClient()
            .from('research_snapshots')
            .select('id')
            .eq('id', snapshotId)
            .eq('scope_key', access.scopeKey)
            .eq('user_id', access.userId);
          const { data, error } = await scopeQuery(snapshotQuery, access).maybeSingle();
          if (error) throw error;
          return Boolean(data);
        },
        async compareAndSetJobSnapshot() {
          const successQuery = getSupabaseAdminClient()
            .from('lead_research_jobs')
            .update({
              status: completedStatus,
              ...(current.request_claim_state === 'terminal_pending'
                ? {}
                : { result_payload: buildJobResultPayload(providerStatus, report) }),
              research_snapshot_id: snapshotId,
              attempt_count: 1,
              started_at: startedAt,
              completed_at: nowIso,
              updated_at: nowIso,
            })
            .eq('scope_key', access.scopeKey)
            .eq('user_id', access.userId)
            .eq('provider_report_id', providerReportId)
            .is('research_snapshot_id', null);
          const { error } = await scopeQuery(successQuery, access);
          if (error) throw error;
        },
        async readJobSnapshotId() {
          const winnerQuery = getSupabaseAdminClient()
            .from('lead_research_jobs')
            .select('research_snapshot_id')
            .eq('scope_key', access.scopeKey)
            .eq('user_id', access.userId)
            .eq('provider_report_id', providerReportId);
          const { data, error } = await scopeQuery(winnerQuery, access).maybeSingle();
          if (error) throw error;
          return normalize(data?.research_snapshot_id) || null;
        },
      });
    },
  };
}

export function isActiveLeadResearchJobStatus(status: unknown) {
  return ['queued', 'running', 'in_progress', 'pending', 'processing']
    .includes(normalizeProviderStatus(status));
}

export async function claimLeadResearchRequest(input: LeadResearchJobAccess & LeadResearchJobLead & {
  requestIdempotencyKey: string;
  requestPayload: Record<string, any>;
  staleAfterSeconds?: number;
}, admin: any = getSupabaseAdminClient()): Promise<LeadResearchRequestClaim> {
  const requestIdempotencyKey = normalize(input.requestIdempotencyKey);
  if (!requestIdempotencyKey || requestIdempotencyKey.length > 200) {
    throw new Error('LEAD_RESEARCH_REQUEST_IDENTITY_INVALID');
  }

  const { data, error } = await admin.rpc('claim_lead_research_request_v1', {
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_request_idempotency_key: requestIdempotencyKey,
    p_lead_ref: normalize(input.leadRef),
    p_lead_id: normalize(input.leadId) || null,
    p_email: normalize(input.email).toLowerCase() || null,
    p_company_name: normalize(input.companyName) || null,
    p_company_domain: normalize(input.companyDomain).toLowerCase() || null,
    p_request_payload: objectPayload(input.requestPayload),
    p_stale_after_seconds: Math.max(60, Math.trunc(Number(input.staleAfterSeconds) || 300)),
  });
  if (error) throw error;
  return getRequestClaimRpcResult(data);
}

export async function markLeadResearchRequestProviderSubmitting(input: LeadResearchJobAccess & {
  jobId: string;
  claimToken: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('mark_lead_research_request_submitting_v1', {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
  });
  if (error) throw error;
  if (data !== true) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_LOST');
}

export async function consumeLeadResearchRequestQuota(input: LeadResearchJobAccess & {
  jobId: string;
  claimToken: string;
  limit: number;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('consume_lead_research_request_quota_v1', {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
    p_limit: Math.max(0, Math.trunc(Number(input.limit) || 0)),
  });
  if (error) throw error;
  if (!data || typeof data.allowed !== 'boolean' || !Number.isFinite(Number(data.count))) {
    throw new Error('INVALID_LEAD_RESEARCH_QUOTA_RESPONSE');
  }
  return {
    allowed: data.allowed as boolean,
    count: Number(data.count),
    limit: Number(data.limit ?? input.limit),
    reused: Boolean(data.reused),
  };
}

export async function completeLeadResearchRequestClaim(input: LeadResearchJobAccess & LeadResearchJobLead & {
  jobId: string;
  claimToken: string;
  providerReportId: string;
  status: string;
  requestPayload: Record<string, any>;
  resultPayload?: Record<string, any>;
  phase?: 'store_terminal' | 'release';
}, admin: any = getSupabaseAdminClient()) {
  const providerReportId = normalize(input.providerReportId);
  if (!providerReportId) throw new Error('LEAD_RESEARCH_REPORT_ID_MISSING');
  if (providerReportId.length > 200) throw new Error('LEAD_RESEARCH_REPORT_ID_INVALID');

  const args = {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
    p_provider_report_id: providerReportId,
    p_provider_status: normalizeProviderStatus(input.status),
    p_lead_ref: normalize(input.leadRef),
    p_lead_id: normalize(input.leadId) || null,
    p_email: normalize(input.email).toLowerCase() || null,
    p_company_name: normalize(input.companyName) || null,
    p_company_domain: normalize(input.companyDomain).toLowerCase() || null,
    p_request_payload: objectPayload(input.requestPayload),
  };
  const rpc = input.phase === 'store_terminal'
    ? 'store_lead_research_request_terminal_v1'
    : input.phase === 'release'
      ? 'finalize_lead_research_request_terminal_v1'
      : 'complete_lead_research_request_claim_v1';
  const { data, error } = input.phase === 'store_terminal'
    ? await admin.rpc(rpc, {
      ...args,
      p_result_payload: objectPayload(input.resultPayload),
    })
    : await admin.rpc(rpc, args);
  if (error) throw error;
  const job = mapRequestJobRow(data);
  if (!job) throw new Error('INVALID_LEAD_RESEARCH_REQUEST_COMPLETION_RESPONSE');
  return job;
}

export async function releaseLeadResearchRequestClaim(input: LeadResearchJobAccess & {
  jobId: string;
  claimToken: string;
  errorCode: string;
  errorMessage: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('release_lead_research_request_claim_v1', {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
    p_error_code: normalize(input.errorCode),
    p_error_message: normalize(input.errorMessage),
  });
  if (error) throw error;
  return data === true;
}

export async function markLeadResearchRequestProviderOutcomeUnknown(input: LeadResearchJobAccess & {
  jobId: string;
  claimToken: string;
  errorCode: string;
  errorMessage: string;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('mark_lead_research_request_unknown_v1', {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
    p_error_code: normalize(input.errorCode),
    p_error_message: normalize(input.errorMessage),
  });
  if (error) throw error;
  return data === true;
}

export async function failLeadResearchRequestClaim(input: LeadResearchJobAccess & {
  jobId: string;
  claimToken: string;
  errorCode: string;
  errorMessage: string;
  resultPayload: Record<string, any>;
}, admin: any = getSupabaseAdminClient()) {
  const { data, error } = await admin.rpc('fail_lead_research_request_claim_v1', {
    p_job_id: normalize(input.jobId),
    p_scope_key: normalize(input.scopeKey),
    p_organization_id: normalize(input.organizationId) || null,
    p_user_id: normalize(input.userId),
    p_claim_token: normalize(input.claimToken),
    p_error_code: normalize(input.errorCode),
    p_error_message: normalize(input.errorMessage),
    p_result_payload: objectPayload(input.resultPayload),
  });
  if (error) throw error;
  return data === true;
}

export async function registerLeadResearchJob(
  input: LeadResearchJob,
  repository: LeadResearchJobsRepository = createSupabaseLeadResearchJobsRepository(),
) {
  const providerReportId = normalize(input.providerReportId);
  if (!providerReportId) throw new Error('LEAD_RESEARCH_REPORT_ID_MISSING');
  if (providerReportId.length > 200) throw new Error('LEAD_RESEARCH_REPORT_ID_INVALID');

  const normalized: LeadResearchJob = {
    ...input,
    providerReportId,
    userId: normalize(input.userId),
    organizationId: normalize(input.organizationId) || null,
    scopeKey: normalize(input.scopeKey),
    leadRef: normalize(input.leadRef),
    leadId: normalize(input.leadId) || null,
    email: normalize(input.email).toLowerCase() || null,
    companyName: normalize(input.companyName) || null,
    companyDomain: normalize(input.companyDomain).toLowerCase() || null,
    status: normalizeProviderStatus(input.status),
  };
  if (!normalized.leadRef) throw new Error('LEAD_RESEARCH_LEAD_REF_MISSING');

  const existing = await repository.findByProviderReportId(providerReportId, normalized);
  if (existing) return existing;

  try {
    await repository.insert(normalized);
  } catch (error) {
    const raced = await repository.findByProviderReportId(providerReportId, normalized);
    if (!raced) throw error;
    return raced;
  }

  return normalized;
}

export async function findAuthorizedLeadResearchJob(
  providerReportId: string,
  access: LeadResearchJobAccess,
  repository: LeadResearchJobsRepository = createSupabaseLeadResearchJobsRepository(),
) {
  const job = await repository.findByProviderReportId(normalize(providerReportId), access);
  if (!job || job.scopeKey !== access.scopeKey || job.userId !== access.userId) return null;
  return job;
}

export async function findLatestLeadResearchSnapshotId(
  access: LeadResearchJobAccess,
  leadId: string,
) {
  const normalizedLeadId = normalize(leadId);
  if (!normalizedLeadId) return null;

  const organizationId = normalize(access.organizationId);
  let query = getSupabaseAdminClient()
    .from('lead_research_jobs')
    .select('research_snapshot_id')
    .eq('scope_key', access.scopeKey)
    .eq('user_id', access.userId)
    .eq('lead_id', normalizedLeadId)
    .in('status', ['completed', 'partial'])
    .not('research_snapshot_id', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  query = organizationId
    ? query.eq('organization_id', organizationId)
    : query.is('organization_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return normalize(data?.research_snapshot_id) || null;
}

export async function updateLeadResearchJobStatus(
  providerReportId: string,
  access: LeadResearchJobAccess,
  providerStatus: string,
  report?: LeadResearchReport | null,
  repository: LeadResearchJobsRepository = createSupabaseLeadResearchJobsRepository(),
) {
  return (await repository.updateStatus(normalize(providerReportId), access, { providerStatus, report })) || null;
}

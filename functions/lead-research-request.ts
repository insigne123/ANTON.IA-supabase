import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadResearchRequestJob = {
    id: string;
    providerReportId: string | null;
    requestClaimState: string;
    status: string;
    requestPayload: Record<string, any>;
    resultPayload: Record<string, any> | null;
    researchSnapshotId: string | null;
    leadRef: string;
    leadId: string | null;
    email: string | null;
    companyName: string | null;
    companyDomain: string | null;
    errorCode: string | null;
    errorMessage: string | null;
};

export type LeadResearchRequestOwner = {
    scopeKey: string;
    organizationId: string;
    userId: string;
};

export type LeadResearchRequestIdentity = {
    leadRef: string;
    leadId?: string | null;
    email?: string | null;
    companyName?: string | null;
    companyDomain?: string | null;
};

export type OwnedLeadResearchRequest = LeadResearchRequestOwner & {
    jobId: string;
    claimToken: string;
};

function normalize(value: unknown) {
    return String(value || '').trim();
}

function objectPayload(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

function mapJob(row: any): LeadResearchRequestJob {
    const job = {
        id: normalize(row?.id),
        providerReportId: normalize(row?.provider_report_id) || null,
        requestClaimState: normalize(row?.request_claim_state),
        status: normalize(row?.status).toLowerCase() || 'queued',
        requestPayload: objectPayload(row?.request_payload),
        resultPayload: row?.result_payload == null ? null : objectPayload(row.result_payload),
        researchSnapshotId: normalize(row?.research_snapshot_id) || null,
        leadRef: normalize(row?.lead_ref),
        leadId: normalize(row?.lead_id) || null,
        email: normalize(row?.email).toLowerCase() || null,
        companyName: normalize(row?.company_name) || null,
        companyDomain: normalize(row?.company_domain).toLowerCase() || null,
        errorCode: normalize(row?.error_code) || null,
        errorMessage: normalize(row?.error_message) || null,
    };
    if (!job.id || !job.requestClaimState || !job.leadRef) {
        throw new Error('INVALID_LEAD_RESEARCH_REQUEST_JOB');
    }
    return job;
}

async function rpc(supabase: SupabaseClient, name: string, args: Record<string, any>) {
    const { data, error } = await supabase.rpc(name, args as any);
    if (error) throw error;
    return data as any;
}

export function buildFirebaseLeadResearchRequestKey(input: {
    organizationId: string;
    userId: string;
    taskId: string;
    leadRef: string;
}) {
    const seed = [
        'firebase-investigate/v1',
        normalize(input.organizationId).toLowerCase(),
        normalize(input.userId).toLowerCase(),
        normalize(input.taskId).toLowerCase(),
        normalize(input.leadRef).toLowerCase(),
    ].join('|');
    return `research:v1:${createHash('sha256').update(seed).digest('hex')}`;
}

export async function claimLeadResearchRequest(
    supabase: SupabaseClient,
    input: LeadResearchRequestOwner & LeadResearchRequestIdentity & {
        requestIdempotencyKey: string;
        requestPayload: Record<string, any>;
        staleAfterSeconds?: number;
    },
) {
    const data = await rpc(supabase, 'claim_lead_research_request_v1', {
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_request_idempotency_key: input.requestIdempotencyKey,
        p_lead_ref: input.leadRef,
        p_lead_id: normalize(input.leadId) || null,
        p_email: normalize(input.email).toLowerCase() || null,
        p_company_name: normalize(input.companyName) || null,
        p_company_domain: normalize(input.companyDomain).toLowerCase() || null,
        p_request_payload: objectPayload(input.requestPayload),
        p_stale_after_seconds: Math.max(60, Math.trunc(Number(input.staleAfterSeconds) || 300)),
    });
    const claimed = Boolean(data?.claimed);
    const claimToken = normalize(data?.claim_token) || null;
    if (claimed && !claimToken) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_TOKEN_MISSING');
    return {
        created: Boolean(data?.created),
        claimed,
        recovered: Boolean(data?.recovered),
        claimToken,
        job: mapJob(data?.job),
    };
}

export async function consumeLeadResearchRequestQuota(
    supabase: SupabaseClient,
    input: OwnedLeadResearchRequest & { limit: number },
) {
    const data = await rpc(supabase, 'consume_lead_research_request_quota_v1', {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
        p_limit: Math.max(0, Math.trunc(Number(input.limit) || 0)),
    });
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

export async function markLeadResearchRequestSubmitting(supabase: SupabaseClient, input: OwnedLeadResearchRequest) {
    const updated = await rpc(supabase, 'mark_lead_research_request_submitting_v1', {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
    });
    if (updated !== true) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_LOST');
}

function completionArgs(input: OwnedLeadResearchRequest & LeadResearchRequestIdentity & {
    providerReportId: string;
    providerStatus: string;
    requestPayload: Record<string, any>;
}) {
    return {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
        p_provider_report_id: input.providerReportId,
        p_provider_status: normalize(input.providerStatus).toLowerCase() || 'queued',
        p_lead_ref: input.leadRef,
        p_lead_id: normalize(input.leadId) || null,
        p_email: normalize(input.email).toLowerCase() || null,
        p_company_name: normalize(input.companyName) || null,
        p_company_domain: normalize(input.companyDomain).toLowerCase() || null,
        p_request_payload: objectPayload(input.requestPayload),
    };
}

export async function completeLeadResearchRequestSubmission(
    supabase: SupabaseClient,
    input: OwnedLeadResearchRequest & LeadResearchRequestIdentity & {
        providerReportId: string;
        providerStatus: string;
        requestPayload: Record<string, any>;
    },
) {
    return mapJob(await rpc(
        supabase,
        'complete_lead_research_request_claim_v1',
        completionArgs(input),
    ));
}

export async function releaseLeadResearchRequest(
    supabase: SupabaseClient,
    input: OwnedLeadResearchRequest & { errorCode: string; errorMessage: string },
) {
    return await rpc(supabase, 'release_lead_research_request_claim_v1', {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
    }) === true;
}

export async function failLeadResearchRequest(
    supabase: SupabaseClient,
    input: OwnedLeadResearchRequest & { errorCode: string; errorMessage: string; resultPayload: Record<string, any> },
) {
    return await rpc(supabase, 'fail_lead_research_request_claim_v1', {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
        p_result_payload: objectPayload(input.resultPayload),
    }) === true;
}

export async function markLeadResearchRequestUnknown(
    supabase: SupabaseClient,
    input: OwnedLeadResearchRequest & { errorCode: string; errorMessage: string },
) {
    return await rpc(supabase, 'mark_lead_research_request_unknown_v1', {
        p_job_id: input.jobId,
        p_scope_key: input.scopeKey,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
    }) === true;
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

function deterministicUuid(seed: string) {
    const chars = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
    chars[12] = '5';
    chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
    const value = chars.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function httpUrl(value: unknown) {
    const raw = normalize(value);
    try {
        const url = new URL(raw);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
        return '';
    }
}

function sourceRefs(value: any) {
    return [value?.source_ids, value?.sourceIds, value?.source_id, value?.sourceId, value?.sources]
        .flatMap((item) => Array.isArray(item) ? item : item == null ? [] : [item])
        .map((item) => normalize(item?.id || item?.source_id || item?.sourceId || item?.url || item))
        .filter(Boolean);
}

function statement(value: any) {
    return normalize(typeof value === 'string' ? value : value?.statement || value?.detail || value?.summary || value?.title || value?.text);
}

function buildSnapshot(input: LeadResearchRequestOwner & LeadResearchRequestIdentity & {
    provider: string;
    providerReportId: string;
    providerStatus: string;
    requestIdempotencyKey: string;
    resultPayload: Record<string, any>;
}) {
    const payload = objectPayload(input.resultPayload);
    const now = new Date().toISOString();
    const generatedAtValue = Date.parse(normalize(payload.generated_at || payload.generatedAt || payload.completed_at));
    const generatedAt = Number.isFinite(generatedAtValue) ? new Date(generatedAtValue).toISOString() : now;
    const rawSources = [
        ...(Array.isArray(payload.sources) ? payload.sources : []),
        ...(Array.isArray(payload?.cross?.sources) ? payload.cross.sources : []),
        ...(Array.isArray(payload?.website_summary?.sources) ? payload.website_summary.sources : []),
        ...(Array.isArray(payload?.websiteSummary?.sources) ? payload.websiteSummary.sources : []),
        ...(Array.isArray(payload.signals) ? payload.signals : []),
    ];
    const sourceByReference = new Map<string, string>();
    const sourceByUrl = new Map<string, any>();
    for (const rawSource of rawSources) {
        const url = httpUrl(typeof rawSource === 'string' ? rawSource : rawSource?.url);
        if (!url) continue;
        let source = sourceByUrl.get(url);
        if (!source) {
            const id = `source_${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;
            source = {
                id,
                type: 'other',
                url,
                canonicalUrl: url,
                ...(normalize(rawSource?.title || rawSource?.name) ? { title: normalize(rawSource?.title || rawSource?.name) } : {}),
                provider: input.provider,
                retrievedAt: generatedAt,
                reliability: 0.7,
            };
            sourceByUrl.set(url, source);
        }
        const reference = normalize(rawSource?.id || rawSource?.source_id || rawSource?.sourceId);
        if (reference) sourceByReference.set(reference, source.id);
        sourceByReference.set(url, source.id);
    }

    const allowedClaimKinds = new Set([
        'company_overview', 'company_identity', 'company_industry', 'company_service', 'company_size',
        'company_priority', 'pain_hypothesis', 'opportunity_hypothesis', 'risk_hypothesis',
        'use_case_hypothesis', 'lead_profile', 'lead_role', 'lead_recent_activity',
        'lead_communication_style', 'news_signal', 'hiring_signal', 'technology_signal', 'site_signal',
    ]);
    const candidates: Array<{ value: any; kind: string; scope: 'company' | 'person'; inherited?: string[] }> = [];
    const website = objectPayload(payload.website_summary || payload.websiteSummary);
    const companyContext = objectPayload(payload.company_context);
    const cross = objectPayload(payload?.existing_compat?.cross || payload.cross);
    if (website.overview) candidates.push({ value: website.overview, kind: 'company_overview', scope: 'company', inherited: sourceRefs(website) });
    if (companyContext.overview) candidates.push({ value: companyContext.overview, kind: 'company_overview', scope: 'company', inherited: sourceRefs(companyContext) });
    if (payload.overview) candidates.push({ value: payload.overview, kind: 'company_overview', scope: 'company', inherited: sourceRefs(payload) });
    if (cross.overview) candidates.push({ value: cross.overview, kind: 'company_overview', scope: 'company', inherited: sourceRefs(cross) });
    for (const value of Array.isArray(website.services) ? website.services : []) {
        candidates.push({ value, kind: 'company_service', scope: 'company', inherited: sourceRefs(website) });
    }
    for (const value of Array.isArray(companyContext.pain_hypotheses) ? companyContext.pain_hypotheses : []) {
        candidates.push({ value, kind: 'pain_hypothesis', scope: 'company' });
    }
    for (const value of Array.isArray(companyContext.opportunity_hypotheses) ? companyContext.opportunity_hypotheses : []) {
        candidates.push({ value, kind: 'opportunity_hypothesis', scope: 'company' });
    }
    for (const value of [...(Array.isArray(payload.pains) ? payload.pains : []), ...(Array.isArray(cross.pains) ? cross.pains : [])]) {
        candidates.push({ value, kind: 'pain_hypothesis', scope: 'company' });
    }
    for (const value of [...(Array.isArray(payload.opportunities) ? payload.opportunities : []), ...(Array.isArray(cross.opportunities) ? cross.opportunities : [])]) {
        candidates.push({ value, kind: 'opportunity_hypothesis', scope: 'company' });
    }
    for (const value of Array.isArray(payload.signals) ? payload.signals : []) {
        candidates.push({ value, kind: 'site_signal', scope: 'company' });
    }
    for (const value of Array.isArray(payload.claims) ? payload.claims : []) {
        const rawKind = normalize(value?.kind);
        candidates.push({
            value,
            kind: allowedClaimKinds.has(rawKind) ? rawKind : 'company_overview',
            scope: value?.subjectScope === 'person' ? 'person' : 'company',
        });
    }

    const evidence: any[] = [];
    const claims: any[] = [];
    const evidenceByOriginalId = new Map<string, any>();
    for (const rawEvidence of Array.isArray(payload.evidence) ? payload.evidence : []) {
        evidenceByOriginalId.set(normalize(rawEvidence?.id), rawEvidence);
    }
    for (const candidate of candidates) {
        const text = statement(candidate.value);
        if (text.length < 12) continue;
        let sourceId = '';
        const directUrl = httpUrl(candidate.value?.url || candidate.value?.source_url || candidate.value?.sourceUrl);
        if (directUrl) sourceId = sourceByUrl.get(directUrl)?.id || '';
        const references = [...sourceRefs(candidate.value), ...(candidate.inherited || [])];
        for (const reference of references) {
            sourceId ||= sourceByReference.get(reference) || '';
        }
        for (const evidenceId of Array.isArray(candidate.value?.supportingEvidenceIds) ? candidate.value.supportingEvidenceIds : []) {
            const rawEvidence = evidenceByOriginalId.get(normalize(evidenceId));
            sourceId ||= sourceByReference.get(normalize(rawEvidence?.sourceId || rawEvidence?.source_id)) || '';
        }
        if (!sourceId) continue;
        const seed = `${candidate.kind}|${candidate.scope}|${text}|${sourceId}`;
        const evidenceId = `evidence_${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
        const claimId = `claim_${createHash('sha256').update(`${seed}|claim`).digest('hex').slice(0, 20)}`;
        evidence.push({
            id: evidenceId,
            subjectScope: candidate.scope,
            kind: 'observation',
            path: '$',
            statement: text,
            sourceId,
            extractedAt: generatedAt,
            confidence: 0.7,
            extraction: { method: 'provider', provider: input.provider, version: 'firebase-investigate/v1' },
        });
        claims.push({
            id: claimId,
            kind: candidate.kind,
            subjectScope: candidate.scope,
            classification: candidate.kind.includes('hypothesis') ? 'hypothesis' : 'fact',
            statement: text,
            supportingEvidenceIds: [evidenceId],
            contradictingEvidenceIds: [],
            confidence: 0.7,
            freshness: {
                asOf: generatedAt,
                validUntil: new Date(Date.parse(generatedAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
                policyVersion: 'research-freshness/v1',
            },
            derivation: { method: candidate.kind.includes('hypothesis') ? 'model' : 'direct' },
        });
    }
    if (claims.length === 0) throw new Error('LEAD_RESEARCH_TERMINAL_RESULT_HAS_NO_LINKED_EVIDENCE');

    const snapshotId = deterministicUuid(`lead-research-snapshot:v1:${input.scopeKey}:${input.userId}:${input.providerReportId}`);
    const fingerprint = createHash('sha256').update(stableJson(input.requestIdempotencyKey)).digest('hex');
    const status = input.providerStatus === 'partial' ? 'partial' : 'completed';
    return {
        id: snapshotId,
        payload: {
            kind: 'research_snapshot',
            schemaVersion: 'research-snapshot/v1',
            id: snapshotId,
            revision: 1,
            scope: { kind: 'organization', organizationId: input.organizationId, ownerUserId: input.userId },
            subject: {
                leadRef: input.leadRef,
                ...(normalize(input.leadId) ? { leadId: normalize(input.leadId) } : {}),
                ...(normalize(input.email) ? { email: normalize(input.email).toLowerCase() } : {}),
                person: {},
                company: {
                    ...(normalize(input.companyName) ? { name: normalize(input.companyName) } : {}),
                    ...(normalize(input.companyDomain) ? { domain: normalize(input.companyDomain).toLowerCase() } : {}),
                },
            },
            request: {
                requestId: `request_${fingerprint.slice(0, 20)}`,
                idempotencyKey: input.requestIdempotencyKey,
                inputFingerprint: `sha256:${fingerprint}`,
                provider: input.provider,
                providerJobId: input.providerReportId,
                language: 'es',
                depth: 'standard',
                requestedAt: generatedAt,
            },
            lifecycle: {
                status,
                completedAt: generatedAt,
                errors: status === 'partial' ? [{
                    code: 'insufficient_evidence',
                    stage: 'validate',
                    severity: 'warning',
                    retryable: false,
                    message: 'The provider returned partial research.',
                    provider: input.provider,
                    observedAt: generatedAt,
                }] : [],
            },
            sources: [...sourceByUrl.values()],
            evidence,
            claims,
            contradictions: [],
            quality: {
                assessmentVersion: 'research-quality/v1',
                coverage: { company: claims.some((claim) => claim.subjectScope === 'company') ? 0.7 : 0, person: claims.some((claim) => claim.subjectScope === 'person') ? 0.7 : 0, recentSignals: 0 },
                overallConfidence: 0.7,
            },
            createdAt: generatedAt,
            updatedAt: generatedAt,
        },
    };
}

export async function persistLeadResearchTerminalResult(
    supabase: SupabaseClient,
    input: LeadResearchRequestOwner & LeadResearchRequestIdentity & {
        job: LeadResearchRequestJob;
        claimToken?: string | null;
        requestIdempotencyKey: string;
        provider: string;
        providerReportId: string;
        providerStatus: 'completed' | 'partial';
        requestPayload: Record<string, any>;
        resultPayload: Record<string, any>;
    },
) {
    const resultPayload = {
        ...objectPayload(input.resultPayload),
        provider_status: input.providerStatus,
        report_id: input.providerReportId,
    };
    const owned = input.claimToken ? { ...input, jobId: input.job.id, claimToken: input.claimToken } : null;
    let requestClaimState = input.job.requestClaimState;
    if (requestClaimState === 'provider_submitting') {
        if (!owned) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_TOKEN_MISSING');
        await rpc(supabase, 'store_lead_research_request_terminal_v1', {
            ...completionArgs({
                ...owned,
                providerReportId: input.providerReportId,
                providerStatus: input.providerStatus,
                requestPayload: input.requestPayload,
            }),
            p_result_payload: resultPayload,
        });
        requestClaimState = 'terminal_pending';
    }

    const snapshot = buildSnapshot({
        ...input,
        providerStatus: input.providerStatus,
        resultPayload,
    });
    const serialized = stableJson(snapshot.payload);
    const capturedAt = normalize(snapshot.payload.createdAt) || new Date().toISOString();
    const { error: snapshotError } = await supabase.from('research_snapshots').upsert({
        id: snapshot.id,
        scope_key: input.scopeKey,
        organization_id: input.organizationId,
        user_id: input.userId,
        lead_ref: input.leadRef,
        source: input.provider,
        schema_version: 1,
        payload: snapshot.payload,
        content_hash: createHash('sha256').update(serialized).digest('hex'),
        captured_at: capturedAt,
        created_at: capturedAt,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (snapshotError) throw snapshotError;
    const { data: ownedSnapshot, error: verifyError } = await supabase.from('research_snapshots')
        .select('id')
        .eq('id', snapshot.id)
        .eq('scope_key', input.scopeKey)
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .maybeSingle();
    if (verifyError) throw verifyError;
    if (!ownedSnapshot) throw new Error('LEAD_RESEARCH_SNAPSHOT_ID_CONFLICT');

    const { error: linkError } = await supabase.from('lead_research_jobs').update({
        research_snapshot_id: snapshot.id,
        updated_at: new Date().toISOString(),
    }).eq('id', input.job.id)
        .eq('scope_key', input.scopeKey)
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .in('request_claim_state', ['provider_submitting', 'terminal_pending', 'submitted'])
        .is('research_snapshot_id', null);
    if (linkError) throw linkError;

    if (requestClaimState === 'submitted') {
        const { error: updateError } = await supabase.from('lead_research_jobs').update({
            provider_report_id: input.providerReportId,
            status: input.providerStatus,
            result_payload: resultPayload,
            error_code: null,
            error_message: null,
            attempt_count: 1,
            completed_at: capturedAt,
            updated_at: new Date().toISOString(),
        }).eq('id', input.job.id)
            .eq('scope_key', input.scopeKey)
            .eq('organization_id', input.organizationId)
            .eq('user_id', input.userId)
            .eq('request_claim_state', 'submitted');
        if (updateError) throw updateError;
    }

    if (requestClaimState === 'terminal_pending') {
        if (!owned) throw new Error('LEAD_RESEARCH_REQUEST_CLAIM_TOKEN_MISSING');
        return mapJob(await rpc(
            supabase,
            'finalize_lead_research_request_terminal_v1',
            completionArgs({
                ...owned,
                providerReportId: input.providerReportId,
                providerStatus: input.providerStatus,
                requestPayload: input.requestPayload,
            }),
        ));
    }

    const { data, error } = await supabase.from('lead_research_jobs')
        .select('*')
        .eq('id', input.job.id)
        .eq('scope_key', input.scopeKey)
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .single();
    if (error) throw error;
    return mapJob(data);
}

export async function failSubmittedLeadResearchRequest(
    supabase: SupabaseClient,
    input: LeadResearchRequestOwner & { jobId: string; providerReportId: string; providerStatus: string; resultPayload: Record<string, any> },
) {
    const errorMessage = normalize(input.resultPayload?.message || input.resultPayload?.error) || `Provider status: ${input.providerStatus}`;
    const status = input.providerStatus === 'insufficient_data' ? 'insufficient_data' : 'failed';
    const now = new Date().toISOString();
    const { error } = await supabase.from('lead_research_jobs').update({
        status,
        result_payload: { ...objectPayload(input.resultPayload), provider_status: input.providerStatus, report_id: input.providerReportId },
        error_code: input.providerStatus,
        error_message: errorMessage,
        attempt_count: 1,
        completed_at: now,
        updated_at: now,
    }).eq('id', input.jobId)
        .eq('scope_key', input.scopeKey)
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .eq('provider_report_id', input.providerReportId)
        .eq('request_claim_state', 'submitted');
    if (error) throw error;
}

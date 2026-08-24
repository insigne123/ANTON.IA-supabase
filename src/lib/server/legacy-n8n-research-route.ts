import { adaptLeadResearchResponseToReport, unwrapLeadResearchResponse } from '@/lib/lead-research';
import { normalizeDomain } from '@/lib/domain';
import {
  applyLeadResearchAccessToPayload,
  type LeadResearchAccessContext,
} from '@/lib/server/lead-research-access';
import type {
  LeadResearchRequestClaim,
  LeadResearchRequestJob,
} from '@/lib/server/lead-research-jobs';
import { N8nResearchRequestError, type requestN8nResearch } from '@/lib/server/n8n-research-client';
import { buildN8nResearchRequestIdempotencyKey } from '@/lib/server/research-request-identity';
import type { LeadResearchReport } from '@/lib/types';

type LeadPayload = {
  id?: string | null;
  fullName?: string | null;
  title?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
};

type N8nResponse = {
  reports?: any[];
  skipped?: string[];
  error?: string;
  [key: string]: any;
};

function valueOrNull(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function buildN8nWorkflowPayload(input: {
  body: Record<string, any>;
  canon: LeadPayload;
  leadRef: string;
  userContext: any;
  useSocialContext: boolean;
}) {
  const existingCompanies = Array.isArray(input.body.companies) && input.body.companies.length
    ? input.body.companies
    : [{
      leadRef: input.leadRef,
      targetCompany: {
        name: input.canon.companyName || null,
        domain: input.canon.companyDomain || null,
        linkedin: null,
        country: null,
        industry: null,
        website: input.canon.companyDomain ? `https://${input.canon.companyDomain}` : null,
      },
      lead: {
        id: valueOrNull(input.canon.id),
        fullName: valueOrNull(input.canon.fullName),
        title: valueOrNull(input.canon.title),
        email: valueOrNull(input.canon.email),
        linkedinUrl: valueOrNull(input.canon.linkedinUrl),
      },
      meta: { leadRef: input.leadRef },
    }];
  const seller = input.body.seller_context || input.body.sellerContext || {};
  const suppliedCompanyProfile = input.body.userCompanyProfile;
  const userCompanyProfile = suppliedCompanyProfile && typeof suppliedCompanyProfile === 'object'
    ? suppliedCompanyProfile
    : {
      name: valueOrNull(seller.company_name) || valueOrNull(input.userContext?.company?.name),
      sector: valueOrNull(seller.sector),
      description: valueOrNull(seller.description),
      services: Array.isArray(seller.services) ? seller.services.join('\n') : valueOrNull(seller.services),
      valueProposition: valueOrNull(seller.value_proposition || seller.valueProposition),
      website: valueOrNull(seller.company_domain)
        ? `https://${String(seller.company_domain).replace(/^https?:\/\//, '')}`
        : valueOrNull(input.userContext?.company?.domain)
          ? `https://${String(input.userContext.company.domain).replace(/^https?:\/\//, '')}`
          : null,
    };

  return {
    ...input.body,
    ...input.canon,
    companies: existingCompanies,
    userCompanyProfile,
    userContext: {
      ...(input.userContext && typeof input.userContext === 'object' ? input.userContext : {}),
      id: input.body.user_id,
    },
    use_social_context: input.useSocialContext,
  };
}

export type LegacyN8nResolvedAccess = {
  access: LeadResearchAccessContext;
  supabase: any;
};

export type LegacyN8nForwardContext = {
  userContext: any;
  useSocialContext: boolean;
  socialCreditSource: 'serpapi' | 'organization' | 'none';
};

export type LegacyN8nResearchDependencies = {
  webhook: string | null;
  apiKey?: string | null;
  timeoutMs: number;
  resolveAccess: (req: Request) => Promise<LegacyN8nResolvedAccess | null>;
  resolveForwardContext: (input: {
    supabase: any;
    userId: string;
    organizationId: string;
    suppliedUserContext: any;
  }) => Promise<LegacyN8nForwardContext>;
  getResearchLimit: (input: { userId: string; organizationId: string }) => Promise<number>;
  consumeQuota: (input: {
    scopeKey: string;
    organizationId: string;
    userId: string;
    jobId: string;
    claimToken: string;
    limit: number;
  }) => Promise<{ allowed: boolean; count: number; limit: number }>;
  claimRequest: (input: LeadResearchAccessContext & {
    leadRef: string;
    leadId?: string | null;
    email?: string | null;
    companyName?: string | null;
    companyDomain?: string | null;
    requestIdempotencyKey: string;
    requestPayload: Record<string, any>;
  }) => Promise<LeadResearchRequestClaim>;
  markProviderSubmitting: (input: LeadResearchAccessContext & {
    jobId: string;
    claimToken: string;
  }) => Promise<void>;
  completeClaim: (input: LeadResearchAccessContext & {
    jobId: string;
    claimToken: string;
    providerReportId: string;
    status: string;
    leadRef: string;
    leadId?: string | null;
    email?: string | null;
    companyName?: string | null;
    companyDomain?: string | null;
    requestPayload: Record<string, any>;
    resultPayload: Record<string, any>;
    phase: 'store_terminal' | 'release';
  }) => Promise<LeadResearchRequestJob>;
  releaseClaim: (input: LeadResearchAccessContext & {
    jobId: string;
    claimToken: string;
    errorCode: string;
    errorMessage: string;
  }) => Promise<boolean>;
  failClaim: (input: LeadResearchAccessContext & {
    jobId: string;
    claimToken: string;
    errorCode: string;
    errorMessage: string;
    resultPayload: Record<string, any>;
  }) => Promise<boolean>;
  markProviderUnknown: (input: LeadResearchAccessContext & {
    jobId: string;
    claimToken: string;
    errorCode: string;
    errorMessage: string;
  }) => Promise<boolean>;
  persistTerminalResult: (input: {
    providerReportId: string;
    access: LeadResearchAccessContext;
    report: LeadResearchReport;
  }) => Promise<void>;
  requestProvider: typeof requestN8nResearch;
  now: () => Date;
};

function json(status: number, data: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function getClientIdempotencyKey(req: Request, body: any) {
  return String(
    req.headers.get('idempotency-key') ||
    body?.idempotency_key ||
    body?.idempotencyKey ||
    body?.job_identity ||
    body?.jobIdentity ||
    ''
  ).trim();
}

function getFreshnessBucket(now: Date) {
  return now.toISOString().slice(0, 10);
}

function replayClaim(job: LeadResearchRequestJob, idempotencyKey: string) {
  const payload = job.resultPayload || {};
  const headers = {
    'Idempotency-Key': idempotencyKey,
    'Idempotency-Replayed': 'true',
  };
  if (job.requestClaimState === 'provider_failed') {
    return json(Number(payload.provider_http_status || 502), payload, headers);
  }
  if (job.requestClaimState === 'provider_unknown') {
    return json(409, payload, headers);
  }
  if (job.requestClaimState === 'pre_provider' || job.requestClaimState === 'provider_submitting') {
    return json(202, {
      ...payload,
      status: job.requestClaimState === 'pre_provider' ? 'queued' : 'in_progress',
    }, { ...headers, 'Retry-After': '2' });
  }
  if (job.status === 'completed' || job.status === 'partial') {
    if (Array.isArray(payload.reports)) {
      return json(200, { ...payload, reused: true }, headers);
    }
    return json(200, { reports: [payload], skipped: [], reused: true }, headers);
  }
  return json(['queued', 'running'].includes(job.status) ? 202 : 200, {
    ...payload,
    status: payload.provider_status || job.status,
    ...(job.providerReportId ? { report_id: job.providerReportId } : {}),
  }, headers);
}

function recoverTerminalResult(job: LeadResearchRequestJob) {
  const payload = job.resultPayload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('LEAD_RESEARCH_TERMINAL_RESULT_MISSING');
  }
  const reports = Array.isArray(payload.reports) ? payload.reports : [];
  const report = (reports[0] || payload) as LeadResearchReport;
  return {
    report,
    response: reports.length > 0
      ? payload as N8nResponse
      : { reports: [report], skipped: [], reused: true } as N8nResponse,
  };
}

export async function executeLegacyN8nResearchRequest(
  req: Request,
  dependencies: LegacyN8nResearchDependencies,
): Promise<Response> {
  const webhook = dependencies.webhook;
  if (!webhook) {
    return json(500, { error: 'Server not configured: N8N_RESEARCH_WEBHOOK_URL' });
  }

  const resolved = await dependencies.resolveAccess(req);
  if (!resolved) return json(401, { error: 'UNAUTHORIZED' });
  const { access, supabase } = resolved;
  const organizationId = access.organizationId;
  if (!organizationId) return json(403, { error: 'ORGANIZATION_REQUIRED' });

  let sourceBody: any;
  try {
    sourceBody = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const clientKey = getClientIdempotencyKey(req, sourceBody);
  if (clientKey.length > 200) {
    return json(400, { error: 'IDEMPOTENCY_KEY_INVALID' });
  }

  const userId = access.userId;
  const body = applyLeadResearchAccessToPayload(sourceBody, access);
  const firstCompany = Array.isArray(body?.companies) && body.companies.length ? body.companies[0] : null;
  const nestedLead = firstCompany?.lead || null;
  const nestedCompany = firstCompany?.targetCompany || firstCompany?.company || null;
  const canon: LeadPayload = {
    id: valueOrNull(body?.id ?? body?.lead?.id ?? body?.payload?.id ?? body?.personId ?? nestedLead?.id),
    fullName: valueOrNull(body?.fullName ?? body?.lead?.fullName ?? body?.lead?.full_name ?? body?.person?.fullName ?? body?.name ?? nestedLead?.fullName),
    title: valueOrNull(body?.title ?? body?.lead?.title ?? body?.person?.title ?? nestedLead?.title),
    email: valueOrNull(body?.email ?? body?.lead?.email ?? body?.person?.email ?? body?.payload?.email ?? nestedLead?.email),
    linkedinUrl: valueOrNull(body?.linkedinUrl ?? body?.lead?.linkedinUrl ?? body?.lead?.linkedin_url ?? body?.person?.linkedinUrl ?? nestedLead?.linkedinUrl),
    companyName: valueOrNull(body?.companyName ?? body?.lead?.companyName ?? body?.company?.name ?? nestedCompany?.name),
    companyDomain: normalizeDomain(body?.companyDomain ?? body?.lead?.companyDomain ?? body?.company?.domain ?? nestedCompany?.domain) || null,
  };
  const leadRef = String(
    body?.lead_ref ||
    body?.leadRef ||
    firstCompany?.leadRef ||
    firstCompany?.meta?.leadRef ||
    canon.id ||
    canon.email ||
    canon.linkedinUrl ||
    ''
  ).trim();
  if (!leadRef) {
    return json(400, { error: 'Payload incompleto: requiere id, email o linkedin' });
  }

  const now = dependencies.now();
  const idempotencyKey = buildN8nResearchRequestIdempotencyKey({
    userId,
    organizationId,
    leadRef,
    email: canon.email,
    companyDomain: canon.companyDomain,
    clientKey,
    freshnessBucket: getFreshnessBucket(now),
  });
  const claim = await dependencies.claimRequest({
    ...access,
    leadRef,
    leadId: canon.id,
    email: canon.email,
    companyName: canon.companyName,
    companyDomain: canon.companyDomain,
    requestIdempotencyKey: idempotencyKey,
    requestPayload: body,
  });
  if (!claim.claimed) return replayClaim(claim.job, idempotencyKey);
  const claimToken = claim.claimToken!;
  const ownedClaim = {
    userId,
    organizationId,
    scopeKey: access.scopeKey,
    trustedInternal: access.trustedInternal,
    jobId: claim.job.id,
    claimToken,
  };

  if (claim.job.requestClaimState === 'terminal_pending') {
    const providerReportId = claim.job.providerReportId;
    if (!providerReportId) throw new Error('LEAD_RESEARCH_REPORT_ID_MISSING');
    const terminal = recoverTerminalResult(claim.job);
    await dependencies.persistTerminalResult({ providerReportId, access, report: terminal.report });
    await dependencies.completeClaim({
      ...ownedClaim,
      phase: 'release',
      leadRef: claim.job.leadRef,
      leadId: claim.job.leadId,
      email: claim.job.email,
      companyName: claim.job.companyName,
      companyDomain: claim.job.companyDomain,
      providerReportId,
      status: claim.job.status,
      requestPayload: claim.job.requestPayload,
      resultPayload: claim.job.resultPayload!,
    });
    return json(200, terminal.response, {
      'Idempotency-Key': idempotencyKey,
      'Idempotency-Replayed': 'true',
    });
  }

  let quota: Awaited<ReturnType<LegacyN8nResearchDependencies['consumeQuota']>>;
  try {
    const limit = await dependencies.getResearchLimit({ userId, organizationId });
    quota = await dependencies.consumeQuota({ ...ownedClaim, limit });
  } catch (error) {
    await dependencies.releaseClaim({
      ...ownedClaim,
      errorCode: 'research_quota_unavailable',
      errorMessage: 'Research quota could not be reserved before provider submission.',
    });
    throw error;
  }
  if (!quota.allowed) {
    const payload = {
      error: 'DAILY_RESEARCH_QUOTA_EXCEEDED',
      count: quota.count,
      limit: quota.limit,
      retryAt: new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      )).toISOString(),
    };
    await dependencies.releaseClaim({
      ...ownedClaim,
      errorCode: 'daily_research_quota_exceeded',
      errorMessage: 'Daily research quota exceeded.',
    });
    return json(429, payload, { 'Idempotency-Key': idempotencyKey });
  }

  const forwardContext = await dependencies.resolveForwardContext({
    supabase,
    userId,
    organizationId,
    suppliedUserContext: body.userContext,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'x-user-id': userId,
    'x-organization-id': organizationId,
  };
  if (dependencies.apiKey) headers.Authorization = `Bearer ${dependencies.apiKey}`;

  try {
    await dependencies.markProviderSubmitting(ownedClaim);
  } catch (error) {
    await dependencies.releaseClaim({
      ...ownedClaim,
      errorCode: 'provider_submission_not_started',
      errorMessage: 'Provider submission did not start.',
    });
    throw error;
  }

  let n8nResult;
  try {
    n8nResult = await dependencies.requestProvider({
      webhook,
      headers,
      payload: {
        ...buildN8nWorkflowPayload({
          body,
          canon,
          leadRef,
          userContext: forwardContext.userContext,
          useSocialContext: forwardContext.useSocialContext,
        }),
        idempotency_key: idempotencyKey,
      },
      useSocialContext: forwardContext.useSocialContext,
      timeoutMs: dependencies.timeoutMs,
    });
  } catch (error: any) {
    await dependencies.markProviderUnknown({
      ...ownedClaim,
      errorCode: 'provider_outcome_unknown',
      errorMessage: error?.message || 'The provider outcome is unknown and cannot be retried safely.',
    });
    const timeout = error instanceof N8nResearchRequestError && error.kind === 'timeout';
    return json(timeout ? 504 : 502, {
      error: 'n8n unreachable',
      reason: error?.message || 'fetch_failed',
    }, { 'Idempotency-Key': idempotencyKey });
  }

  const text = await n8nResult.response.text();
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }

  if (!n8nResult.response.ok) {
    const payload = typeof result === 'string'
      ? { error: result }
      : result && typeof result === 'object' && !Array.isArray(result)
        ? result
        : { error: 'N8N_REQUEST_FAILED', details: result };
    if (!await dependencies.failClaim({
      ...ownedClaim,
      errorCode: `provider_http_${n8nResult.response.status}`,
      errorMessage: String(payload.message || payload.error || `Provider returned HTTP ${n8nResult.response.status}`),
      resultPayload: { ...payload, provider_http_status: n8nResult.response.status },
    })) {
      throw new Error('RESEARCH_REQUEST_CLAIM_LOST');
    }
    return json(n8nResult.response.status, payload, { 'Idempotency-Key': idempotencyKey });
  }

  if (n8nResult.usedSocialContext && forwardContext.socialCreditSource === 'organization') {
    try {
      const { error } = await supabase.rpc('decrement_social_credit', { org_id: organizationId });
      if (error) console.error('[research:n8n] Failed to decrement credits:', error);
    } catch (error) {
      console.error('[research:n8n] Unexpected error decrementing credits:', error);
    }
  }

  const normalizedResult = unwrapLeadResearchResponse(result);
  const out: N8nResponse = typeof result === 'string'
    ? { reports: [], skipped: [], text: result }
    : Array.isArray(result)
      ? { reports: [], skipped: [], raw: result }
      : {
        reports: Array.isArray(result?.reports) ? result.reports : [],
        skipped: Array.isArray(result?.skipped) ? result.skipped : [],
        ...(result || {}),
      };

  try {
    if ((!out.reports || out.reports.length === 0) && normalizedResult && typeof normalizedResult === 'object') {
      out.reports = [adaptLeadResearchResponseToReport(normalizedResult, leadRef)];
    }
  } catch (error) {
    console.warn('[research:n8n] fallback parse failed:', (error as any)?.message);
  }
  if (n8nResult.fellBackToNonSocial) {
    out.warnings = [...(Array.isArray(out.warnings) ? out.warnings : []), 'SOCIAL_RESEARCH_FALLBACK'];
  }
  const terminalReport = out.reports?.[0] && typeof out.reports[0] === 'object'
    ? out.reports[0] as LeadResearchReport
    : adaptLeadResearchResponseToReport(
      normalizedResult && typeof normalizedResult === 'object' ? normalizedResult : { result: normalizedResult },
      leadRef,
    );
  const terminalResult: N8nResponse = {
    ...out,
    reports: out.reports?.length ? out.reports : [terminalReport],
    skipped: Array.isArray(out.skipped) ? out.skipped : [],
  };
  await dependencies.completeClaim({
    ...ownedClaim,
    phase: 'store_terminal',
    leadRef,
    leadId: canon.id,
    email: canon.email,
    companyName: canon.companyName,
    companyDomain: canon.companyDomain,
    providerReportId: idempotencyKey,
    status: 'completed',
    requestPayload: body,
    resultPayload: terminalResult,
  });
  await dependencies.persistTerminalResult({
    providerReportId: idempotencyKey,
    access,
    report: terminalReport,
  });
  await dependencies.completeClaim({
    ...ownedClaim,
    phase: 'release',
    leadRef,
    leadId: canon.id,
    email: canon.email,
    companyName: canon.companyName,
    companyDomain: canon.companyDomain,
    providerReportId: idempotencyKey,
    status: 'completed',
    requestPayload: body,
    resultPayload: terminalResult,
  });

  return json(200, terminalResult, { 'Idempotency-Key': idempotencyKey });
}

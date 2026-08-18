import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

import { unwrapLeadResearchResponse } from '@/lib/lead-research';
import {
  applyLeadResearchAccessToPayload,
  deriveLeadResearchAccess,
  getLeadResearchIdentity,
  type LeadResearchAccessContext,
} from '@/lib/server/lead-research-access';
import { getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import {
  claimLeadResearchRequest,
  completeLeadResearchRequestClaim,
  consumeLeadResearchRequestQuota,
  failLeadResearchRequestClaim,
  markLeadResearchRequestProviderOutcomeUnknown,
  markLeadResearchRequestProviderSubmitting,
  releaseLeadResearchRequestClaim,
  updateLeadResearchJobStatus,
  type LeadResearchRequestJob,
} from '@/lib/server/lead-research-jobs';
import {
  buildTerminalLeadResearchReport,
  getLeadResearchProviderStatus,
  storeLeadResearchReport,
} from '@/lib/server/lead-research-reports';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DEFAULT_LEAD_RESEARCH_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-research';

function getLeadResearchBaseUrl() {
  return String(
    process.env.ANTONIA_LEAD_RESEARCH_URL ||
    process.env.LEAD_RESEARCH_URL ||
    DEFAULT_LEAD_RESEARCH_URL,
  ).trim();
}

function buildLeadResearchUrl(reportId?: string) {
  const base = getLeadResearchBaseUrl();
  if (!base) return '';

  try {
    const url = new URL(base);
    if (reportId) {
      const cleanPath = url.pathname.replace(/\/$/, '');
      url.pathname = `${cleanPath}/${encodeURIComponent(reportId)}`;
      url.search = '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

async function resolveAccess(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  const trustedInternal = isTrustedInternalRequest(req);
  const access = await deriveLeadResearchAccess({
    sessionUserId: user?.id,
    trustedInternal,
    internalUserId: req.headers.get('x-user-id'),
    internalOrganizationId: req.headers.get('x-organization-id'),
  });
  if (!access) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED', message: 'User must be logged in' }, { status: 401 }) };
  }

  return { access };
}

function parseJson(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || 'INVALID_JSON_RESPONSE' };
  }
}

function buildLeadRef(body: any) {
  return getLeadResearchIdentity(body).leadRef;
}

function getLeadIdentity(body: any) {
  return getLeadResearchIdentity(body);
}

function getLeadResearchRequestIdentity(req: NextRequest, body: any) {
  return String(
    req.headers.get('idempotency-key') ||
    body?.idempotency_key ||
    body?.idempotencyKey ||
    body?.job_identity ||
    body?.jobIdentity ||
    ''
  ).trim();
}

function reusableLeadResearchJobResponse(job: LeadResearchRequestJob) {
  const resultPayload = job.resultPayload || {};
  const recordedStatus = String(
    resultPayload.provider_status || job.requestPayload.provider_status || job.status || 'queued',
  ).trim().toLowerCase();
  const recordedStatusIsActive = ['queued', 'running', 'in_progress', 'pending', 'processing'].includes(recordedStatus);
  const status = job.requestClaimState === 'submitted'
    && ['queued', 'running'].includes(job.status)
    && !recordedStatusIsActive
    ? 'in_progress'
    : recordedStatus;
  const payload = {
    ...resultPayload,
    ...(job.providerReportId ? { report_id: job.providerReportId } : {}),
    status: job.requestClaimState === 'provider_unknown' ? 'unknown' : status,
    ...(job.researchSnapshotId ? { research_snapshot_id: job.researchSnapshotId } : {}),
    reused: true,
  };

  if (job.requestClaimState === 'provider_unknown') return { payload, status: 409 };
  if (job.requestClaimState === 'provider_failed') return { payload, status: 502 };
  if (['pre_provider', 'provider_submitting'].includes(job.requestClaimState)) {
    return { payload: { ...payload, status: job.requestClaimState === 'pre_provider' ? 'queued' : 'in_progress' }, status: 202 };
  }
  return {
    payload,
    status: ['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status) ? 202 : 200,
  };
}

function nextDayStartISOUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

async function releasePreProviderClaim(input: Parameters<typeof releaseLeadResearchRequestClaim>[0]) {
  try {
    return await releaseLeadResearchRequestClaim(input);
  } catch (error) {
    console.error('[lead-research] failed to release pre-provider claim:', error);
    return false;
  }
}

async function persistTerminalResearchReport(access: LeadResearchAccessContext, body: any, payload: any) {
  const terminal = buildTerminalLeadResearchReport(payload, buildLeadRef(body));
  if (!terminal) return null;

  try {
    return await storeLeadResearchReport({
      userId: access.userId,
      organizationId: access.organizationId,
      lead: {
        id: body?.lead?.id || body?.id || null,
        leadId: body?.lead?.id || body?.id || null,
        name: body?.lead?.full_name || body?.lead?.fullName || body?.fullName || null,
        email: body?.lead?.email || body?.email || null,
        company: body?.company?.name || body?.companyName || null,
        companyDomain: body?.company?.domain || body?.companyDomain || null,
      } as any,
      report: terminal.report,
    });
  } catch (cacheError) {
    console.warn('[lead-research] cache store failed:', cacheError);
    return false;
  }
}

function withResearchSnapshotId(payload: any, researchSnapshotId: string | null) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const next = { ...payload };
  delete next.research_snapshot_id;
  if (next.report && typeof next.report === 'object' && !Array.isArray(next.report)) {
    next.report = { ...next.report };
    delete next.report.research_snapshot_id;
    if (researchSnapshotId) next.report.research_snapshot_id = researchSnapshotId;
  }
  if (researchSnapshotId) next.research_snapshot_id = researchSnapshotId;
  return next;
}

export async function GET() {
  const endpoint = buildLeadResearchUrl();
  return NextResponse.json(
    {
      ok: true,
      endpoint: endpoint || null,
      provider: 'lead-research',
      hasUrl: Boolean(endpoint),
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveAccess(req);
    if ('error' in ctx) return ctx.error;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }

    const sourceBody = body && typeof body === 'object' ? body : {};
    const outgoing = applyLeadResearchAccessToPayload(sourceBody, ctx.access);
    if (!buildLeadRef(outgoing)) {
      return NextResponse.json({ error: 'LEAD_RESEARCH_LEAD_REF_REQUIRED' }, { status: 400 });
    }

    const clientRequestIdentity = getLeadResearchRequestIdentity(req, outgoing);
    if (clientRequestIdentity.length > 200) {
      return NextResponse.json({ error: 'LEAD_RESEARCH_REQUEST_IDENTITY_INVALID' }, { status: 400 });
    }
    const requestIdentity = clientRequestIdentity || `generated:${crypto.randomUUID()}`;
    const leadIdentity = getLeadIdentity(outgoing);
    const claim = await claimLeadResearchRequest({
      ...ctx.access,
      ...leadIdentity,
      requestIdempotencyKey: requestIdentity,
      requestPayload: outgoing,
    });
    if (!claim.claimed) {
      const reusable = reusableLeadResearchJobResponse(claim.job);
      return NextResponse.json(reusable.payload, {
        status: reusable.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const claimToken = claim.claimToken!;
    const ownedClaim = {
      ...ctx.access,
      jobId: claim.job.id,
      claimToken,
    };

    const endpoint = buildLeadResearchUrl();
    if (!endpoint) {
      await releasePreProviderClaim({
        ...ownedClaim,
        errorCode: 'lead_research_url_missing',
        errorMessage: 'Lead research provider URL is missing.',
      });
      return NextResponse.json({ error: 'LEAD_RESEARCH_URL_MISSING' }, { status: 500 });
    }

    let quota: Awaited<ReturnType<typeof consumeLeadResearchRequestQuota>>;
    try {
      const limits = await getEffectiveDailyQuotaLimits({
        userId: ctx.access.userId,
        organizationId: ctx.access.organizationId || undefined,
      });
      quota = await consumeLeadResearchRequestQuota({
        ...ownedClaim,
        limit: limits.research,
      });
    } catch (error) {
      await releasePreProviderClaim({
        ...ownedClaim,
        errorCode: 'research_quota_unavailable',
        errorMessage: 'Research quota could not be reserved before provider submission.',
      });
      throw error;
    }
    if (!quota.allowed) {
      await releasePreProviderClaim({
        ...ownedClaim,
        errorCode: 'daily_research_quota_exceeded',
        errorMessage: 'Daily research quota exceeded.',
      });
      return NextResponse.json({
        error: 'DAILY_RESEARCH_QUOTA_EXCEEDED',
        count: quota.count,
        limit: quota.limit,
        retryAt: nextDayStartISOUTC(),
      }, {
        status: 429,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    try {
      await markLeadResearchRequestProviderSubmitting(ownedClaim);
    } catch (error) {
      await releasePreProviderClaim({
        ...ownedClaim,
        errorCode: 'provider_submission_not_started',
        errorMessage: 'Provider submission did not start.',
      });
      throw error;
    }

    let res: Response;
    let payload: any;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': requestIdentity,
        },
        cache: 'no-store',
        body: JSON.stringify(outgoing),
      });
      payload = parseJson(await res.text());
    } catch (error: any) {
      try {
        await markLeadResearchRequestProviderOutcomeUnknown({
          ...ownedClaim,
          errorCode: 'provider_outcome_unknown',
          errorMessage: error?.message || 'The provider outcome is unknown and cannot be retried safely.',
        });
      } catch (persistError) {
        console.error('[lead-research] failed to persist unknown provider outcome:', persistError);
      }
      return NextResponse.json({
        error: 'LEAD_RESEARCH_PROVIDER_OUTCOME_UNKNOWN',
        message: 'The provider outcome is unknown. This request will not be submitted again automatically.',
      }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    if (!res.ok) {
      const errorMessage = String(payload?.message || payload?.error || `Provider returned HTTP ${res.status}`);
      await failLeadResearchRequestClaim({
        ...ownedClaim,
        errorCode: `provider_http_${res.status}`,
        errorMessage,
        resultPayload: {
          ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
          provider_http_status: res.status,
        },
      });
      return NextResponse.json(payload, {
        status: res.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    const normalized = unwrapLeadResearchResponse(payload);
    const providerReportId = String(normalized?.report_id || '').trim();
    const status = getLeadResearchProviderStatus(normalized);
    if (!providerReportId) {
      await markLeadResearchRequestProviderOutcomeUnknown({
        ...ownedClaim,
        errorCode: 'invalid_provider_response',
        errorMessage: 'Provider accepted the request without returning a report ID.',
      });
      return NextResponse.json({
        error: 'LEAD_RESEARCH_REPORT_ID_MISSING',
        message: 'Provider accepted the request without returning a report ID.',
      }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }

    await completeLeadResearchRequestClaim({
      ...ownedClaim,
      ...leadIdentity,
      providerReportId,
      status,
      requestPayload: outgoing,
    });

    const persisted = await persistTerminalResearchReport(ctx.access, outgoing, payload);
    if (persisted === false) {
      throw new Error('LEAD_RESEARCH_REPORT_PERSIST_FAILED');
    }
    let researchSnapshotId: string | null = null;
    if (!['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status)) {
      const terminal = buildTerminalLeadResearchReport(payload, buildLeadRef(outgoing));
      researchSnapshotId = await updateLeadResearchJobStatus(providerReportId, ctx.access, status, terminal?.report);
    }

    return NextResponse.json(withResearchSnapshotId(payload, researchSnapshotId), {
      status: res.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('[lead-research] proxy error:', error);
    return NextResponse.json({ error: 'LEAD_RESEARCH_PROXY_ERROR', message: error?.message || 'Unknown proxy error' }, { status: 500 });
  }
}

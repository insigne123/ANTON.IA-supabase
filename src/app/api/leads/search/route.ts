// src/app/api/leads/search/route.ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from "next/server";
import { normalizeDomainList } from "@/lib/domain";
import {
  CompanyNameSearchRequestSchema,
  N8NRequestBodySchema,
  LinkedInProfileSearchRequestSchema,
  LeadsResponseSchema
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { resolveLeadProvider } from '@/lib/server/provider-routing';
import {
  requestAuthErrorResponse,
  requireSessionOrTrustedInternalRequest,
} from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const DEFAULT_LEAD_SEARCH_URL = "https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-search";
const LEAD_SEARCH_URL = process.env.ANTONIA_LEAD_SEARCH_URL || process.env.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL;
const TIMEOUT_MS = Number(process.env.LEADS_N8N_TIMEOUT_MS ?? 60000);
const MAX_RETRIES = Number(process.env.LEADS_N8N_MAX_RETRIES ?? 0);
function splitFullName(fullName?: string | null) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function mapFlexibleLead(raw: any, index: number) {
  const fullName = String(raw?.full_name || raw?.name || '').trim();
  const split = splitFullName(fullName);
  const organization = raw?.organization && typeof raw.organization === 'object'
    ? raw.organization
    : undefined;

  const email = raw?.email || raw?.work_email || raw?.primary_email || undefined;

  return {
    id:
      String(raw?.id || raw?.person_id || raw?.apollo_id || '').trim() ||
      String(raw?.linkedin_url || raw?.linkedinUrl || raw?.linkedin_profile_url || '').trim() ||
      String(email || '').trim() ||
      `lead-${index + 1}`,
    name: fullName || undefined,
    first_name: String(raw?.first_name || split.firstName || '').trim() || undefined,
    last_name: String(raw?.last_name || split.lastName || '').trim() || undefined,
    email: String(email || '').trim() || undefined,
    org_name: String(raw?.org_name || raw?.organization_name || raw?.job_company_name || '').trim() || undefined,
    organization_name: String(raw?.organization_name || raw?.org_name || raw?.job_company_name || '').trim() || undefined,
    organization_id: String(organization?.id || raw?.organization_id || '').trim() || undefined,
    organization_website: String(raw?.organization_website || organization?.website_url || raw?.organization_website_url || raw?.job_company_website || raw?.website_url || '').trim() || undefined,
    industry: String(raw?.industry || organization?.industry || raw?.organization_industry || raw?.job_company_industry || '').trim() || undefined,
    title: String(raw?.title || raw?.job_title || raw?.headline || '').trim() || undefined,
    organization: {
      id: String(organization?.id || raw?.organization_id || '').trim() || undefined,
      name: String(organization?.name || raw?.organization_name || raw?.job_company_name || '').trim() || undefined,
      domain: cleanDomain(
        organization?.primary_domain ||
        organization?.domain ||
        raw?.organization_domain ||
        raw?.job_company_website ||
        raw?.website_url,
      ),
      industry: String(organization?.industry || raw?.organization_industry || raw?.job_company_industry || '').trim() || undefined,
      website_url: String(organization?.website_url || raw?.organization_website_url || raw?.job_company_website || raw?.website_url || '').trim() || undefined,
      linkedin_url: String(organization?.linkedin_url || raw?.organization_linkedin_url || '').trim() || undefined,
    },
    linkedin_url:
      String(raw?.linkedin_url || raw?.linkedinUrl || raw?.linkedin_profile_url || '').trim() || undefined,
    photo_url:
      String(raw?.photo_url || raw?.photoUrl || raw?.profile_photo_url || raw?.image_url || '').trim() || undefined,
    email_status: String(raw?.email_status || (email ? 'verified' : 'unknown')).trim() || undefined,
    source_provider: String(raw?.source_provider || raw?.sourceProvider || '').trim() || undefined,
    source_provider_id: String(raw?.source_provider_id || raw?.sourceProviderId || '').trim() || undefined,
    apollo_id: String(raw?.apollo_id || raw?.apolloId || '').trim() || undefined,
    city: String(raw?.city || '').trim() || undefined,
    state: String(raw?.state || '').trim() || undefined,
    country: String(raw?.country || '').trim() || undefined,
    headline: String(raw?.headline || '').trim() || undefined,
    seniority: String(raw?.seniority || '').trim() || undefined,
    departments: Array.isArray(raw?.departments) ? raw.departments : undefined,
    primary_phone:
      String(raw?.primary_phone || raw?.primaryPhone || raw?.mobile_phone || raw?.work_phone || '').trim() || undefined,
    phone_numbers: Array.isArray(raw?.phone_numbers)
      ? raw.phone_numbers
      : Array.isArray(raw?.phoneNumbers)
        ? raw.phoneNumbers
        : undefined,
    enrichment_status: String(raw?.enrichment_status || raw?.enrichmentStatus || '').trim() || undefined,
    organization_domain: cleanDomain(
      raw?.organization_domain ||
      organization?.primary_domain ||
      organization?.domain ||
      raw?.job_company_website ||
      raw?.website_url,
    ),
    organization_industry: String(raw?.organization_industry || organization?.industry || raw?.job_company_industry || '').trim() || undefined,
    organization_size: typeof raw?.organization_size === 'number'
      ? raw.organization_size
      : typeof raw?.organization?.estimated_num_employees === 'number'
        ? raw.organization.estimated_num_employees
        : undefined,
    page: typeof raw?.page === 'number' ? raw.page : undefined,
    batch_run_id: String(raw?.batch_run_id || '').trim() || undefined,
    updated_at: String(raw?.updated_at || '').trim() || undefined,
  };
}

function normalizeLeadSearchResponse(json: unknown) {
  try {
    return normalizeFromN8N(json);
  } catch {
    const payload = Array.isArray(json) ? (json[0] ?? {}) : (json ?? {});
    const rawLeads = Array.isArray((payload as any)?.leads)
      ? (payload as any).leads
      : Array.isArray((payload as any)?.people)
        ? (payload as any).people
        : [];

    return LeadsResponseSchema.parse({
      count: Number((payload as any)?.leads_count ?? (payload as any)?.count ?? rawLeads.length ?? 0),
      leads: rawLeads.map((lead: any, index: number) => mapFlexibleLead(lead, index)),
    });
  }
}

function buildLeadSearchGetUrl(recordId: string) {
  const base = String(LEAD_SEARCH_URL || '').trim();
  if (!base) return '';
  try {
    const url = new URL(base);
    url.searchParams.set('record_id', recordId);
    return url.toString();
  } catch {
    return '';
  }
}

function pickLeadSearchMeta(json: unknown) {
  const payload = Array.isArray(json) ? (json[0] ?? {}) : (json ?? {});
  if (!payload || typeof payload !== 'object') return {};

  const source = payload as Record<string, any>;
  return {
    batch_run_id: source.batch_run_id,
    search_mode: source.search_mode,
    company_name: source.company_name,
    leads_count: source.leads_count,
    warnings: Array.isArray(source.warnings) ? source.warnings : undefined,
    requested_reveal: source.requested_reveal,
    applied_reveal: source.applied_reveal,
    effective_reveal: source.effective_reveal,
    phone_enrichment: source.phone_enrichment,
    provider_warnings: Array.isArray(source.provider_warnings) ? source.provider_warnings : undefined,
    warning: source.warning,
    requires_organization_selection: source.requires_organization_selection,
    organization_candidates: Array.isArray(source.organization_candidates) ? source.organization_candidates : undefined,
    selected_organization: source.selected_organization,
    includes_similar_titles: source.includes_similar_titles,
    search_strategy: source.search_strategy,
    matched_organizations: source.matched_organizations,
    enrichment_requested: source.enrichment_requested,
    organization_search_credits: Number.isFinite(Number(source.organization_search_credits))
      ? Number(source.organization_search_credits)
      : undefined,
    debug_logs: Array.isArray(source.debug_logs) ? source.debug_logs : undefined,
  };
}

async function reserveLeadSearchQuota(userId: string, organizationId?: string | null) {
  const resolvedOrganizationId = organizationId || null;
  if (!resolvedOrganizationId) {
    return {
      error: NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 403 }),
    };
  }

  const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId: resolvedOrganizationId });
  const quota = await checkAndConsumeDailyQuota({
    userId,
    organizationId: resolvedOrganizationId,
    resource: 'search',
    limit: limits.leadSearch,
  });

  if (!quota.allowed) {
    return {
      error: NextResponse.json({
        error: 'DAILY_SEARCH_QUOTA_EXCEEDED',
        count: quota.count,
        limit: quota.limit,
        retryAt: quota.resetAtISO,
      }, {
        status: 429,
        headers: { 'Cache-Control': 'private, no-store, max-age=0' },
      }),
    };
  }

  return { organizationId: resolvedOrganizationId, quota };
}

type SearchAuditContext = {
  requestId: string;
  userId: string;
  organizationId?: string | null;
  actorType: 'user' | 'agent';
  searchMode: string;
  providerRequested?: string | null;
  providerUsed?: string | null;
  quotaCount?: number;
  quotaLimit?: number;
  fallbackApplied?: boolean;
};

async function auditSearchResponse(response: NextResponse, context: SearchAuditContext) {
  const succeeded = response.status >= 200 && response.status < 400;
  await safeAppendAntoniaEvent({
    eventKey: `search:${context.requestId}:${succeeded ? 'completed' : 'failed'}`,
    eventType: succeeded ? 'search.completed' : 'search.failed',
    organizationId: context.organizationId,
    actorId: context.userId,
    actorType: context.actorType,
    entityType: 'search',
    entityId: context.requestId,
    sourceRoute: '/api/leads/search',
    requestId: context.requestId,
    correlationId: context.requestId,
    operationId: context.requestId,
    status: succeeded ? 'completed' : 'failed',
    outcome: response.status === 429 ? 'quota_denied' : succeeded ? 'results_returned' : 'http_error',
    severity: succeeded ? 'info' : response.status === 429 ? 'warning' : 'error',
    metrics: {
      httpStatus: response.status,
      ...(context.quotaCount == null ? {} : { quotaCount: context.quotaCount }),
      ...(context.quotaLimit == null ? {} : { quotaLimit: context.quotaLimit }),
    },
    payload: {
      searchMode: context.searchMode,
      providerRequested: context.providerRequested || null,
      providerUsed: context.providerUsed || null,
      fallbackApplied: Boolean(context.fallbackApplied),
    },
  });
  return response;
}

function looksLikeSingleLeadPayload(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Boolean(
    String(payload?.id || '').trim() ||
    String(payload?.linkedin_url || '').trim() ||
    String(payload?.email || '').trim()
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callLeadSearchService(payload: any, meta?: Record<string, unknown>) {
  // This route is the browser-facing BFF. The backend secret is read only at
  // runtime here and is never returned to, or accepted from, the browser.
  const backendSecret = String(process.env.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!backendSecret) {
    return NextResponse.json({ error: 'BACKEND_AUTH_NOT_CONFIGURED', ...(meta || {}) }, { status: 503 });
  }

  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const res = await fetchWithTimeout(
        LEAD_SEARCH_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-secret-key": backendSecret,
          },
          body: JSON.stringify(payload),
        },
        TIMEOUT_MS
      );

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SERVICE_HTTP_${res.status}:${text}`);
      }

      const raw = await res.text();
      if (!raw || !raw.trim()) {
        throw new Error("SERVICE_EMPTY_BODY");
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`SERVICE_BAD_JSON:${raw.slice(0, 300)}`);
      }

      const normalized = normalizeLeadSearchResponse(json);
      const responseMeta = pickLeadSearchMeta(json);

      return NextResponse.json({ ...normalized, ...responseMeta, ...(meta || {}) }, { status: 200 });
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_RETRIES) break;
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** attempt, 6000)));
      attempt++;
    }
  }

  return NextResponse.json(
    {
      error: "SERVICE_ERROR",
      message: lastErr instanceof Error ? lastErr.message : "Unknown",
      ...(meta || {}),
    },
    { status: 502 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const recordId = String(req.nextUrl.searchParams.get('record_id') || '').trim();
    if (!recordId) {
      return NextResponse.json({ error: 'MISSING_RECORD_ID' }, { status: 400 });
    }

    let ctx: Awaited<ReturnType<typeof requireSessionOrTrustedInternalRequest>>;
    try {
      ctx = await requireSessionOrTrustedInternalRequest(req);
    } catch (error) {
      const response = requestAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }
    const url = buildLeadSearchGetUrl(recordId);
    if (!url) {
      return NextResponse.json({ error: 'PROFILE_RECORD_FETCH_ERROR', message: 'Lead search backend URL missing' }, { status: 500 });
    }

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    }, TIMEOUT_MS);

    const raw = await response.text();
    let json: any = null;
    if (raw?.trim()) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      return NextResponse.json({ error: 'PROFILE_RECORD_FETCH_ERROR', message: String(json?.message || json?.error || raw || `HTTP_${response.status}`) }, { status: response.status === 200 ? 500 : response.status });
    }

    const payload = json || { lead: null };
    if (payload?.lead || payload?.error) {
      return NextResponse.json(payload, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    if (looksLikeSingleLeadPayload(payload)) {
      return NextResponse.json(
        { lead: mapFlexibleLead(payload, 0) },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json({ lead: null }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({ error: 'PROFILE_RECORD_FETCH_ERROR', message: error?.message || 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let ctx: Awaited<ReturnType<typeof requireSessionOrTrustedInternalRequest>>;
    try {
      ctx = await requireSessionOrTrustedInternalRequest(req);
    } catch (error) {
      const response = requestAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }
    const userId = ctx.user.id;
    const organizationId = ctx.organizationId;

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
    }

    const requestId = req.headers.get('x-request-id')?.trim() || randomUUID();
    const actorType = ctx.source === 'internal' ? 'agent' as const : 'user' as const;
    let requestRecorded = false;
    const recordSearchRequest = async (params: {
      searchMode: string;
      organizationId?: string | null;
      providerRequested?: string | null;
      providerUsed?: string | null;
    }) => {
      if (requestRecorded) return;
      requestRecorded = true;
      await safeAppendAntoniaEvent({
        eventKey: `search:${requestId}:requested`,
        eventType: 'search.requested',
        organizationId: params.organizationId,
        actorId: userId,
        actorType,
        entityType: 'search',
        entityId: requestId,
        sourceRoute: '/api/leads/search',
        requestId,
        correlationId: requestId,
        operationId: requestId,
        idempotencyKey: requestId,
        status: 'started',
        outcome: 'accepted',
        metrics: { bodyIsArray: Array.isArray(body) },
        payload: {
          searchMode: params.searchMode,
          providerRequested: params.providerRequested || null,
          providerUsed: params.providerUsed || null,
        },
      });
    };

    if (!Array.isArray(body)) {
      const profileParsed = LinkedInProfileSearchRequestSchema.safeParse(body);
      if (profileParsed.success) {
        const providerDecision = resolveLeadProvider({ organizationId });
        await recordSearchRequest({
          searchMode: 'linkedin_profile',
          organizationId,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        });
        const response = NextResponse.json({
          error: 'LINKEDIN_PROFILE_REQUIRES_ENRICHMENT',
          message: 'La busqueda exacta por LinkedIn usa el flujo idempotente de enriquecimiento.',
          search_mode: 'linkedin_profile',
          providerUsed: providerDecision.provider,
        }, { status: 409 });
        response.headers.set('x-search-mode', 'linkedin_profile');
        response.headers.set('x-provider-used', providerDecision.provider);
        return await auditSearchResponse(response, {
          requestId,
          userId,
          organizationId,
          actorType,
          searchMode: 'linkedin_profile',
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        });
      }

      const companyParsed = CompanyNameSearchRequestSchema.safeParse(body);
      if (companyParsed.success) {
        const companyReq = companyParsed.data;
        const providerDecision = resolveLeadProvider({ organizationId });
        await recordSearchRequest({
          searchMode: 'company_name',
          organizationId,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        });
        const quotaReservation = await reserveLeadSearchQuota(userId, organizationId);
        if ('error' in quotaReservation && quotaReservation.error) {
          return await auditSearchResponse(quotaReservation.error, {
            requestId,
            userId,
            organizationId,
            actorType,
            searchMode: 'company_name',
            providerRequested: providerDecision.requestedProvider,
            providerUsed: providerDecision.provider,
          });
        }
        const organizationDomains = normalizeDomainList([
          ...(companyReq.organization_domains || []),
          ...(companyReq.organizationDomains || []),
          ...(companyReq.organization_domain_list || []),
          ...(companyReq.organizationDomainList || []),
          companyReq.organization_domain,
          companyReq.organizationDomain,
          companyReq.company_domain,
          companyReq.companyDomain,
        ]);
        const companyPayload = {
          provider: providerDecision.provider,
          user_id: userId,
          search_mode: 'company_name',
          company_name: String(companyReq.company_name || '').trim() || undefined,
          seniorities: companyReq.seniorities || [],
          titles: Array.isArray(companyReq.titles) ? companyReq.titles : [],
          max_results: companyReq.max_results,
          organization_domains: organizationDomains.length ? organizationDomains : undefined,
          selected_organization_id: String(companyReq.selected_organization_id || '').trim() || undefined,
          selected_organization_name: String(companyReq.selected_organization_name || '').trim() || undefined,
        };
        const response = await callLeadSearchService(companyPayload, {
          search_mode: 'company_name',
          company_name: companyPayload.company_name || companyPayload.selected_organization_name,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
          providerDefault: providerDecision.defaultProvider,
          providerForcedReason: providerDecision.forcedProviderReason,
          fallbackApplied: false,
        });
        response.headers.set('x-search-mode', 'company_name');
        response.headers.set('x-provider-used', providerDecision.provider);
        response.headers.set('x-quota-count', String(quotaReservation.quota.count));
        response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
        return await auditSearchResponse(response, {
          requestId,
          userId,
          organizationId,
          actorType,
          searchMode: 'company_name',
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
          quotaCount: quotaReservation.quota.count,
          quotaLimit: quotaReservation.quota.limit,
        });
      }

      return NextResponse.json(
        {
          error: "INVALID_REQUEST_BODY",
          details: {
            profile: profileParsed.error.flatten(),
            company_name: companyParsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const parsed = N8NRequestBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_REQUEST_BODY", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const currentParams = parsed.data[0];
    const providerDecision = resolveLeadProvider({
      organizationId,
    });

    await recordSearchRequest({
      searchMode: 'batch',
      organizationId,
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
    });

    const fallbackApplied = false;

    const quotaReservation = await reserveLeadSearchQuota(userId, organizationId);
    if ('error' in quotaReservation && quotaReservation.error) {
      return await auditSearchResponse(quotaReservation.error, {
        requestId,
        userId,
        organizationId,
        actorType,
        searchMode: 'batch',
        providerRequested: providerDecision.requestedProvider,
        providerUsed: providerDecision.provider,
        fallbackApplied,
      });
    }

    const newPayload = {
      provider: providerDecision.provider,
      user_id: userId || undefined,
      search_mode: 'batch',
      industry_keywords: currentParams.industry_keywords,
      company_keywords: currentParams.company_keywords,
      company_location: currentParams.company_location,
      person_locations: currentParams.person_locations,
      titles: Array.isArray(currentParams.titles)
        ? currentParams.titles
        : (typeof currentParams.titles === 'string' && currentParams.titles.length > 0 ? [currentParams.titles] : []),
      seniorities: Array.isArray(currentParams.seniorities) ? currentParams.seniorities : [],
      include_similar_titles: currentParams.include_similar_titles,
      employee_range: currentParams.employee_ranges,
      employee_ranges: currentParams.employee_ranges,
      max_results: currentParams.max_results,
    };

    if (!newPayload.titles) newPayload.titles = [];

    const response = await callLeadSearchService(newPayload, {
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedProviderReason,
      fallbackApplied,
    });
    response.headers.set('x-provider-used', providerDecision.provider);
    response.headers.set('x-quota-count', String(quotaReservation.quota.count));
    response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
    return await auditSearchResponse(response, {
      requestId,
      userId,
      organizationId,
      actorType,
      searchMode: 'batch',
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
      quotaCount: quotaReservation.quota.count,
      quotaLimit: quotaReservation.quota.limit,
      fallbackApplied,
    });
  } catch (error: any) {
    console.error('[leads/search] Unhandled route error:', error);
    return NextResponse.json(
      {
        error: 'LEADS_SEARCH_ROUTE_ERROR',
        message: error?.message || 'Unknown route error',
      },
      { status: 500 },
    );
  }
}

function cleanDomain(urlLike?: string | null): string | undefined {
  const raw = String(urlLike || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.+$/, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

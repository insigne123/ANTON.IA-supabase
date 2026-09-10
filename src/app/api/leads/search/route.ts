// src/app/api/leads/search/route.ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from "next/server";
import { normalizeDomainList } from "@/lib/domain";
import {
  CompanyFilterSearchRequestSchema,
  CompanyNameSearchRequestSchema,
  CompanyPeopleSearchRequestSchema,
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
import { buildBatchLeadSearchPayload } from '@/lib/server/lead-search-payload';

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
    total_entries: source.total_entries,
    total_pages: source.total_pages,
    raw_count: source.raw_count,
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

function asBackendStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeEmployeeRangeForBackend(value: string): string | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+empleados?$/, '').trim();
  const bounded = normalized.match(/^(\d+)\s*(?:-|,|a)\s*(\d+)$/);
  if (bounded) {
    const minimum = Number(bounded[1]);
    const maximum = Number(bounded[2]);
    if (minimum >= 0 && maximum >= minimum && maximum <= 10_000_000) return `${minimum},${maximum}`;
    return null;
  }
  const openEnded = normalized.match(/^(\d+)\s*\+$/);
  if (openEnded) {
    const minimum = Number(openEnded[1]);
    return minimum <= 10_000_000 ? `${minimum},10000000` : null;
  }
  return null;
}

async function callBackendRaw(payload: any): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  const backendSecret = String(process.env.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!backendSecret) return { ok: false, error: 'BACKEND_AUTH_NOT_CONFIGURED' };
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
      return { ok: false, error: `SERVICE_HTTP_${res.status}:${text}` };
    }
    const raw = await res.text();
    if (!raw || !raw.trim()) return { ok: false, error: 'SERVICE_EMPTY_BODY' };
    try {
      return { ok: true, json: JSON.parse(raw) };
    } catch {
      return { ok: false, error: `SERVICE_BAD_JSON:${raw.slice(0, 300)}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown' };
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
      const rawBody = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
      const explicitMode = String(rawBody.search_mode || rawBody.searchMode || '').trim().toLowerCase();

      if (explicitMode === 'companies' || explicitMode === 'organizations' || explicitMode === 'organization_search') {
        const companiesParsed = CompanyFilterSearchRequestSchema.safeParse(body);
        if (!companiesParsed.success) {
          return NextResponse.json({ error: 'INVALID_REQUEST_BODY', details: companiesParsed.error.flatten() }, { status: 400 });
        }
        const companiesReq = companiesParsed.data as any;
        const providerDecision = resolveLeadProvider({ organizationId });
        await recordSearchRequest({
          searchMode: 'companies',
          organizationId,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        });
        const quotaReservation = await reserveLeadSearchQuota(userId, organizationId);
        if ('error' in quotaReservation && quotaReservation.error) {
          return await auditSearchResponse(quotaReservation.error, {
            requestId, userId, organizationId, actorType, searchMode: 'companies',
            providerRequested: providerDecision.requestedProvider, providerUsed: providerDecision.provider,
          });
        }
        const companyKeywords = [...new Set([
          ...asBackendStringList(companiesReq.company_keywords), ...asBackendStringList(companiesReq.companyKeywords),
        ])];
        const companyLocation = [...new Set([
          ...asBackendStringList(companiesReq.company_location), ...asBackendStringList(companiesReq.companyLocation),
          ...(companiesReq.location ? asBackendStringList(companiesReq.location) : []),
        ])];
        const employeeRanges = [...new Set([
          ...asBackendStringList(companiesReq.employee_ranges), ...asBackendStringList(companiesReq.employeeRanges),
          ...(companiesReq.sizeRange ? [String(companiesReq.sizeRange)] : []),
        ])].map(normalizeEmployeeRangeForBackend).filter((range): range is string => Boolean(range));
        if (companyKeywords.length === 0 && companyLocation.length === 0 && employeeRanges.length === 0) {
          return NextResponse.json({ error: 'INVALID_REQUEST_BODY', message: 'Agrega al menos un filtro de empresa.' }, { status: 400 });
        }
        const page = Math.min(500, Math.max(1, Number(companiesReq.page ?? 1) || 1));
        // `page`/`per_page` accept both aliases; `perPage` wins when both are present.
        const perPage = Math.min(100, Math.max(1, Number(companiesReq.perPage ?? companiesReq.per_page ?? 25) || 25));
        const backendPayload = {
          provider: providerDecision.provider,
          user_id: userId,
          search_mode: 'organization_search',
          company_keywords: companyKeywords,
          company_location: companyLocation,
          employee_ranges: employeeRanges,
          page,
          per_page: perPage,
        };
        const backend = await callBackendRaw(backendPayload);
        if (!backend.ok) {
          return NextResponse.json({ error: 'SERVICE_ERROR', message: backend.error }, { status: 502 });
        }
        const payload = (backend.json ?? {}) as Record<string, any>;
        const response = NextResponse.json({
          count: Number(payload.count ?? (Array.isArray(payload.organizations) ? payload.organizations.length : 0)) || 0,
          organizations: Array.isArray(payload.organizations) ? payload.organizations : [],
          search_mode: 'companies',
          search_strategy: 'organizations_then_people',
          page: Number(payload.page ?? page) || page,
          per_page: Number(payload.per_page ?? perPage) || perPage,
          total_entries: Number.isFinite(Number(payload.total_entries)) ? Number(payload.total_entries) : undefined,
          total_pages: Number.isFinite(Number(payload.total_pages)) ? Number(payload.total_pages) : undefined,
          organization_search_credits: Number.isFinite(Number(payload.organization_search_credits)) ? Number(payload.organization_search_credits) : 1,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        }, { status: 200 });
        response.headers.set('x-search-mode', 'companies');
        response.headers.set('x-provider-used', providerDecision.provider);
        response.headers.set('x-quota-count', String(quotaReservation.quota.count));
        response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
        return await auditSearchResponse(response, {
          requestId, userId, organizationId, actorType, searchMode: 'companies',
          providerRequested: providerDecision.requestedProvider, providerUsed: providerDecision.provider,
          quotaCount: quotaReservation.quota.count, quotaLimit: quotaReservation.quota.limit,
        });
      }

      if (explicitMode === 'company_people' || explicitMode === 'organization_people') {
        const peopleParsed = CompanyPeopleSearchRequestSchema.safeParse(body);
        if (!peopleParsed.success) {
          return NextResponse.json({ error: 'INVALID_REQUEST_BODY', details: peopleParsed.error.flatten() }, { status: 400 });
        }
        const peopleReq = peopleParsed.data as any;
        const providerDecision = resolveLeadProvider({ organizationId });
        await recordSearchRequest({
          searchMode: 'company_people',
          organizationId,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
        });
        const quotaReservation = await reserveLeadSearchQuota(userId, organizationId);
        if ('error' in quotaReservation && quotaReservation.error) {
          return await auditSearchResponse(quotaReservation.error, {
            requestId, userId, organizationId, actorType, searchMode: 'company_people',
            providerRequested: providerDecision.requestedProvider, providerUsed: providerDecision.provider,
          });
        }
        const organizationIdValue = String(peopleReq.organization_id || peopleReq.organizationId || peopleReq.selected_organization_id || '').trim();
        const titles = [...new Set([
          ...asBackendStringList(peopleReq.titles),
          ...(peopleReq.title ? asBackendStringList(peopleReq.title) : []),
        ])];
        const seniorities = [...new Set(asBackendStringList(peopleReq.seniorities))];
        const personLocations = [...new Set([
          ...asBackendStringList(peopleReq.person_locations), ...asBackendStringList(peopleReq.personLocations),
          ...(peopleReq.personLocation ? asBackendStringList(peopleReq.personLocation) : []),
        ])];
        const excludePersonIds = [...new Set([
          ...asBackendStringList(peopleReq.exclude_person_ids), ...asBackendStringList(peopleReq.excludePersonIds),
        ])].slice(0, 500);
        const page = Math.min(500, Math.max(1, Number(peopleReq.page ?? 1) || 1));
        const perPage = Math.min(100, Math.max(1, Number(peopleReq.perPage ?? peopleReq.per_page ?? 50) || 50));
        const backendPayload = {
          provider: providerDecision.provider,
          user_id: userId,
          search_mode: 'organization_people',
          organization_id: organizationIdValue,
          titles,
          seniorities,
          person_locations: personLocations,
          include_similar_titles: peopleReq.include_similar_titles ?? true,
          page,
          per_page: perPage,
          exclude_person_ids: excludePersonIds,
        };
        let response = await callLeadSearchService(backendPayload, {
          search_mode: 'company_people',
          organization_id: organizationIdValue,
          page,
          per_page: perPage,
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
          providerDefault: providerDecision.defaultProvider,
          providerForcedReason: providerDecision.forcedProviderReason,
          fallbackApplied: false,
        });
        response = await excludeSavedSearchResults(response, organizationId!);
        response.headers.set('x-search-mode', 'company_people');
        response.headers.set('x-provider-used', providerDecision.provider);
        response.headers.set('x-quota-count', String(quotaReservation.quota.count));
        response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
        return await auditSearchResponse(response, {
          requestId, userId, organizationId, actorType, searchMode: 'company_people',
          providerRequested: providerDecision.requestedProvider, providerUsed: providerDecision.provider,
          quotaCount: quotaReservation.quota.count, quotaLimit: quotaReservation.quota.limit,
        });
      }

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

    const newPayload = buildBatchLeadSearchPayload(currentParams, {
      provider: providerDecision.provider,
      userId,
    });

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

async function excludeSavedSearchResults(response: NextResponse, organizationId: string) {
  if (!response.ok) return response;
  const data = await response.json();
  const identity = (lead: any) => String(lead.source_provider_id || lead.apollo_id || lead.id);
  const ids = (data.leads || []).map(identity);
  const excluded = new Set<string>();
  const admin = getSupabaseAdminClient() as any;
  if (ids.length) {
    for (const table of ['leads', 'enriched_leads', 'enriched_opportunities']) {
      const { data: saved, error } = await admin.from(table).select('source_provider_id')
        .eq('organization_id', organizationId).eq('source_provider', 'apollo').in('source_provider_id', ids);
      if (error) return NextResponse.json({ error: 'SAVED_LEADS_LOOKUP_FAILED' }, { status: 503 });
      for (const row of saved || []) excluded.add(row.source_provider_id);
    }
  }
  const fresh = (data.leads || []).filter((lead: any) => !excluded.has(identity(lead)));
  return NextResponse.json({ ...data, leads: fresh, count: fresh.length, leads_count: fresh.length }, { headers: { 'Cache-Control': 'private, no-store' } });
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

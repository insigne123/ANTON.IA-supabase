// src/app/api/leads/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import {
  N8NRequestBodySchema,
  LeadsResponseSchema,
  type LeadsSearchParams
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { pickPdlEmail, searchPeopleWithPDL } from '@/lib/providers/pdl';
import { isPdlFallbackEnabled, resolveLeadProvider, resolveOrganizationIdForUser } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const USE_APIFY = String(process.env.USE_APIFY || "false") === "true";
// New Endpoint URL
const LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";
const TIMEOUT_MS = Number(process.env.LEADS_N8N_TIMEOUT_MS ?? 60000);
const MAX_RETRIES = Number(process.env.LEADS_N8N_MAX_RETRIES ?? 0);
const PDL_DATA_INCLUDE = [
  'id',
  'full_name',
  'first_name',
  'last_name',
  'job_title',
  'linkedin_url',
  'image_url',
  'work_email',
  'recommended_personal_email',
  'location_name',
  'location_country',
  'job_company_name',
  'job_company_website',
  'job_company_size',
  'job_company_industry',
];

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
      console.log("Raw Response from Service:", raw);

      if (!raw || !raw.trim()) {
        throw new Error("SERVICE_EMPTY_BODY");
      }

      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`SERVICE_BAD_JSON:${raw.slice(0, 300)}`);
      }

      // Assume response format is compatible or needs normalization.
      // Trying to use existing normalizer to be safe, assuming the new service returns something similar to existing n8n/apify structure
      // If it fails validation, we might need to adjust.
      // For now, let's normalize it.
      const normalized = normalizeFromN8N(json);
      LeadsResponseSchema.parse(normalized);

      return NextResponse.json({ ...normalized, ...(meta || {}) }, { status: 200 });
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

async function callPdlLeadSearch(currentParams: LeadsSearchParams[number], meta?: Record<string, unknown>) {
  const maxResultsCap = Number(process.env.PDL_MAX_RESULTS ?? 200);
  const requestedMax = Number(currentParams.max_results ?? 100);
  const maxResults = Math.max(1, Math.min(Number.isFinite(requestedMax) ? requestedMax : 100, maxResultsCap));
  const perPageCfg = Number(process.env.PDL_SEARCH_PAGE_SIZE ?? 100);
  const perPage = Math.max(1, Math.min(perPageCfg, 100));

  const sql = buildPdlSearchSql(currentParams);
  const leads: any[] = [];
  const seenIds = new Set<string>();
  let scrollToken: string | undefined;
  const maxPages = Math.max(1, Math.min(100, Number(process.env.PDL_SEARCH_MAX_PAGES ?? 10)));
  let page = 1;

  while (leads.length < maxResults && page <= maxPages) {
    const remaining = maxResults - leads.length;
    const size = Math.max(1, Math.min(perPage, remaining));

    const result = await searchPeopleWithPDL({
      sql,
      size,
      scrollToken,
      dataInclude: PDL_DATA_INCLUDE,
    });

    const people = Array.isArray(result.data) ? result.data : [];
    if (people.length === 0) break;

    for (let i = 0; i < people.length; i++) {
      if (leads.length >= maxResults) break;
      const person = people[i] as any;

      const firstName = String(person.first_name || '').trim();
      const lastName = String(person.last_name || '').trim();
      const fullName = String(person.full_name || '').trim();
      const [derivedFirst, ...derivedRest] = fullName.split(/\s+/).filter(Boolean);
      const finalFirst = firstName || derivedFirst || '';
      const finalLast = lastName || derivedRest.join(' ') || '';
      const id = String(person.id || '').trim() || String(person.linkedin_url || '').trim() || `${fullName || 'lead'}-${page}-${i}`;
      if (seenIds.has(id)) continue;

      leads.push({
        id,
        first_name: finalFirst || undefined,
        last_name: finalLast || undefined,
        email: pickPdlEmail(person) || undefined,
        title: String(person.job_title || '').trim() || undefined,
        organization: {
          name: String(person.job_company_name || '').trim() || undefined,
          domain: cleanDomain(person.job_company_website),
        },
        linkedin_url: String(person.linkedin_url || '').trim() || undefined,
        photo_url: String(person.image_url || '').trim() || undefined,
        email_status: pickPdlEmail(person) ? 'verified' : 'unknown',
      });

      seenIds.add(id);
    }

    if (!result.scrollToken || people.length < size) break;
    scrollToken = result.scrollToken;
    page++;
  }

  const normalized = LeadsResponseSchema.parse({
    count: leads.length,
    leads,
  });

  return NextResponse.json({ ...normalized, ...(meta || {}) }, { status: 200 });
}

export async function POST(req: NextRequest) {
  // 1. Authenticate: Support both session cookies and x-user-id header (for Cloud Functions)
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';

  if (userIdFromHeader && !isTrustedInternalRequest(req)) {
    return NextResponse.json(
      { error: "UNAUTHORIZED_INTERNAL_REQUEST", message: "Invalid internal API secret" },
      { status: 401 }
    );
  }

  let userId: string;

  if (userIdFromHeader) {
    // Server-to-server call from Cloud Functions
    userId = userIdFromHeader;
  } else {
    // Regular user session
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: "User must be logged in" }, { status: 401 });
    }

    userId = user.id;
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  // 2. Parse existing schema (array)
  const parsed = N8NRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_REQUEST_BODY", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const currentParams = parsed.data[0]; // Take the first item
  const requestedProvider = Array.isArray(body)
    ? String((body?.[0] as any)?.provider || '').trim().toLowerCase()
    : '';
  const organizationId = await resolveOrganizationIdForUser(userId);
  const providerDecision = resolveLeadProvider({
    requestedProvider,
    organizationId,
    defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
    fallbackDefaultProvider: 'apollo',
  });

  let fallbackApplied = false;
  let fallbackReason: string | undefined;

    if (providerDecision.provider === 'pdl') {
    try {
      const response = await callPdlLeadSearch(currentParams, {
        providerRequested: providerDecision.requestedProvider,
        providerUsed: 'pdl',
        providerDefault: providerDecision.defaultProvider,
        providerForcedReason: providerDecision.forcedApolloReason,
        fallbackApplied: false,
      });
      response.headers.set('x-provider-used', 'pdl');
      return response;
    } catch (error: any) {
      if (!isPdlFallbackEnabled()) {
        return NextResponse.json(
          {
            error: 'PDL_SEARCH_ERROR',
            message: error?.message || 'PDL search failed',
            providerRequested: providerDecision.requestedProvider,
            providerUsed: 'pdl',
            fallbackApplied: false,
          },
          { status: 502 },
        );
      }
      fallbackApplied = true;
      fallbackReason = error?.message || 'pdl_search_failed';
    }
  }

  if (USE_APIFY) {
    const url = new URL(req.url);
    url.pathname = "/api/leads/apify";
    return NextResponse.redirect(url, 307);
  }

  // 3. Construct new payload
  console.log("Current Params from request:", currentParams);
  console.log("Authenticated User ID:", userId);

  const newPayload = {
    // Strict payload based on specific service requirements
    user_id: userId || undefined,

    industry_keywords: currentParams.industry_keywords,
    company_location: currentParams.company_location,

    // API requires 'titles' as array. Schema default is empty string, we convert to empty array or single-item array.
    titles: Array.isArray(currentParams.titles)
      ? currentParams.titles
      : (typeof currentParams.titles === 'string' && currentParams.titles.length > 0 ? [currentParams.titles] : []),

    // Service uses "employee_range" (singular) but accepts the array values from "employee_ranges"
    employee_range: currentParams.employee_ranges,

    max_results: 100,
  };

  if (!newPayload.titles) newPayload.titles = [];

  console.log("Outgoing Payload to Service:", JSON.stringify(newPayload, null, 2));

  const response = await callLeadSearchService(newPayload, {
    providerRequested: providerDecision.requestedProvider,
    providerUsed: 'apollo',
    providerDefault: providerDecision.defaultProvider,
    providerForcedReason: providerDecision.forcedApolloReason,
    fallbackApplied,
    fallbackReason,
  });
  response.headers.set('x-provider-used', 'apollo');
  return response;
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

function buildPdlSearchSql(params: LeadsSearchParams[number]) {
  const clauses: string[] = [];

  const titles = String(params.titles || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (titles.length > 0) {
    clauses.push(`(${titles.map((t) => containsClause('job_title', t)).join(' OR ')})`);
  }

  const industries = (params.industry_keywords || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
  if (industries.length > 0) {
    clauses.push(`(${industries.map((i) => containsClause('job_company_industry', i)).join(' OR ')})`);
  }

  const locations = (params.company_location || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
  if (locations.length > 0) {
    clauses.push(`(${locations.map((l) => containsClause('location_name', l)).join(' OR ')})`);
  }

  const employeeRanges = (params.employee_ranges || []).map((x) => String(x).trim()).filter(Boolean);
  const employeeClause = buildEmployeeRangeClause(employeeRanges);
  if (employeeClause) clauses.push(employeeClause);

  clauses.push('(full_name IS NOT NULL)');
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return `SELECT * FROM person${where}`;
}

function buildEmployeeRangeClause(ranges: string[]) {
  const normalized = ranges
    .map((range) => parseEmployeeRange(range))
    .filter((x): x is { min?: number; max?: number } => !!x);

  if (normalized.length === 0) return '';

  const parts: string[] = [];
  for (const range of normalized) {
    if (typeof range.min === 'number' && typeof range.max === 'number') {
      parts.push(`(job_company_size >= ${range.min} AND job_company_size <= ${range.max})`);
      continue;
    }
    if (typeof range.min === 'number') {
      parts.push(`(job_company_size >= ${range.min})`);
      continue;
    }
    if (typeof range.max === 'number') {
      parts.push(`(job_company_size <= ${range.max})`);
    }
  }

  if (parts.length === 0) return '';
  return `(${parts.join(' OR ')})`;
}

function parseEmployeeRange(input: string): { min?: number; max?: number } | null {
  const normalized = String(input || '').trim();
  if (!normalized) return null;

  const plus = normalized.match(/^(\d+)\+$/);
  if (plus) {
    return { min: Number(plus[1]) };
  }

  const range = normalized.match(/^(\d+)\s*[-,]\s*(\d+)$/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return a <= b ? { min: a, max: b } : { min: b, max: a };
    }
  }

  const exact = Number(normalized);
  if (Number.isFinite(exact) && exact > 0) {
    return { min: exact, max: exact };
  }

  return null;
}

function containsClause(field: string, value: string) {
  const escaped = String(value || '').trim().replace(/'/g, "''").replace(/%/g, '').replace(/_/g, '');
  return `${field} LIKE '%${escaped}%'`;
}

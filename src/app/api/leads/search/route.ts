// src/app/api/leads/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { normalizeDomainList } from "@/lib/domain";
import {
  CompanyNameSearchRequestSchema,
  N8NRequestBodySchema,
  LinkedInProfileSearchRequestSchema,
  LeadsResponseSchema,
  type LeadsSearchParams
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { enrichPersonWithPDL, pickPdlEmail, pickPdlPhones, searchCompaniesWithPDL, searchPeopleWithPDL } from '@/lib/providers/pdl';
import { isPdlFallbackEnabled, resolveLeadProvider, resolveOrganizationIdForUser } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const USE_APIFY = String(process.env.USE_APIFY || "false") === "true";
const DEFAULT_LEAD_SEARCH_URL = "https://studio--studio-6624658482-61b7b.us-central1.hosted.app/api/lead-search";
const LEAD_SEARCH_URL = process.env.ANTONIA_LEAD_SEARCH_URL || process.env.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL;
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
  'mobile_phone',
  'work_phone',
  'phone_numbers',
];

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

  const email =
    raw?.email ||
    raw?.work_email ||
    raw?.recommended_personal_email ||
    raw?.personal_email ||
    raw?.primary_email ||
    undefined;

  return {
    id:
      String(raw?.id || raw?.person_id || raw?.apollo_id || '').trim() ||
      String(raw?.linkedin_url || raw?.linkedinUrl || raw?.linkedin_profile_url || '').trim() ||
      String(email || '').trim() ||
      `lead-${index + 1}`,
    first_name: String(raw?.first_name || split.firstName || '').trim() || undefined,
    last_name: String(raw?.last_name || split.lastName || '').trim() || undefined,
    email: String(email || '').trim() || undefined,
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
    apollo_id: String(raw?.apollo_id || raw?.apolloId || raw?.id || raw?.person_id || '').trim() || undefined,
    primary_phone:
      String(raw?.primary_phone || raw?.primaryPhone || raw?.mobile_phone || raw?.work_phone || '').trim() || undefined,
    phone_numbers: Array.isArray(raw?.phone_numbers)
      ? raw.phone_numbers
      : Array.isArray(raw?.phoneNumbers)
        ? raw.phoneNumbers
        : undefined,
    enrichment_status: String(raw?.enrichment_status || raw?.enrichmentStatus || '').trim() || undefined,
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

function pickLeadSearchMeta(json: unknown) {
  const payload = Array.isArray(json) ? (json[0] ?? {}) : (json ?? {});
  if (!payload || typeof payload !== 'object') return {};

  const source = payload as Record<string, any>;
  return {
    batch_run_id: source.batch_run_id,
    search_mode: source.search_mode,
    company_name: source.company_name,
    leads_count: source.leads_count,
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
    debug_logs: Array.isArray(source.debug_logs) ? source.debug_logs : undefined,
  };
}

function isApolloPhoneRevealWebhookError(message?: string | null) {
  const text = String(message || '').toLowerCase();
  return text.includes('webhook_url') && text.includes('reveal_phone_number');
}

function hasApolloProfileMatch(person: any) {
  if (!person || typeof person !== 'object') return false;
  return Boolean(
    String(person.id || '').trim() ||
    String(person.linkedin_url || '').trim() ||
    String(person.name || '').trim() ||
    String(person.first_name || '').trim() ||
    String(person.last_name || '').trim()
  );
}

function pickApolloProfileEmail(person: any, revealEmail: boolean) {
  if (!revealEmail) return undefined;
  const primary = String(person?.email || '').trim();
  if (primary) return primary;
  if (Array.isArray(person?.personal_emails)) {
    const personal = person.personal_emails
      .map((value: unknown) => String(value || '').trim())
      .find(Boolean);
    if (personal) return personal;
  }
  return undefined;
}

function pickApolloProfilePhones(person: any, revealPhone: boolean) {
  if (!revealPhone) {
    return { primaryPhone: undefined as string | undefined, phoneNumbers: undefined as any[] | undefined };
  }

  const items: any[] = [];
  const push = (value: unknown, type: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    items.push({
      raw_number: normalized,
      sanitized_number: normalized,
      type,
      position: 'current',
      status: 'unknown',
    });
  };

  push(person?.phone_number, 'phone');
  push(person?.mobile_phone, 'mobile');
  push(person?.work_phone, 'work');

  const unique = new Map<string, any>();
  for (const item of items) {
    const key = String(item.sanitized_number || '').trim();
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }

  const phoneNumbers = Array.from(unique.values());
  return {
    primaryPhone: phoneNumbers[0]?.sanitized_number || undefined,
    phoneNumbers: phoneNumbers.length > 0 ? phoneNumbers : undefined,
  };
}

function mapApolloProfileLead(person: any, index: number, options?: { revealEmail?: boolean; revealPhone?: boolean }) {
  const revealEmail = Boolean(options?.revealEmail);
  const revealPhone = Boolean(options?.revealPhone);
  const email = pickApolloProfileEmail(person, revealEmail);
  const phones = pickApolloProfilePhones(person, revealPhone);

  return {
    id:
      String(person?.id || '').trim() ||
      String(person?.linkedin_url || '').trim() ||
      String(email || '').trim() ||
      `lead-${index + 1}`,
    first_name: String(person?.first_name || '').trim() || undefined,
    last_name: String(person?.last_name || '').trim() || undefined,
    email: email || undefined,
    title: String(person?.title || person?.headline || '').trim() || undefined,
    organization: {
      id: String(person?.organization?.id || person?.organization_id || '').trim() || undefined,
      name: String(person?.organization?.name || '').trim() || undefined,
      domain: cleanDomain(person?.organization?.primary_domain || person?.organization?.website_url),
      industry: String(person?.organization?.industry || '').trim() || undefined,
      website_url: String(person?.organization?.website_url || '').trim() || undefined,
      linkedin_url: String(person?.organization?.linkedin_url || '').trim() || undefined,
    },
    linkedin_url: String(person?.linkedin_url || '').trim() || undefined,
    photo_url: String(person?.photo_url || '').trim() || undefined,
    email_status: String(person?.email_status || (email ? 'verified' : 'unknown')).trim() || undefined,
    apollo_id: String(person?.id || '').trim() || undefined,
    primary_phone: phones.primaryPhone,
    phone_numbers: phones.phoneNumbers,
  };
}

async function callApolloProfileSearch(
  params: {
    linkedinUrl: string;
    revealEmail: boolean;
    revealPhone: boolean;
  },
  meta?: Record<string, unknown>
) {
  const apiKey = String(process.env.APOLLO_API_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'APOLLO_API_KEY_MISSING',
        message: 'APOLLO_API_KEY missing',
        ...(meta || {}),
      },
      { status: 502 },
    );
  }

  const requestedReveal = buildRevealFlags(params.revealEmail, params.revealPhone);

  try {
    const response = await fetchWithTimeout(
      `${APOLLO_BASE}/people/match`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Api-Key': apiKey,
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          linkedin_url: params.linkedinUrl,
          reveal_personal_emails: params.revealEmail,
          reveal_phone_number: params.revealPhone,
        }),
      },
      TIMEOUT_MS,
    );

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
      const message = String(json?.error || json?.message || raw || `APOLLO_PROFILE_HTTP_${response.status}`).trim();
      return NextResponse.json(
        {
          error: 'APOLLO_PROFILE_SEARCH_ERROR',
          message,
          requested_reveal: requestedReveal,
          ...(meta || {}),
        },
        { status: 502 },
      );
    }

    const person = json?.person;
    if (!hasApolloProfileMatch(person)) {
      return NextResponse.json(
        {
          count: 0,
          leads: [],
          requested_reveal: requestedReveal,
          applied_reveal: requestedReveal,
          effective_reveal: buildRevealFlags(false, false),
          ...(meta || {}),
        },
        { status: 200 },
      );
    }

    const lead = mapApolloProfileLead(person, 0, {
      revealEmail: params.revealEmail,
      revealPhone: params.revealPhone,
    });
    const phoneNumbers = Array.isArray(lead.phone_numbers) ? lead.phone_numbers : [];
    const phoneFound = Boolean(lead.primary_phone) || phoneNumbers.length > 0;
    const emailFound = Boolean(lead.email);

    const responseBody: Record<string, unknown> = {
      count: 1,
      leads: [lead],
      requested_reveal: requestedReveal,
      applied_reveal: requestedReveal,
      effective_reveal: buildRevealFlags(params.revealEmail ? emailFound : false, params.revealPhone ? phoneFound : false),
      ...(meta || {}),
    };

    if (params.revealPhone && !phoneFound) {
      responseBody.phone_enrichment = {
        requested: true,
        queued: false,
        status: 'skipped',
        message: 'La busqueda encontro el perfil, pero no habia telefono disponible en Apollo para este lead.',
        webhook_url: null,
        provider_status: typeof response.status === 'number' ? response.status : null,
        provider_details: 'apollo_phone_not_found',
      };
      responseBody.provider_warnings = [
        'La busqueda encontro el perfil, pero Apollo no devolvio telefono para este lead.',
      ];
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'APOLLO_PROFILE_SEARCH_ERROR',
        message: error?.message || 'Unknown Apollo profile search error',
        requested_reveal: requestedReveal,
        ...(meta || {}),
      },
      { status: 502 },
    );
  }
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

      const normalized = normalizeLeadSearchResponse(json);
      const responseMeta = pickLeadSearchMeta(json);

      if (payload?.search_mode === 'linkedin_profile' && normalized.count > 1) {
        return NextResponse.json(
          {
            error: 'PROFILE_SEARCH_BACKEND_MISMATCH',
            message: 'El backend devolvio multiples resultados para una busqueda de perfil unico.',
            search_mode: 'linkedin_profile',
            leads_count: normalized.count,
            ...responseMeta,
            ...(meta || {}),
          },
          { status: 502 },
        );
      }

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

function buildRevealFlags(email: boolean, phone: boolean) {
  return { email, phone };
}

function mapPdlPersonToLead(person: any, index: number, options?: { revealEmail?: boolean; revealPhone?: boolean }) {
  const revealEmail = Boolean(options?.revealEmail);
  const revealPhone = Boolean(options?.revealPhone);
  const email = revealEmail ? pickPdlEmail(person) : undefined;
  const phoneData = revealPhone ? pickPdlPhones(person) : { primaryPhone: null, phoneNumbers: undefined };
  const fullName =
    String(person?.full_name || '').trim() ||
    `${String(person?.first_name || '').trim()} ${String(person?.last_name || '').trim()}`.trim() ||
    'Unknown';

  return {
    id:
      String(person?.id || '').trim() ||
      String(person?.linkedin_url || '').trim() ||
      String(email || '').trim() ||
      `lead-${index + 1}`,
    first_name: String(person?.first_name || '').trim() || splitFullName(fullName).firstName || undefined,
    last_name: String(person?.last_name || '').trim() || splitFullName(fullName).lastName || undefined,
    email: email || undefined,
    title: String(person?.job_title || '').trim() || undefined,
    organization: {
      name: String(person?.job_company_name || '').trim() || undefined,
      domain: cleanDomain(person?.job_company_website),
      industry: String(person?.job_company_industry || '').trim() || undefined,
      website_url: String(person?.job_company_website || '').trim() || undefined,
    },
    linkedin_url: String(person?.linkedin_url || '').trim() || undefined,
    photo_url: String(person?.image_url || '').trim() || undefined,
    email_status: email ? 'verified' : 'unknown',
    primary_phone: phoneData.primaryPhone || undefined,
    phone_numbers: phoneData.phoneNumbers,
  };
}

async function callPdlProfileSearch(
  params: {
    linkedinUrl: string;
    revealEmail: boolean;
    revealPhone: boolean;
  },
  meta?: Record<string, unknown>
) {
  const requestedReveal = buildRevealFlags(params.revealEmail, params.revealPhone);
  const result = await enrichPersonWithPDL({
    linkedinUrl: params.linkedinUrl,
    dataInclude: PDL_DATA_INCLUDE,
  });

  if (!result.matched || !result.person) {
    return NextResponse.json(
      {
        count: 0,
        leads: [],
        requested_reveal: requestedReveal,
        applied_reveal: requestedReveal,
        effective_reveal: buildRevealFlags(false, false),
        ...(meta || {}),
      },
      { status: 200 },
    );
  }

  const lead = mapPdlPersonToLead(result.person, 0, {
    revealEmail: params.revealEmail,
    revealPhone: params.revealPhone,
  });

  const phoneNumbers = Array.isArray(lead.phone_numbers) ? lead.phone_numbers : [];
  const phoneFound = params.revealPhone && phoneNumbers.length > 0;
  const emailFound = params.revealEmail && Boolean(lead.email);
  const responseBody: Record<string, unknown> = {
    count: 1,
    leads: [lead],
    requested_reveal: requestedReveal,
    applied_reveal: requestedReveal,
    effective_reveal: buildRevealFlags(emailFound, phoneFound),
    ...(meta || {}),
  };

  if (params.revealPhone && !phoneFound) {
    responseBody.phone_enrichment = {
      requested: true,
      queued: false,
      status: 'skipped',
      message: 'No se encontro telefono para este perfil en la fuente disponible.',
      webhook_url: null,
      provider_status: typeof result.status === 'number' ? result.status : null,
      provider_details: 'pdl_phone_not_found',
    };
    responseBody.provider_warnings = [
      'La busqueda encontro el perfil, pero no habia telefono disponible en la fuente configurada.',
    ];
  }

  return NextResponse.json(responseBody, { status: 200 });
}

async function searchPdlOrganizationCandidates(companyName: string, size = 8) {
  const safeName = normalizeName(companyName);
  if (!safeName) return [];

  const result = await searchCompaniesWithPDL({
    sql: `SELECT * FROM company WHERE ${containsClause('name', safeName)}`,
    size: Math.max(1, Math.min(25, size)),
    dataInclude: ['id', 'name', 'website', 'linkedin_url'],
  });

  const target = normalizeName(companyName);
  const companies = Array.isArray(result.data) ? result.data : [];
  return companies
    .map((company: any) => {
      const domain = cleanDomain(company?.website) || undefined;
      return {
        id: String(company?.id || '').trim() || domain || normalizeName(company?.name || '') || `org-${Math.random().toString(36).slice(2, 8)}`,
        name: String(company?.name || '').trim() || 'Unknown',
        primary_domain: domain,
        website_url: String(company?.website || '').trim() || (domain ? `https://${domain}` : undefined),
        linkedin_url: String(company?.linkedin_url || '').trim() || undefined,
        match_score: similarityScore(target, normalizeName(company?.name || '')),
      };
    })
    .sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
}

async function callPdlCompanyNameSearch(
  params: {
    companyName?: string;
    titles?: string[];
    maxResults?: number;
    organizationDomains?: string[];
    selectedOrganizationId?: string;
    selectedOrganizationName?: string;
    selectedOrganizationDomain?: string;
  },
  meta?: Record<string, unknown>
) {
  const companyName = String(params.companyName || params.selectedOrganizationName || '').trim();
  const selectedOrganizationId = String(params.selectedOrganizationId || '').trim();
  const selectedOrganizationName = String(params.selectedOrganizationName || '').trim();
  const selectedOrganizationDomain = cleanDomain(params.selectedOrganizationDomain);
  const normalizedTitles = (params.titles || []).map((value) => String(value).trim()).filter(Boolean).slice(0, 8);
  const maxResults = Math.max(1, Math.min(Number(params.maxResults || 25) || 25, 200));
  const organizationDomains = normalizeDomainList([
    ...(params.organizationDomains || []),
    selectedOrganizationDomain || undefined,
  ]);

  let selectedOrganization: any | undefined;
  let candidateOrganizations: any[] = [];

  if (companyName) {
    candidateOrganizations = await searchPdlOrganizationCandidates(companyName, 8);
  }

  if (candidateOrganizations.length > 0) {
    selectedOrganization = candidateOrganizations.find((candidate) => {
      if (selectedOrganizationId && candidate.id === selectedOrganizationId) return true;
      if (selectedOrganizationDomain && candidate.primary_domain === selectedOrganizationDomain) return true;
      if (selectedOrganizationName && normalizeName(candidate.name) === normalizeName(selectedOrganizationName)) return true;
      return false;
    });
  }

  if (!selectedOrganization && !organizationDomains.length && candidateOrganizations.length > 1) {
    return NextResponse.json(
      {
        count: 0,
        leads: [],
        company_name: companyName,
        requires_organization_selection: true,
        organization_candidates: candidateOrganizations,
        ...(meta || {}),
      },
      { status: 200 },
    );
  }

  if (!selectedOrganization && candidateOrganizations.length === 1) {
    selectedOrganization = candidateOrganizations[0];
  }

  const finalDomains = normalizeDomainList([
    ...organizationDomains,
    selectedOrganization?.primary_domain,
  ]);

  const clauses: string[] = [];
  if (finalDomains.length > 0) {
    clauses.push(`(${finalDomains.map((domain) => containsClause('job_company_website', domain)).join(' OR ')})`);
  } else if (companyName) {
    clauses.push(`(${containsClause('job_company_name', companyName)})`);
  }

  if (normalizedTitles.length > 0) {
    clauses.push(`(${normalizedTitles.map((title) => containsClause('job_title', title)).join(' OR ')})`);
  }

  clauses.push('(full_name IS NOT NULL)');
  const sql = `SELECT * FROM person WHERE ${clauses.join(' AND ')}`;

  const leads: any[] = [];
  const seenIds = new Set<string>();
  let page = 1;
  let scrollToken: string | undefined;
  const perPage = Math.max(1, Math.min(100, Math.min(maxResults, 50)));

  while (leads.length < maxResults && page <= 10) {
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
      const lead = mapPdlPersonToLead(people[i], leads.length, { revealEmail: true, revealPhone: false });
      const dedupeKey = String(lead.id || lead.linkedin_url || `${lead.first_name}-${lead.last_name}-${lead.organization?.domain || lead.organization?.name || ''}`).toLowerCase();
      if (dedupeKey && seenIds.has(dedupeKey)) continue;
      if (dedupeKey) seenIds.add(dedupeKey);
      leads.push(lead);
    }

    if (!result.scrollToken || people.length < size) break;
    scrollToken = result.scrollToken;
    page++;
  }

  return NextResponse.json(
    {
      count: leads.length,
      leads,
      company_name: companyName || selectedOrganization?.name,
      selected_organization: selectedOrganization,
      ...(meta || {}),
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  try {
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
      userId = userIdFromHeader;
    } else {
      const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
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

    if (!Array.isArray(body)) {
      const requestedProvider = String((body as any)?.provider || '').trim().toLowerCase();
      const organizationId = await resolveOrganizationIdForUser(userId);
      const profileParsed = LinkedInProfileSearchRequestSchema.safeParse(body);
      if (profileParsed.success) {
        const profileReq = profileParsed.data;
        const linkedinUrl = String(
          profileReq.linkedin_url || profileReq.linkedin_profile_url || profileReq.linkedinUrl || ''
        ).trim();
        const providerDecision = resolveLeadProvider({
          requestedProvider,
          organizationId,
          defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
          fallbackDefaultProvider: 'apollo',
        });

      const profilePayload = {
        user_id: userId,
        search_mode: 'linkedin_profile',
        linkedin_url: linkedinUrl,
        reveal_email: profileReq.reveal_email ?? profileReq.revealEmail ?? true,
          reveal_phone: profileReq.reveal_phone ?? profileReq.revealPhone ?? true,
        };

      const profileMeta = {
        providerRequested: providerDecision.requestedProvider,
        providerDefault: providerDecision.defaultProvider,
        providerForcedReason: providerDecision.forcedApolloReason,
        search_mode: 'linkedin_profile',
        requested_reveal: {
          email: profilePayload.reveal_email,
          phone: profilePayload.reveal_phone,
        },
      };

      if (providerDecision.provider === 'pdl') {
        const response = await callPdlProfileSearch(
          {
            linkedinUrl,
            revealEmail: Boolean(profilePayload.reveal_email),
            revealPhone: Boolean(profilePayload.reveal_phone),
          },
          {
            ...profileMeta,
            providerUsed: 'pdl',
            fallbackApplied: false,
          },
        );
        response.headers.set('x-provider-used', 'pdl');
        response.headers.set('x-search-mode', 'linkedin_profile');
        return response;
      }

      const response = await callApolloProfileSearch(
        {
          linkedinUrl,
          revealEmail: Boolean(profilePayload.reveal_email),
          revealPhone: Boolean(profilePayload.reveal_phone),
        },
        {
        ...profileMeta,
        providerUsed: 'apollo',
        fallbackApplied: false,
        },
      );

      if (profilePayload.reveal_phone) {
        const errorPayload = await response.clone().json().catch(() => null);
        const errorMessage = String(errorPayload?.message || errorPayload?.details || errorPayload?.error || '');

        if (response.status === 502 && isApolloPhoneRevealWebhookError(errorMessage)) {
          const fallbackResponse = await callApolloProfileSearch(
            {
              linkedinUrl,
              revealEmail: Boolean(profilePayload.reveal_email),
              revealPhone: false,
            },
            {
              ...profileMeta,
              providerUsed: 'apollo',
              effective_reveal: {
                email: profilePayload.reveal_email,
                phone: false,
              },
              applied_reveal: {
                email: profilePayload.reveal_email,
                phone: false,
              },
              phone_enrichment: {
                requested: true,
                queued: false,
                status: 'skipped',
                message: 'La busqueda encontro el perfil, pero el telefono se omitio porque Apollo exige webhook_url para reveal_phone_number.',
                webhook_url: null,
                provider_status: 400,
                provider_details: errorMessage,
              },
              provider_warnings: [
                'La busqueda se reintento sin telefono porque Apollo exige webhook_url para reveal_phone_number.',
              ],
              phone_reveal_fallback_applied: true,
              phone_reveal_fallback_reason: 'apollo_requires_webhook_url',
              warning: 'La busqueda se reintento sin telefono porque Apollo exige webhook_url para reveal_phone_number.',
              fallbackApplied: false,
            },
          );
          fallbackResponse.headers.set('x-provider-used', 'apollo');
          fallbackResponse.headers.set('x-search-mode', 'linkedin_profile');
          return fallbackResponse;
        }
      }

      if (!response.ok && providerDecision.pdlEligible && isPdlFallbackEnabled()) {
        const errorPayload = await response.clone().json().catch(() => null);
        const errorMessage = String(errorPayload?.message || errorPayload?.details || errorPayload?.error || '').trim();
        const fallbackResponse = await callPdlProfileSearch(
          {
            linkedinUrl,
            revealEmail: Boolean(profilePayload.reveal_email),
            revealPhone: Boolean(profilePayload.reveal_phone),
          },
          {
            ...profileMeta,
            providerUsed: 'pdl',
            fallbackApplied: true,
            fallbackReason: errorMessage || `apollo_profile_search_failed_${response.status}`,
          },
        );
        fallbackResponse.headers.set('x-provider-used', 'pdl');
        fallbackResponse.headers.set('x-search-mode', 'linkedin_profile');
        return fallbackResponse;
      }

      response.headers.set('x-provider-used', 'apollo');
      response.headers.set('x-search-mode', 'linkedin_profile');
      return response;
      }

      const companyParsed = CompanyNameSearchRequestSchema.safeParse(body);
      if (companyParsed.success) {
        const companyReq = companyParsed.data;
        const organizationDomains = normalizeDomainList([
          ...(companyReq.organization_domains || []),
          ...(companyReq.organizationDomains || []),
          ...(companyReq.organization_domain_list || []),
          ...(companyReq.organizationDomainList || []),
          companyReq.organization_domain,
          companyReq.organizationDomain,
          companyReq.company_domain,
          companyReq.companyDomain,
          companyReq.selected_organization_domain,
        ]);
        const companyPayload = {
          user_id: userId,
          search_mode: 'company_name',
          company_name: String(companyReq.company_name || '').trim() || undefined,
          seniorities: companyReq.seniorities || [],
          titles: Array.isArray(companyReq.titles) ? companyReq.titles : [],
          max_results: companyReq.max_results,
          organization_domains: organizationDomains.length ? organizationDomains : undefined,
          selected_organization_id: String(companyReq.selected_organization_id || '').trim() || undefined,
          selected_organization_name: String(companyReq.selected_organization_name || '').trim() || undefined,
          selected_organization_domain: normalizeDomainList([companyReq.selected_organization_domain])[0] || undefined,
        };
        const providerDecision = resolveLeadProvider({
          requestedProvider,
          organizationId,
          defaultProviderEnv: 'LEADS_PROVIDER_DEFAULT',
          fallbackDefaultProvider: 'apollo',
        });
        const companyMeta = {
          providerRequested: providerDecision.requestedProvider,
          providerDefault: providerDecision.defaultProvider,
          providerForcedReason: providerDecision.forcedApolloReason,
          search_mode: 'company_name',
          company_name: companyPayload.company_name || companyPayload.selected_organization_name,
        };

        if (providerDecision.provider === 'pdl') {
          const pdlResponse = await callPdlCompanyNameSearch(
            {
              companyName: companyPayload.company_name,
              titles: Array.isArray(companyPayload.titles) ? companyPayload.titles : [],
              maxResults: companyPayload.max_results,
              organizationDomains,
              selectedOrganizationId: companyPayload.selected_organization_id,
              selectedOrganizationName: companyPayload.selected_organization_name,
              selectedOrganizationDomain: companyPayload.selected_organization_domain,
            },
            {
              ...companyMeta,
              providerUsed: 'pdl',
              fallbackApplied: false,
            },
          );
          pdlResponse.headers.set('x-provider-used', 'pdl');
          pdlResponse.headers.set('x-search-mode', 'company_name');
          return pdlResponse;
        }

        const response = await callLeadSearchService(companyPayload, {
          ...companyMeta,
          providerUsed: 'apollo',
          fallbackApplied: false,
        });

        if (!response.ok && providerDecision.pdlEligible && isPdlFallbackEnabled()) {
          const errorPayload = await response.clone().json().catch(() => null);
          const errorMessage = String(errorPayload?.message || errorPayload?.details || errorPayload?.error || '').trim();
          const fallbackResponse = await callPdlCompanyNameSearch(
            {
              companyName: companyPayload.company_name,
              titles: Array.isArray(companyPayload.titles) ? companyPayload.titles : [],
              maxResults: companyPayload.max_results,
              organizationDomains,
              selectedOrganizationId: companyPayload.selected_organization_id,
              selectedOrganizationName: companyPayload.selected_organization_name,
              selectedOrganizationDomain: companyPayload.selected_organization_domain,
            },
            {
              ...companyMeta,
              providerUsed: 'pdl',
              fallbackApplied: true,
              fallbackReason: errorMessage || `apollo_company_search_failed_${response.status}`,
            },
          );
          fallbackResponse.headers.set('x-provider-used', 'pdl');
          fallbackResponse.headers.set('x-search-mode', 'company_name');
          return fallbackResponse;
        }

        response.headers.set('x-provider-used', 'apollo');
        response.headers.set('x-search-mode', 'company_name');
        return response;
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

    console.log("Current Params from request:", currentParams);
    console.log("Authenticated User ID:", userId);

    const newPayload = {
      user_id: userId || undefined,
      industry_keywords: currentParams.industry_keywords,
      company_location: currentParams.company_location,
      titles: Array.isArray(currentParams.titles)
        ? currentParams.titles
        : (typeof currentParams.titles === 'string' && currentParams.titles.length > 0 ? [currentParams.titles] : []),
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

function normalizeName(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(grupo|the)\b/g, ' ')
    .replace(/\b(s\.?a\.?|s\.?p\.?a\.?|ltda|llc|inc|corp(oration)?|company|co|gmbh|srl|s\.?l\.?|plc|ag|sa de cv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  const intersection = Array.from(setA).filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  let score = union ? intersection / union : 0;
  if (b.startsWith(a) || a.startsWith(b)) score += 0.25;
  if (a.includes(b) || b.includes(a)) score += 0.15;
  return Math.min(score, 1);
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

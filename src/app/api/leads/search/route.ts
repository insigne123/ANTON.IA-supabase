// src/app/api/leads/search/route.ts
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { normalizeDomainList } from "@/lib/domain";
import {
  CompanyNameSearchRequestSchema,
  N8NRequestBodySchema,
  LinkedInProfileSearchRequestSchema,
  LeadsResponseSchema
} from "@/lib/schemas/leads";
import { normalizeFromN8N } from "@/lib/normalizers/n8n";
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { resolveLeadProvider, resolveOrganizationIdForUser } from '@/lib/server/provider-routing';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import { partitionLinkedInProfileLeads } from '@/lib/linkedin-profile-result';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const LINKEDIN_PROFILE_TABLE_NAME = 'people_search_leads';
const DEFAULT_APOLLO_WEBHOOK_BASE_URL = 'https://studio--leadflowai-3yjcy.us-central1.hosted.app';
const USE_APIFY = String(process.env.USE_APIFY || "false") === "true";
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
    apollo_id: String(raw?.apollo_id || raw?.apolloId || raw?.id || raw?.person_id || '').trim() || undefined,
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

function normalizeClientEnrichmentStatus(status?: string | null) {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.startsWith('pending')) return 'pending';
  return normalized;
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
    enrichment_status: String(person?.enrichment_status || '').trim() || undefined,
  };
}

type PhoneEnrichmentQueueResult = {
  queued: boolean;
  status: 'queued' | 'skipped' | 'failed';
  message: string;
  webhookUrl: string | null;
  providerStatus: number | null;
  providerDetails: string | null;
};

function getApolloOrganizationName(person: any) {
  const direct = String(person?.organization?.name || '').trim();
  if (direct) return direct;

  if (Array.isArray(person?.employment_history)) {
    const current = person.employment_history.find((item: any) => item?.current);
    const currentName = String(current?.organization_name || '').trim();
    if (currentName) return currentName;
    const firstName = String(person.employment_history[0]?.organization_name || '').trim();
    if (firstName) return firstName;
  }

  return '';
}

function getApolloOrganizationWebsite(person: any) {
  const direct = String(person?.organization?.website_url || person?.organization?.primary_domain || '').trim();
  if (direct) {
    return direct.startsWith('http') ? direct : `https://${direct}`;
  }

  const employmentWebsite = String(person?.employment_history?.[0]?.organization_website || '').trim();
  if (employmentWebsite) {
    return employmentWebsite.startsWith('http') ? employmentWebsite : `https://${employmentWebsite}`;
  }

  return null;
}

function isValidPublicHttpsUrl(url: URL) {
  if (url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
  if (hostname.endsWith('.local')) return false;
  return true;
}

function resolveRequestOrigin(req: NextRequest) {
  const candidates = [
    (() => {
      try {
        return new URL(req.url).origin;
      } catch {
        return '';
      }
    })(),
    req.headers.get('origin') || '',
    (() => {
      const referer = req.headers.get('referer') || '';
      if (!referer) return '';
      try {
        return new URL(referer).origin;
      } catch {
        return '';
      }
    })(),
    (() => {
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      return host ? `${proto}://${host}` : '';
    })(),
  ];

  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (isValidPublicHttpsUrl(parsed)) return parsed.origin;
    } catch {
      continue;
    }
  }

  return null;
}

function resolveLinkedInProfileWebhookUrl(
  recordId: string,
  revealEmail: boolean,
  revealPhone: boolean,
  requestOrigin?: string | null,
) {
  const candidates = [
    process.env.APOLLO_LINKEDIN_PROFILE_WEBHOOK_URL,
    process.env.LINKEDIN_PROFILE_WEBHOOK_URL,
    process.env.APOLLO_PROFILE_WEBHOOK_URL,
    process.env.APOLLO_WEBHOOK_URL,
    process.env.APOLLO_WEBHOOK_BASE_URL,
    process.env.LEAD_SEARCH_WEBHOOK_BASE_URL,
    process.env.APP_URL,
    process.env.CANONICAL_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    requestOrigin,
    DEFAULT_APOLLO_WEBHOOK_BASE_URL,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    try {
      let parsed = new URL(trimmed);
      if (!parsed.pathname.toLowerCase().endsWith('/api/apollo-webhook')) {
        parsed = new URL('/api/apollo-webhook', parsed);
      }
      if (!isValidPublicHttpsUrl(parsed)) continue;
      parsed.searchParams.set('record_id', recordId);
      parsed.searchParams.set('table_name', LINKEDIN_PROFILE_TABLE_NAME);
      parsed.searchParams.set('reveal_email', String(revealEmail));
      parsed.searchParams.set('reveal_phone', String(revealPhone));
      const webhookSecret = String(process.env.APOLLO_WEBHOOK_SECRET || '').trim();
      if (webhookSecret) {
        parsed.searchParams.set('webhook_secret', webhookSecret);
      }
      return parsed.toString();
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveSearchUserId(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';
  if (userIdFromHeader) {
    if (!isTrustedInternalRequest(req)) {
      return { error: NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST', message: 'Invalid internal API secret' }, { status: 401 }) };
    }
    return { userId: userIdFromHeader };
  }

  const supabase = createRouteHandlerClient({ cookies: (() => req.cookies) as any });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    return { error: NextResponse.json({ error: 'UNAUTHORIZED', message: 'User must be logged in' }, { status: 401 }) };
  }

  return { userId: user.id };
}

async function reserveLeadSearchQuota(userId: string, organizationId?: string | null) {
  const resolvedOrganizationId = organizationId || await resolveOrganizationIdForUser(userId);
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

function buildPeopleSearchLeadRow(person: any, options: {
  linkedinUrl: string;
  organizationId?: string | null;
  batchRunId?: string | null;
  enrichmentStatus?: string | null;
  revealEmail?: boolean;
}) {
  const lead = mapApolloProfileLead(person, 0, {
    revealEmail: Boolean(options.revealEmail),
    revealPhone: true,
  });
  const organizationName = getApolloOrganizationName(person) || lead.organization?.name || null;
  const organizationWebsite = getApolloOrganizationWebsite(person);
  const normalizedLinkedin = normalizeLinkedinProfileUrl(lead.linkedin_url || options.linkedinUrl) || null;
  const now = new Date().toISOString();
  const batchRunId = String(options.batchRunId || '').trim() || now;

  return {
    id: String(person?.id || '').trim(),
    linkedin_url: normalizedLinkedin,
    email: lead.email || null,
    name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || String(person?.name || '').trim() || null,
    org_name: organizationName,
    title: lead.title || null,
    organization_website: organizationWebsite,
    page: 1,
    batch_run_id: batchRunId,
    created_at: now,
    organization_id: options.organizationId || null,
    industry: lead.organization?.industry || null,
    photo_url: lead.photo_url || null,
    email_status: lead.email_status || null,
    first_name: lead.first_name || null,
    last_name: lead.last_name || null,
    organization_name: organizationName,
    updated_at: now,
    city: String(person?.city || '').trim() || null,
    state: String(person?.state || '').trim() || null,
    country: String(person?.country || '').trim() || null,
    headline: String(person?.headline || '').trim() || null,
    seniority: String(person?.seniority || '').trim() || null,
    departments: Array.isArray(person?.departments) ? person.departments : null,
    phone_numbers: Array.isArray(lead.phone_numbers) ? lead.phone_numbers : [],
    primary_phone: lead.primary_phone || null,
    enrichment_status: options.enrichmentStatus || 'completed',
    organization_domain: lead.organization?.domain || cleanDomain(organizationWebsite) || null,
    organization_industry: lead.organization?.industry || null,
    organization_size: typeof person?.organization?.estimated_num_employees === 'number'
      ? person.organization.estimated_num_employees
      : null,
  };
}

function mapStoredLinkedInProfileLead(row: any) {
  const personLike = {
    id: row?.id,
    first_name: row?.first_name,
    last_name: row?.last_name,
    email: row?.email,
    title: row?.title,
    linkedin_url: row?.linkedin_url,
    photo_url: row?.photo_url,
    email_status: row?.email_status,
    phone_numbers: Array.isArray(row?.phone_numbers) ? row.phone_numbers : [],
    primary_phone: row?.primary_phone,
    enrichment_status: row?.enrichment_status,
    organization: {
      name: row?.organization_name || row?.org_name,
      primary_domain: row?.organization_domain,
      industry: row?.organization_industry || row?.industry,
      website_url: row?.organization_website,
    },
  };

  const lead = mapApolloProfileLead(personLike, 0, {
    revealEmail: true,
    revealPhone: true,
  });
  lead.enrichment_status = normalizeClientEnrichmentStatus(row?.enrichment_status) || lead.enrichment_status;
  return lead;
}

async function saveLinkedInProfileLead(person: any, options: {
  linkedinUrl: string;
  organizationId?: string | null;
  batchRunId?: string | null;
  enrichmentStatus?: string | null;
  revealEmail?: boolean;
}) {
  const recordId = String(person?.id || '').trim();
  if (!recordId) {
    throw new Error('Profile match missing provider id');
  }

  const admin = getSupabaseAdminClient();
  const { data: existing } = await admin
    .from(LINKEDIN_PROFILE_TABLE_NAME)
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  const row = buildPeopleSearchLeadRow(person, options);
  const merged = {
    ...existing,
    ...row,
    email: row.email || existing?.email || null,
    email_status: row.email_status || existing?.email_status || null,
    phone_numbers: Array.isArray(row.phone_numbers) && row.phone_numbers.length > 0
      ? row.phone_numbers
      : (Array.isArray(existing?.phone_numbers) ? existing.phone_numbers : []),
    primary_phone: row.primary_phone || existing?.primary_phone || null,
    organization_website: row.organization_website || existing?.organization_website || null,
    organization_domain: row.organization_domain || existing?.organization_domain || null,
    organization_industry: row.organization_industry || existing?.organization_industry || row.industry || existing?.industry || null,
    title: row.title || existing?.title || null,
    name: row.name || existing?.name || null,
    first_name: row.first_name || existing?.first_name || null,
    last_name: row.last_name || existing?.last_name || null,
    photo_url: row.photo_url || existing?.photo_url || null,
    enrichment_status: row.primary_phone || row.email || existing?.primary_phone || existing?.email
      ? (options.enrichmentStatus || existing?.enrichment_status || 'completed')
      : (existing?.enrichment_status || options.enrichmentStatus || 'pending_profile'),
  };
  const { error } = await admin
    .from(LINKEDIN_PROFILE_TABLE_NAME)
    .upsert(merged, { onConflict: 'id' });

  if (error) throw error;

  const { data: persisted } = await admin
    .from(LINKEDIN_PROFILE_TABLE_NAME)
    .select('*')
    .eq('id', recordId)
    .maybeSingle();

  return persisted || merged;
}

async function markLeadAsPendingProfileEnrichment(recordId: string) {
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from(LINKEDIN_PROFILE_TABLE_NAME)
    .update({
      enrichment_status: 'pending_profile',
      updated_at: new Date().toISOString(),
    })
    .eq('id', recordId);

  if (error) throw error;
}

async function queueLinkedInProfileReveal(
  apiKey: string,
  apolloPersonId: string,
  revealEmail: boolean,
  revealPhone: boolean,
  requestOrigin?: string | null,
): Promise<PhoneEnrichmentQueueResult> {
  const webhookUrl = resolveLinkedInProfileWebhookUrl(apolloPersonId, revealEmail, revealPhone, requestOrigin);
  if (!webhookUrl) {
    return {
      queued: false,
      status: 'skipped',
        message: 'No se pudo construir un webhook publico HTTPS para pedir el telefono al proveedor.',
      webhookUrl: null,
      providerStatus: null,
      providerDetails: 'missing_public_webhook_url',
    };
  }

  const params = new URLSearchParams();
  params.set('id', apolloPersonId);
  params.set('reveal_personal_emails', String(revealEmail));
  params.set('reveal_phone_number', String(revealPhone));
  params.set('webhook_url', webhookUrl);

  try {
    const response = await fetchWithTimeout(
      `${APOLLO_BASE}/people/match?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Accept': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: '{}',
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
      const message = String(json?.error || json?.message || raw || `APOLLO_PHONE_QUEUE_HTTP_${response.status}`).trim();
      return {
        queued: false,
        status: 'failed',
        message: message || 'El proveedor no pudo encolar los datos del perfil.',
        webhookUrl,
        providerStatus: response.status,
        providerDetails: message || null,
      };
    }

    return {
      queued: true,
      status: 'queued',
      message: 'El perfil se esta completando y se actualizara en breve por webhook.',
      webhookUrl,
      providerStatus: response.status,
      providerDetails: null,
    };
  } catch (error: any) {
    return {
      queued: false,
      status: 'failed',
      message: error?.message || 'El proveedor no pudo encolar los datos del perfil.',
      webhookUrl,
      providerStatus: null,
      providerDetails: error?.message || null,
    };
  }
}

async function callApolloProfileSearch(
  params: {
    linkedinUrl: string;
    revealEmail: boolean;
    revealPhone: boolean;
    organizationId?: string | null;
    requestOrigin?: string | null;
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
          reveal_phone_number: false,
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

    const providerWarnings: string[] = [];
    let queueResult: PhoneEnrichmentQueueResult | null = null;

    let persistedProfile: any = null;

    try {
      persistedProfile = await saveLinkedInProfileLead(person, {
        linkedinUrl: params.linkedinUrl,
        organizationId: params.organizationId,
        enrichmentStatus: 'completed',
        revealEmail: params.revealEmail,
      });
    } catch (saveError: any) {
      providerWarnings.push(`No se pudo preparar el registro de seguimiento para telefono: ${saveError?.message || 'error desconocido'}`);
    }

    const lead = persistedProfile
      ? mapStoredLinkedInProfileLead(persistedProfile)
      : mapApolloProfileLead(person, 0, {
        revealEmail: params.revealEmail,
        revealPhone: false,
      });
    const emailFound = Boolean(lead.email);
    const phoneFound = Boolean(lead.primary_phone);
    const shouldQueueReveal = params.revealPhone && !phoneFound;

    if (shouldQueueReveal) {
      const apolloPersonId = String(person?.id || '').trim();
      if (!apolloPersonId) {
        queueResult = {
          queued: false,
          status: 'failed',
          message: 'El proveedor encontro el perfil, pero no devolvio un identificador valido para completar los datos solicitados.',
          webhookUrl: null,
          providerStatus: null,
          providerDetails: 'missing_apollo_person_id',
        };
      } else if (providerWarnings.length > 0) {
        queueResult = {
          queued: false,
          status: 'failed',
          message: 'No se pudo preparar el registro interno para completar los datos del perfil.',
          webhookUrl: null,
          providerStatus: null,
          providerDetails: 'failed_to_prepare_tracking_row',
        };
      } else {
        queueResult = await queueLinkedInProfileReveal(
          apiKey,
          apolloPersonId,
          params.revealEmail,
          params.revealPhone,
          params.requestOrigin,
        );

        if (queueResult?.queued) {
          try {
            await markLeadAsPendingProfileEnrichment(apolloPersonId);
          } catch (markError: any) {
            queueResult = {
              queued: false,
              status: 'failed',
              message: 'El proveedor acepto la cola de enriquecimiento, pero no se pudo marcar el registro como pendiente.',
              webhookUrl: queueResult.webhookUrl,
              providerStatus: queueResult.providerStatus,
              providerDetails: markError?.message || 'failed_to_mark_pending_profile',
            };
          }
        }
      }
    }

    if (queueResult?.queued) {
      lead.enrichment_status = 'pending';
    } else {
      const emailSatisfied = !params.revealEmail || emailFound;
      const phoneSatisfied = !params.revealPhone || phoneFound;
      lead.enrichment_status = emailSatisfied && phoneSatisfied ? 'completed' : 'failed';
    }

    const responseBody: Record<string, unknown> = {
      count: 1,
      leads: [lead],
      requested_reveal: requestedReveal,
      applied_reveal: requestedReveal,
      effective_reveal: buildRevealFlags(params.revealEmail ? emailFound : false, params.revealPhone ? phoneFound : false),
      ...(meta || {}),
    };

    if (queueResult) {
      responseBody.phone_enrichment = {
        requested: true,
        queued: queueResult.queued,
        status: queueResult.status,
        message: queueResult.message,
        webhook_url: queueResult.webhookUrl,
        provider_status: queueResult.providerStatus,
        provider_details: queueResult.providerDetails,
      };
    }

    if (providerWarnings.length > 0) {
      responseBody.provider_warnings = providerWarnings;
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: 'APOLLO_PROFILE_SEARCH_ERROR',
        message: error?.message || 'Unknown profile search error',
        requested_reveal: requestedReveal,
        ...(meta || {}),
      },
      { status: 502 },
    );
  }
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

      if (payload?.search_mode === 'linkedin_profile') {
        const { profileLeads, trackingIds } = partitionLinkedInProfileLeads(normalized.leads);
        return NextResponse.json({
          ...normalized,
          ...responseMeta,
          ...(meta || {}),
          count: profileLeads.length,
          leads_count: profileLeads.length,
          leads: profileLeads,
          ...(trackingIds.length > 0 ? { profile_tracking_ids: trackingIds } : {}),
        }, { status: 200 });
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

function buildRevealFlags(email: boolean, phone: boolean) {
  return { email, phone };
}

export async function GET(req: NextRequest) {
  try {
    const recordId = String(req.nextUrl.searchParams.get('record_id') || '').trim();
    if (!recordId) {
      return NextResponse.json({ error: 'MISSING_RECORD_ID' }, { status: 400 });
    }

    const ctx = await resolveSearchUserId(req);
    if ('error' in ctx) return ctx.error;
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
    const ctx = await resolveSearchUserId(req);
    if ('error' in ctx) return ctx.error;
    const userId = ctx.userId;

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
    }

    const requestId = req.headers.get('x-request-id')?.trim() || randomUUID();
    const actorType = req.headers.get('x-user-id')?.trim() ? 'agent' as const : 'user' as const;
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
        const profileReq = profileParsed.data;
        const linkedinUrl = String(
          profileReq.linkedin_url || profileReq.linkedin_profile_url || profileReq.linkedinUrl || ''
        ).trim();
        const organizationId = await resolveOrganizationIdForUser(userId);
        const requestedProvider = String((body as any)?.provider || '').trim().toLowerCase();
        const providerDecision = resolveLeadProvider({ requestedProvider, organizationId });
        await recordSearchRequest({
          searchMode: 'linkedin_profile',
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
            searchMode: 'linkedin_profile',
            providerRequested: providerDecision.requestedProvider,
            providerUsed: providerDecision.provider,
          });
        }
        const profilePayload = {
          user_id: userId,
          search_mode: 'linkedin_profile',
          linkedin_url: linkedinUrl,
          reveal_email: profileReq.reveal_email ?? profileReq.revealEmail ?? true,
          reveal_phone: profileReq.reveal_phone ?? profileReq.revealPhone ?? true,
        };

        const response = await callLeadSearchService(profilePayload, {
          search_mode: 'linkedin_profile',
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
          providerDefault: providerDecision.defaultProvider,
          providerForcedReason: providerDecision.forcedApolloReason,
          fallbackApplied: false,
        });
        response.headers.set('x-search-mode', 'linkedin_profile');
        response.headers.set('x-provider-used', providerDecision.provider);
        response.headers.set('x-quota-count', String(quotaReservation.quota.count));
        response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
        return await auditSearchResponse(response, {
          requestId,
          userId,
          organizationId,
          actorType,
          searchMode: 'linkedin_profile',
          providerRequested: providerDecision.requestedProvider,
          providerUsed: providerDecision.provider,
          quotaCount: quotaReservation.quota.count,
          quotaLimit: quotaReservation.quota.limit,
        });
      }

      const companyParsed = CompanyNameSearchRequestSchema.safeParse(body);
      if (companyParsed.success) {
        const companyReq = companyParsed.data;
        const organizationId = await resolveOrganizationIdForUser(userId);
        const requestedProvider = String((body as any)?.provider || '').trim().toLowerCase();
        const providerDecision = resolveLeadProvider({ requestedProvider, organizationId });
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
          providerForcedReason: providerDecision.forcedApolloReason,
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
    const requestedProvider = Array.isArray(body)
      ? String((body?.[0] as any)?.provider || '').trim().toLowerCase()
      : '';
    const organizationId = await resolveOrganizationIdForUser(userId);
    const providerDecision = resolveLeadProvider({
      requestedProvider,
      organizationId,
    });

    await recordSearchRequest({
      searchMode: 'batch',
      organizationId,
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
    });

    const fallbackApplied = false;

    if (USE_APIFY) {
      await safeAppendAntoniaEvent({
        eventKey: `search:${requestId}:bypassed:apify`,
        eventType: 'search.bypassed',
        organizationId,
        actorId: userId,
        actorType,
        entityType: 'search',
        entityId: requestId,
        sourceRoute: '/api/leads/search',
        requestId,
        correlationId: requestId,
        operationId: requestId,
        status: 'bypassed',
        outcome: 'apify_redirect',
        severity: 'warning',
        payload: { searchMode: 'batch', provider: 'apify' },
      });
      const url = new URL(req.url);
      url.pathname = "/api/leads/apify";
      return NextResponse.redirect(url, 307);
    }

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
      providerUsed: 'apollo',
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedApolloReason,
      fallbackApplied,
    });
    response.headers.set('x-provider-used', 'apollo');
    response.headers.set('x-quota-count', String(quotaReservation.quota.count));
    response.headers.set('x-quota-limit', String(quotaReservation.quota.limit));
    return await auditSearchResponse(response, {
      requestId,
      userId,
      organizationId,
      actorType,
      searchMode: 'batch',
      providerRequested: providerDecision.requestedProvider,
      providerUsed: 'apollo',
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

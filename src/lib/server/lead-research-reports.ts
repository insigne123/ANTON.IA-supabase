import {
  adaptLeadResearchResponseToReport,
  getLeadResearchStatus,
  hasMeaningfulLeadResearch,
  unwrapLeadResearchResponse,
} from '@/lib/lead-research';
import type { ContactedLead, LeadResearchReport } from '@/lib/types';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type SellerProfile = {
  full_name?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  job_title?: string | null;
  signatures?: any;
};

type LeadResearchCacheInput = {
  userId: string;
  organizationId?: string | null;
  lead: Partial<ContactedLead> & { id?: string; leadId?: string };
};

type CachedLeadResearchRow = {
  report: LeadResearchReport;
  generated_at?: string | null;
  updated_at?: string | null;
};

export type LeadResearchReportsRepository = {
  findByLeadRef: (scopeKey: string, leadRef: string) => Promise<CachedLeadResearchRow | null>;
  findByEmail: (scopeKey: string, email: string) => Promise<CachedLeadResearchRow | null>;
  upsert: (values: Record<string, any>) => Promise<void>;
};

export type EnsureLeadResearchReportDependencies = {
  findCached: typeof findCachedLeadResearchReport;
  store: (input: LeadResearchCacheInput & { report: LeadResearchReport }) => Promise<boolean>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  baseUrl: string;
  internalSecret: string;
  maxPollAttempts: number;
  pollIntervalMs: number;
};

const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cleanDomain(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function looksLikePublicEmailDomain(domain: string) {
  return ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(domain);
}

function getLeadRef(lead: Partial<ContactedLead> & { id?: string; leadId?: string }) {
  return String(
    lead.leadId ||
    lead.id ||
    lead.email ||
    (lead as any).linkedinUrl ||
    (lead as any).linkedin_url ||
    ''
  ).trim();
}

function getCompanyDomain(lead: Partial<ContactedLead> & { companyDomain?: string }) {
  const explicit = cleanDomain(lead.companyDomain || (lead as any).companyDomain);
  if (explicit) return explicit;
  const emailDomain = cleanDomain(String(lead.email || '').split('@')[1] || '');
  if (emailDomain && !looksLikePublicEmailDomain(emailDomain)) return emailDomain;
  return '';
}

function getScopeKey(userId: string, organizationId?: string | null) {
  const orgId = String(organizationId || '').trim();
  if (orgId) return orgId;
  const normalizedUserId = String(userId || '').trim();
  return normalizedUserId ? `user:${normalizedUserId}` : '';
}

function getInternalAppBaseUrl() {
  const candidates = [
    process.env.CANONICAL_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.APP_URL,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim().replace(/\/$/, '');
    if (value) return value;
  }

  return '';
}

function getCacheTtlMs() {
  const configured = Number(process.env.LEAD_RESEARCH_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CACHE_TTL_MS;
}

function isReusableCacheRow(row: CachedLeadResearchRow | null, nowMs: number, ttlMs: number) {
  if (!row?.report || !hasMeaningfulLeadResearch(row.report)) return false;
  if (!['completed', 'partial'].includes(getLeadResearchStatus(row.report))) return false;

  const timestamp = Date.parse(String(row.generated_at || row.report.createdAt || row.updated_at || ''));
  return Number.isFinite(timestamp) && nowMs - timestamp >= 0 && nowMs - timestamp <= ttlMs;
}

function createSupabaseLeadResearchReportsRepository(): LeadResearchReportsRepository {
  const supabase = getSupabaseAdminClient();
  const runLookup = async (scopeKey: string, column: 'lead_ref' | 'email', value: string) => {
    const { data, error } = await supabase
      .from('lead_research_reports')
      .select('report,generated_at,updated_at')
      .eq('scope_key', scopeKey)
      .eq(column, value)
      .gte('generated_at', new Date(Date.now() - getCacheTtlMs()).toISOString())
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as CachedLeadResearchRow | null;
  };

  return {
    findByLeadRef: (scopeKey, leadRef) => runLookup(scopeKey, 'lead_ref', leadRef),
    findByEmail: (scopeKey, email) => runLookup(scopeKey, 'email', email),
    async upsert(values) {
      const { error } = await supabase
        .from('lead_research_reports')
        .upsert(values, { onConflict: 'scope_key,lead_ref' });
      if (error) throw error;
    },
  };
}

export async function findCachedLeadResearchReport(
  input: LeadResearchCacheInput,
  options: {
    repository?: LeadResearchReportsRepository;
    nowMs?: number;
    ttlMs?: number;
  } = {},
): Promise<LeadResearchReport | null> {
  try {
    const repository = options.repository || createSupabaseLeadResearchReportsRepository();
    const scopeKey = getScopeKey(input.userId, input.organizationId);
    if (!scopeKey) return null;

    const leadRef = getLeadRef(input.lead);
    const email = String(input.lead.email || '').trim().toLowerCase();
    const nowMs = options.nowMs ?? Date.now();
    const ttlMs = options.ttlMs ?? getCacheTtlMs();

    if (leadRef) {
      const row = await repository.findByLeadRef(scopeKey, leadRef);
      if (isReusableCacheRow(row, nowMs, ttlMs)) return row!.report;
    }

    if (email) {
      const row = await repository.findByEmail(scopeKey, email);
      if (isReusableCacheRow(row, nowMs, ttlMs)) return row!.report;
    }
  } catch (error) {
    console.warn('[lead-research-reports] cache lookup failed:', error);
  }

  return null;
}

export async function storeLeadResearchReport(
  input: LeadResearchCacheInput & { report: LeadResearchReport },
  repository: LeadResearchReportsRepository = createSupabaseLeadResearchReportsRepository(),
) {
  try {
    const scopeKey = getScopeKey(input.userId, input.organizationId);
    const leadRef = getLeadRef(input.lead);
    const email = String(input.lead.email || '').trim().toLowerCase() || null;
    const companyDomain = getCompanyDomain(input.lead) || null;
    const companyName = String(input.lead.company || input.report.company?.name || '').trim() || null;
    const nowIso = new Date().toISOString();

    if (!leadRef) return false;

    await repository.upsert({
        scope_key: scopeKey,
        organization_id: input.organizationId || null,
        user_id: input.userId,
        lead_ref: leadRef,
        lead_id: input.lead.leadId || input.lead.id || null,
        email,
        company_domain: companyDomain,
        company_name: companyName,
        provider: String((input.report as any)?.raw?.provider || 'lead-research'),
        report: input.report,
        generated_at: input.report.createdAt || nowIso,
        updated_at: nowIso,
      });
    return true;
  } catch (error) {
    console.warn('[lead-research-reports] cache store failed:', error);
    return false;
  }
}

export function buildLeadResearchPayloadFromContactedLead(params: {
  lead: Partial<ContactedLead> & { id?: string; leadId?: string; companyDomain?: string };
  userId: string;
  sellerProfile?: SellerProfile | null;
}) {
  const { lead, userId, sellerProfile } = params;
  const extended = sellerProfile?.signatures?.profile_extended || {};
  const companyDomain = getCompanyDomain(lead);

  return {
    user_id: userId,
    use_social_context: true,
    lead_ref: getLeadRef(lead),
    lead: {
      id: lead.leadId || lead.id || null,
      full_name: lead.name || null,
      first_name: String(lead.name || '').split(' ')[0] || null,
      last_name: String(lead.name || '').split(' ').slice(1).join(' ') || null,
      title: lead.role || null,
      email: lead.email || null,
      linkedin_url: (lead as any).linkedinUrl || null,
      city: lead.city || null,
      country: lead.country || null,
    },
    company: {
      name: lead.company || null,
      domain: companyDomain || null,
      website_url: companyDomain ? `https://${companyDomain}` : null,
      industry: lead.industry || null,
    },
    seller_context: {
      company_name: sellerProfile?.company_name || sellerProfile?.full_name || 'Mi Empresa',
      company_domain: cleanDomain(sellerProfile?.company_domain),
      sector: extended?.sector || extended?.industry || extended?.market || null,
      description: extended?.description || null,
      services: Array.isArray(extended?.services) ? extended.services : [],
      value_proposition: extended?.valueProposition || extended?.value_proposition || null,
      proof_points: Array.isArray(extended?.proofPoints || extended?.proof_points)
        ? (extended?.proofPoints || extended?.proof_points)
        : [],
      target_market: Array.isArray(extended?.targetMarket || extended?.target_market)
        ? (extended?.targetMarket || extended?.target_market)
        : [],
    },
    user_context: {
      id: userId,
      name: sellerProfile?.full_name || null,
      job_title: sellerProfile?.job_title || null,
    },
    options: {
      use_social_context: true,
    },
  };
}

export async function ensureLeadResearchReport(params: LeadResearchCacheInput & { sellerProfile?: SellerProfile | null }) {
  return ensureLeadResearchReportWithDependencies(params);
}

function parseJson(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || 'INVALID_RESEARCH_RESPONSE' };
  }
}

export function getLeadResearchProviderStatus(payload: any, fallback = 'completed') {
  const normalized = unwrapLeadResearchResponse(payload);
  const status = String(normalized?.status || '').trim().toLowerCase();
  return status || fallback;
}

export function buildTerminalLeadResearchReport(payload: any, leadRef: string, fallbackStatus = 'completed') {
  const normalized = unwrapLeadResearchResponse(payload);
  const status = getLeadResearchProviderStatus(normalized, fallbackStatus);
  if (['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status)) return null;
  if (['failed', 'cancelled', 'insufficient_data'].includes(status)) return null;

  const terminalPayload = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? (() => {
      const {
        report: _reportEnvelope,
        message: _messageEnvelope,
        content: _contentEnvelope,
        index: _indexEnvelope,
        finish_reason: _finishReasonEnvelope,
        ...reportPayload
      } = normalized;
      return { ...reportPayload, status };
    })()
    : { status, result: normalized };
  const report = adaptLeadResearchResponseToReport(terminalPayload, leadRef);
  if (!hasMeaningfulLeadResearch(report)) return null;
  return {
    status,
    report,
  };
}

export async function ensureLeadResearchReportWithDependencies(
  params: LeadResearchCacheInput & { sellerProfile?: SellerProfile | null },
  dependencyOverrides: Partial<EnsureLeadResearchReportDependencies> = {},
) {
  const dependencies: EnsureLeadResearchReportDependencies = {
    findCached: findCachedLeadResearchReport,
    store: storeLeadResearchReport,
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    baseUrl: getInternalAppBaseUrl(),
    internalSecret: String(process.env.INTERNAL_API_SECRET || '').trim(),
    maxPollAttempts: 18,
    pollIntervalMs: 4000,
    ...dependencyOverrides,
  };
  const cached = await dependencies.findCached(params);
  if (cached) {
    return { report: cached, cacheHit: true, created: false, warning: null as string | null };
  }

  const baseUrl = dependencies.baseUrl.replace(/\/$/, '');
  if (!baseUrl) {
    return { report: null, cacheHit: false, created: false, warning: 'APP_URL_NOT_CONFIGURED' };
  }
  if (!dependencies.internalSecret) {
    return { report: null, cacheHit: false, created: false, warning: 'INTERNAL_API_SECRET_NOT_CONFIGURED' };
  }

    const payload = buildLeadResearchPayloadFromContactedLead({
    lead: params.lead,
    userId: params.userId,
    sellerProfile: params.sellerProfile,
  });
  if (!payload.lead_ref) {
    return { report: null, cacheHit: false, created: false, warning: 'LEAD_RESEARCH_LEAD_REF_REQUIRED' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-user-id': params.userId,
    'x-internal-api-secret': dependencies.internalSecret,
  };
  if (params.organizationId) headers['x-organization-id'] = params.organizationId;

  const res = await dependencies.fetch(`${baseUrl}/api/lead-research`, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify({
      ...payload,
    }),
  });

  const raw = await res.text();
  let parsed: any = parseJson(raw);

  if (!res.ok) {
    return {
      report: null,
      cacheHit: false,
      created: false,
      warning: String(parsed?.message || parsed?.error || `LEAD_RESEARCH_${res.status}`),
    };
  }

  let status = getLeadResearchProviderStatus(parsed);
  const reportId = String(unwrapLeadResearchResponse(parsed)?.report_id || '').trim();
  if (['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status)) {
    if (!reportId) {
      return { report: null, cacheHit: false, created: false, warning: 'LEAD_RESEARCH_REPORT_ID_MISSING' };
    }

    for (let attempt = 0; attempt < dependencies.maxPollAttempts; attempt++) {
      await dependencies.sleep(dependencies.pollIntervalMs);
      const pollRes = await dependencies.fetch(`${baseUrl}/api/lead-research/${encodeURIComponent(reportId)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-user-id': params.userId,
          'x-internal-api-secret': dependencies.internalSecret,
          ...(params.organizationId ? { 'x-organization-id': params.organizationId } : {}),
        },
        cache: 'no-store',
      });
      const polled = parseJson(await pollRes.text());
      if (!pollRes.ok) {
        return {
          report: null,
          cacheHit: false,
          created: false,
          warning: String(polled?.message || polled?.error || `LEAD_RESEARCH_POLL_${pollRes.status}`),
        };
      }

      parsed = polled;
      status = getLeadResearchProviderStatus(parsed);
      if (!['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status)) break;
    }
  }

  const terminal = buildTerminalLeadResearchReport(parsed, payload.lead_ref || getLeadRef(params.lead));
  if (!terminal) {
    const warning = status === 'cancelled'
      ? 'LEAD_RESEARCH_CANCELLED'
      : status === 'failed'
        ? 'LEAD_RESEARCH_FAILED'
        : status === 'insufficient_data' || !['queued', 'running', 'in_progress', 'pending', 'processing'].includes(status)
          ? 'LEAD_RESEARCH_INSUFFICIENT_DATA'
          : 'LEAD_RESEARCH_POLL_TIMEOUT';
    return { report: null, cacheHit: false, created: false, warning };
  }

  const report = terminal.report;
  const stored = await dependencies.store({ ...params, report });
  if (!stored) {
    return { report: null, cacheHit: false, created: false, warning: 'LEAD_RESEARCH_REPORT_PERSIST_FAILED' };
  }
  return { report, cacheHit: false, created: true, warning: null as string | null };
}

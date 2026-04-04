import { adaptLeadResearchResponseToReport } from '@/lib/lead-research';
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
    `${lead.name || ''}|${lead.company || ''}`
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
  return organizationId || `user:${userId}`;
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

export async function findCachedLeadResearchReport(input: LeadResearchCacheInput): Promise<LeadResearchReport | null> {
  try {
    const supabase = getSupabaseAdminClient();
    const scopeKey = getScopeKey(input.userId, input.organizationId);
    const leadRef = getLeadRef(input.lead);
    const email = String(input.lead.email || '').trim().toLowerCase();
    const companyDomain = getCompanyDomain(input.lead);

    const candidates: Array<() => any> = [];

    if (leadRef) {
      candidates.push(() => supabase
        .from('lead_research_reports')
        .select('report')
        .eq('scope_key', scopeKey)
        .eq('lead_ref', leadRef)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (email) {
      candidates.push(() => supabase
        .from('lead_research_reports')
        .select('report')
        .eq('scope_key', scopeKey)
        .eq('email', email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (companyDomain) {
      candidates.push(() => supabase
        .from('lead_research_reports')
        .select('report')
        .eq('scope_key', scopeKey)
        .eq('company_domain', companyDomain)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    for (const run of candidates) {
      const { data } = await run();
      if (data?.report) return data.report as LeadResearchReport;
    }
  } catch (error) {
    console.warn('[lead-research-reports] cache lookup failed:', error);
  }

  return null;
}

export async function storeLeadResearchReport(input: LeadResearchCacheInput & { report: LeadResearchReport }) {
  try {
    const supabase = getSupabaseAdminClient();
    const scopeKey = getScopeKey(input.userId, input.organizationId);
    const leadRef = getLeadRef(input.lead);
    const email = String(input.lead.email || '').trim().toLowerCase() || null;
    const companyDomain = getCompanyDomain(input.lead) || null;
    const companyName = String(input.lead.company || input.report.company?.name || '').trim() || null;
    const nowIso = new Date().toISOString();

    if (!leadRef) return;

    await supabase
      .from('lead_research_reports')
      .upsert({
        scope_key: scopeKey,
        organization_id: input.organizationId || null,
        user_id: input.userId,
        lead_ref: leadRef,
        lead_id: input.lead.leadId || input.lead.id || null,
        email,
        company_domain: companyDomain,
        company_name: companyName,
        provider: 'n8n',
        report: input.report,
        generated_at: input.report.createdAt || nowIso,
        updated_at: nowIso,
      }, { onConflict: 'scope_key,lead_ref' });
  } catch (error) {
    console.warn('[lead-research-reports] cache store failed:', error);
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
  };
}

export async function ensureLeadResearchReport(params: LeadResearchCacheInput & { sellerProfile?: SellerProfile | null }) {
  const cached = await findCachedLeadResearchReport(params);
  if (cached) {
    return { report: cached, cacheHit: true, created: false, warning: null as string | null };
  }

  const baseUrl = getInternalAppBaseUrl();
  if (!baseUrl) {
    return { report: null, cacheHit: false, created: false, warning: 'APP_URL_NOT_CONFIGURED' };
  }

  const payload = buildLeadResearchPayloadFromContactedLead({
    lead: params.lead,
    userId: params.userId,
    sellerProfile: params.sellerProfile,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-user-id': params.userId,
  };
  const internalSecret = String(process.env.INTERNAL_API_SECRET || '').trim();
  if (internalSecret) headers['x-internal-api-secret'] = internalSecret;

  const res = await fetch(`${baseUrl}/api/lead-research`, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify({
      ...payload,
      organization_id: params.organizationId || null,
    }),
  });

  const raw = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { error: raw || 'INVALID_RESEARCH_RESPONSE' };
  }

  if (!res.ok) {
    return {
      report: null,
      cacheHit: false,
      created: false,
      warning: String(parsed?.message || parsed?.error || `LEAD_RESEARCH_${res.status}`),
    };
  }

  const report = adaptLeadResearchResponseToReport(parsed, payload.lead_ref || getLeadRef(params.lead));
  await storeLeadResearchReport({ ...params, report });
  return { report, cacheHit: false, created: true, warning: null as string | null };
}

import type { CrossReport, EnhancedReport, EnrichedLead, LeadResearchReport } from '@/lib/types';

type SellerProfile = {
  company_name?: string | null;
  company_domain?: string | null;
  full_name?: string | null;
  job_title?: string | null;
  signatures?: any;
};

function cleanDomain(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value: any) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [] as string[];
}

function firstNonEmpty(...values: Array<any>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mapSource(source: any) {
  if (!source?.url) return null;
  return {
    title: source.title || source.name || undefined,
    url: source.url,
  };
}

function buildSourcesById(sources: any[]) {
  const byId = new Map<string, any>();
  for (const source of sources) {
    const id = String(source?.id || '').trim();
    if (id) byId.set(id, source);
  }
  return byId;
}

function resolveSources(sourceIds: any, sourcesById: Map<string, any>) {
  const ids = asArray(sourceIds).map((value) => String(value || '').trim()).filter(Boolean);
  return ids
    .map((id) => sourcesById.get(id))
    .filter(Boolean)
    .map(mapSource)
    .filter(Boolean) as Array<{ title?: string; url: string }>;
}

function buildCrossReport(response: any, sourcesById: Map<string, any>): CrossReport {
  const existing = response?.existing_compat?.cross || response?.cross;
  if (existing) {
    return {
      ...existing,
      sources: asArray(existing.sources).map(mapSource).filter(Boolean),
    } as CrossReport;
  }

  const leadContext = response?.lead_context || {};
  const companyContext = response?.company_context || {};
  const websiteSummary = response?.website_summary || {};
  const outreachPack = response?.outreach_pack || {};
  const buyerIntelligence = response?.buyer_intelligence || {};
  const firstIceBreaker = asArray(leadContext.ice_breakers)[0]?.text || null;
  const emailDrafts = outreachPack.email_drafts || {};
  const preferredDraft = emailDrafts.medium || emailDrafts.short || emailDrafts.challenger || null;

  return {
    company: {
      name: firstNonEmpty(response?.company?.name, response?.company_name) || 'Empresa',
      domain: firstNonEmpty(response?.company?.domain, response?.company?.primary_domain),
      linkedin: firstNonEmpty(response?.company?.linkedin_url, response?.company?.linkedin),
      industry: firstNonEmpty(response?.company?.industry),
      country: firstNonEmpty(response?.company?.country),
      website: firstNonEmpty(response?.company?.website_url, websiteSummary?.website),
    },
    overview: firstNonEmpty(companyContext.overview, websiteSummary.overview) || '',
    pains: asArray(companyContext.pain_hypotheses).map((item) => item?.detail || item?.title).filter(Boolean),
    opportunities: asArray(companyContext.opportunity_hypotheses).map((item) => item?.detail || item?.title).filter(Boolean),
    risks: asArray(companyContext.risks).map((item) => item?.detail || item?.title).filter(Boolean),
    valueProps: asArray(buyerIntelligence.fit_reasons).filter(Boolean),
    useCases: asArray(companyContext.likely_priorities).filter(Boolean),
    talkTracks: asArray(outreachPack.talk_tracks).filter(Boolean),
    subjectLines: asArray(outreachPack.subject_lines).filter(Boolean),
    emailDraft: {
      subject: preferredDraft?.subject || '',
      body: preferredDraft?.body || '',
    },
    sources: asArray(response?.sources).map(mapSource).filter(Boolean) as Array<{ title?: string; url: string }>,
    leadContext: {
      iceBreaker: firstIceBreaker,
      recentActivitySummary: leadContext.recent_activity_summary || null,
      foundRecentActivity: Boolean(leadContext.found_recent_activity || asArray(response?.signals).length > 0),
      profileSummary: leadContext.profile_summary || leadContext.role_summary || undefined,
    },
  };
}

function buildEnhancedReport(response: any): EnhancedReport | undefined {
  const existing = response?.existing_compat?.enhanced || response?.enhanced;
  if (existing) return existing as EnhancedReport;

  const cross = buildCrossReport(response, buildSourcesById(asArray(response?.sources)));
  if (!cross.overview && !cross.pains.length && !cross.opportunities.length) {
    return undefined;
  }

  return {
    overview: cross.overview,
    pains: cross.pains,
    opportunities: cross.opportunities,
    risks: cross.risks,
    valueProps: cross.valueProps,
    useCases: cross.useCases,
    suggestedContacts: asArray(response?.company_context?.likely_priorities).filter(Boolean),
    talkTracks: cross.talkTracks,
    subjectLines: cross.subjectLines,
    emailDraft: cross.emailDraft,
  };
}

export function buildLeadResearchPayloadFromLead(params: {
  lead: EnrichedLead;
  userId: string;
  userName?: string | null;
  userJobTitle?: string | null;
  sellerProfile?: SellerProfile | null;
}) {
  const { lead, userId, userName, userJobTitle, sellerProfile } = params;
  const extended = sellerProfile?.signatures?.profile_extended || {};
  const companyDomain = cleanDomain(lead.companyDomain || lead.organizationDomain || sellerProfile?.company_domain || undefined);

  return {
    user_id: userId,
    lead_ref: lead.id || lead.email || lead.linkedinUrl || `${lead.fullName}|${lead.companyName || ''}`,
    lead: {
      id: lead.id,
      apollo_id: lead.apolloId,
      full_name: lead.fullName,
      first_name: lead.fullName?.split(' ')[0] || undefined,
      last_name: lead.fullName?.split(' ').slice(1).join(' ') || undefined,
      title: lead.title,
      headline: lead.headline,
      email: lead.email,
      phone: lead.primaryPhone,
      linkedin_url: lead.linkedinUrl,
      location: [lead.city, lead.country].filter(Boolean).join(', ') || undefined,
      city: lead.city,
      country: lead.country,
      seniority: lead.seniority,
      department: lead.departments?.[0],
    },
    company: {
      name: lead.companyName,
      domain: companyDomain,
      website_url: companyDomain ? `https://${companyDomain}` : undefined,
      linkedin_url: (lead as any).companyLinkedinUrl || undefined,
      industry: lead.organizationIndustry || lead.industry,
      size: lead.organizationSize,
    },
    seller_context: {
      company_name: sellerProfile?.company_name || sellerProfile?.full_name || 'Mi Empresa',
      company_domain: cleanDomain(sellerProfile?.company_domain),
      sector: firstNonEmpty(extended.sector, extended.industry, extended.market),
      description: firstNonEmpty(extended.description),
      services: normalizeStringArray(extended.services),
      value_proposition: firstNonEmpty(extended.valueProposition, extended.value_proposition),
      proof_points: normalizeStringArray(extended.proofPoints || extended.proof_points),
      target_market: normalizeStringArray(extended.targetMarket || extended.target_market),
    },
    user_context: {
      id: userId,
      name: userName || sellerProfile?.full_name || null,
      job_title: userJobTitle || sellerProfile?.job_title || null,
    },
    options: {
      language: 'es',
      depth: 'standard',
      include_outreach_pack: true,
      include_company_research: true,
      include_lead_research: true,
      include_recent_signals: true,
      include_call_prep: true,
      include_competitive_context: true,
      include_raw_sources: true,
      max_sources: 15,
      force_refresh: true,
    },
  };
}

export function adaptLeadResearchResponseToReport(response: any, leadRef: string): LeadResearchReport {
  const sources = asArray(response?.sources);
  const sourcesById = buildSourcesById(sources);
  const cross = buildCrossReport(response, sourcesById);
  const enhanced = buildEnhancedReport(response);
  const websiteSources = resolveSources(response?.website_summary?.source_ids, sourcesById);

  return {
    id: response?.report_id || `${leadRef}:${Date.now()}`,
    company: {
      name: firstNonEmpty(response?.company?.name, cross.company.name) || 'Empresa',
      domain: firstNonEmpty(response?.company?.domain, cross.company.domain),
      linkedin: firstNonEmpty(response?.company?.linkedin_url, cross.company.linkedin),
      industry: firstNonEmpty(response?.company?.industry, cross.company.industry),
      country: firstNonEmpty(response?.company?.country, cross.company.country),
      website: firstNonEmpty(response?.company?.website_url, cross.company.website),
      size: response?.company?.size,
    },
    websiteSummary: {
      overview: response?.website_summary?.overview || cross.overview,
      services: asArray(response?.website_summary?.services).filter(Boolean),
      sources: websiteSources.length > 0 ? websiteSources : asArray(cross.sources).slice(0, 3),
    },
    signals: asArray(response?.signals).map((signal) => ({
      type: (['news', 'hiring', 'tech', 'site'].includes(signal?.type) ? signal.type : 'site') as 'news' | 'hiring' | 'tech' | 'site',
      title: signal?.title || 'Signal',
      url: signal?.url || undefined,
      when: signal?.published_at || signal?.when || undefined,
    })),
    createdAt: response?.generated_at || new Date().toISOString(),
    cross,
    enhanced,
    raw: response,
    meta: { leadRef },
  };
}

export function hasMeaningfulLeadResearch(report: LeadResearchReport | null | undefined) {
  if (!report) return false;
  return Boolean(
    report.cross?.overview ||
    report.cross?.pains?.length ||
    report.cross?.opportunities?.length ||
    report.cross?.talkTracks?.length ||
    report.signals?.length ||
    report.websiteSummary?.overview
  );
}

export function getLeadResearchWarnings(response: any) {
  return asArray(response?.warnings).filter(Boolean);
}

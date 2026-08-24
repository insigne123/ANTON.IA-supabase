import type { CrossReport, EnhancedReport, EnrichedLead, LeadResearchReport } from '@/lib/types';
import { extractJsonFromMaybeFencedDetailed } from '@/lib/extract-json';
import {
  buildResearchRequestIdempotencyKeyV1,
  getResearchAutoContactBlockReasonV1,
  hasMeaningfulResearchContentV1,
} from '@/lib/research-contracts';

const TRUNCATED_RESEARCH_WARNING = 'La respuesta del proveedor llego truncada. Se recuperaron las secciones completas disponibles; revisa el contenido antes de usarlo.';

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

export function unwrapLeadResearchResponse(response: any) {
  const nested = response?.report;
  const merged = nested && typeof nested === 'object'
    ? {
      ...(response && typeof response === 'object' && !Array.isArray(response) ? response : {}),
      ...nested,
    }
    : response;

  const envelope = Array.isArray(merged)
    ? merged.find((item) => item?.message?.content || item?.content) || null
    : merged?.message?.content || merged?.content
      ? merged
      : Array.isArray(response)
        ? response.find((item) => item?.message?.content || item?.content) || null
        : response?.message?.content || response?.content
          ? response
          : null;

  if (envelope) {
    const extracted = extractJsonFromMaybeFencedDetailed(envelope?.message?.content || envelope?.content);
    const parsed = extracted?.value;
    if (parsed && typeof parsed === 'object') {
      const annotationSources = asArray(envelope?.message?.annotations || envelope?.annotations)
        .map((annotation) => {
          const citation = annotation?.url_citation;
          if (!citation?.url) return null;
          return {
            title: citation.title || undefined,
            url: citation.url,
          };
        })
        .filter(Boolean);

      const mergedSources = [
        ...asArray((parsed as any)?.sources),
        ...annotationSources,
      ].reduce<Array<{ title?: string; url: string }>>((acc, source) => {
        const mapped = source?.url
          ? { title: source.title || source.name || undefined, url: source.url }
          : null;
        if (!mapped?.url) return acc;

        const exists = acc.some((item) => item.url.trim().toLowerCase() === mapped.url.trim().toLowerCase());
        if (!exists) acc.push(mapped);
        return acc;
      }, []);
      const warnings = normalizeStringArray((parsed as any)?.warnings);
      if (extracted?.recovered && !warnings.includes(TRUNCATED_RESEARCH_WARNING)) {
        warnings.push(TRUNCATED_RESEARCH_WARNING);
      }

      return {
        ...(merged && typeof merged === 'object' && !Array.isArray(merged) ? merged : {}),
        ...parsed,
        ...(extracted?.recovered ? { status: 'partial', response_truncated: true } : {}),
        sources: mergedSources,
        warnings,
        annotations: envelope?.message?.annotations || envelope?.annotations || [],
      };
    }
  }

  return merged;
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

function normalizeDirectLeadContext(value: any) {
  if (!value || typeof value !== 'object') return undefined;

  const profileSummary = firstNonEmpty(value.profileSummary, value.profile_summary, value.role_summary);
  const recentActivitySummary = firstNonEmpty(value.recentActivitySummary, value.recent_activity_summary);
  const iceBreaker = firstNonEmpty(value.iceBreaker, value.ice_breaker);
  const communicationStyle = firstNonEmpty(value.communicationStyle, value.communication_style);
  const foundRecentActivity = typeof value.foundRecentActivity === 'boolean'
    ? value.foundRecentActivity
    : typeof value.found_recent_activity === 'boolean'
      ? value.found_recent_activity
      : Boolean(recentActivitySummary);

  if (!profileSummary && !recentActivitySummary && !iceBreaker && !communicationStyle && !foundRecentActivity) {
    return undefined;
  }

  return {
    iceBreaker: iceBreaker || null,
    recentActivitySummary: recentActivitySummary || null,
    foundRecentActivity,
    profileSummary: profileSummary || undefined,
    communicationStyle: communicationStyle || null,
  };
}

function normalizeConfidenceMap(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entries = Object.entries(value)
    .map(([key, score]) => [key, Number(score)] as const)
    .filter(([, score]) => Number.isFinite(score));

  return entries.length > 0 ? Object.fromEntries(entries) as Record<string, number> : undefined;
}

function normalizeNextSteps(value: any) {
  const items = asArray(value)
    .map((item) => {
      if (typeof item === 'string') {
        return { action: item.trim(), why: undefined, priority: undefined };
      }

      const action = firstNonEmpty(item?.action, item?.title);
      if (!action) return null;

      return {
        action,
        why: firstNonEmpty(item?.why, item?.reason),
        priority: firstNonEmpty(item?.priority),
      };
    })
    .filter(Boolean) as Array<{ action: string; why?: string; priority?: string }>;

  return items.length > 0 ? items : undefined;
}

function isDirectCrossPayload(response: any) {
  return Boolean(
    response &&
    typeof response === 'object' &&
    !Array.isArray(response) &&
    response.company &&
    (
      typeof response.overview === 'string' ||
      Array.isArray(response.pains) ||
      Array.isArray(response.opportunities) ||
      Array.isArray(response.risks) ||
      Array.isArray(response.valueProps) ||
      Array.isArray(response.useCases) ||
      Array.isArray(response.talkTracks) ||
      Array.isArray(response.subjectLines) ||
      response.emailDraft ||
      Array.isArray(response.nextSteps)
    )
  );
}

function buildCrossReport(response: any, sourcesById: Map<string, any>): CrossReport {
  const existing = response?.existing_compat?.cross || response?.cross;
  if (existing) {
    return {
      ...existing,
      sources: asArray(existing.sources).map(mapSource).filter(Boolean),
    } as CrossReport;
  }

  if (isDirectCrossPayload(response)) {
    return {
      company: {
        name: firstNonEmpty(response?.company?.name) || 'Empresa',
        domain: firstNonEmpty(response?.company?.domain, response?.company?.primary_domain),
        linkedin: firstNonEmpty(response?.company?.linkedin, response?.company?.linkedin_url),
        industry: firstNonEmpty(response?.company?.industry),
        country: firstNonEmpty(response?.company?.country),
        website: firstNonEmpty(response?.company?.website, response?.company?.website_url),
      },
      overview: firstNonEmpty(response?.overview) || '',
      pains: normalizeStringArray(response?.pains),
      opportunities: normalizeStringArray(response?.opportunities),
      risks: normalizeStringArray(response?.risks),
      valueProps: normalizeStringArray(response?.valueProps),
      useCases: normalizeStringArray(response?.useCases),
      talkTracks: normalizeStringArray(response?.talkTracks),
      subjectLines: normalizeStringArray(response?.subjectLines),
      emailDraft: {
        subject: firstNonEmpty(response?.emailDraft?.subject, response?.email_draft?.subject) || '',
        body: firstNonEmpty(response?.emailDraft?.body, response?.email_draft?.body) || '',
      },
      sources: asArray(response?.sources).map(mapSource).filter(Boolean) as Array<{ title?: string; url: string }>,
      leadContext: normalizeDirectLeadContext(response?.leadContext || response?.lead_context),
      contradictions: normalizeStringArray(response?.contradictions),
      confidence: normalizeConfidenceMap(response?.confidence),
      nextSteps: normalizeNextSteps(response?.nextSteps || response?.next_steps),
    };
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
      communicationStyle: firstNonEmpty(leadContext.communication_style, leadContext.communicationStyle) || null,
    },
    contradictions: normalizeStringArray(response?.contradictions),
    confidence: normalizeConfidenceMap(response?.confidence),
    nextSteps: normalizeNextSteps(response?.next_steps),
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
  freshnessBucket?: string | number;
  jobIdentity?: string | null;
}) {
  const { lead, userId, userName, userJobTitle, sellerProfile } = params;
  const extended = sellerProfile?.signatures?.profile_extended || {};
  const companyDomain = cleanDomain(lead.companyDomain || lead.organizationDomain || undefined);
  const leadRef = lead.id || lead.email || lead.linkedinUrl || undefined;
  const freshnessBucket = params.freshnessBucket ?? Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const idempotencyKey = buildResearchRequestIdempotencyKeyV1({
    ownerId: userId,
    leadRef,
    email: lead.email,
    companyDomain,
    provider: 'lead-research',
    freshnessBucket,
    jobIdentity: params.jobIdentity,
  });

  return {
    user_id: userId,
    idempotency_key: idempotencyKey,
    use_social_context: true,
    lead_ref: leadRef,
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
      use_social_context: true,
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
  const normalizedResponse = unwrapLeadResearchResponse(response);
  const sources = asArray(normalizedResponse?.sources);
  const sourcesById = buildSourcesById(sources);
  const cross = buildCrossReport(normalizedResponse, sourcesById);
  const enhanced = buildEnhancedReport(normalizedResponse);
  const websiteSources = resolveSources(normalizedResponse?.website_summary?.source_ids, sourcesById);

  return {
    id: normalizedResponse?.report_id || `${leadRef}:${Date.now()}`,
    company: {
      name: firstNonEmpty(normalizedResponse?.company?.name, cross.company.name) || 'Empresa',
      domain: firstNonEmpty(normalizedResponse?.company?.domain, cross.company.domain),
      linkedin: firstNonEmpty(normalizedResponse?.company?.linkedin_url, normalizedResponse?.company?.linkedin, cross.company.linkedin),
      industry: firstNonEmpty(normalizedResponse?.company?.industry, cross.company.industry),
      country: firstNonEmpty(normalizedResponse?.company?.country, cross.company.country),
      website: firstNonEmpty(normalizedResponse?.company?.website_url, normalizedResponse?.company?.website, cross.company.website),
      size: normalizedResponse?.company?.size,
    },
    websiteSummary: {
      overview: normalizedResponse?.website_summary?.overview || cross.overview,
      services: asArray(normalizedResponse?.website_summary?.services).filter(Boolean),
      sources: websiteSources.length > 0 ? websiteSources : asArray(cross.sources).slice(0, 3),
    },
    signals: asArray(normalizedResponse?.signals).map((signal) => ({
      type: (['news', 'hiring', 'tech', 'site'].includes(signal?.type) ? signal.type : 'site') as 'news' | 'hiring' | 'tech' | 'site',
      title: signal?.title || 'Signal',
      url: signal?.url || undefined,
      when: signal?.published_at || signal?.when || undefined,
    })),
    createdAt: normalizedResponse?.generated_at || new Date().toISOString(),
    cross,
    enhanced,
    raw: normalizedResponse,
    meta: { leadRef },
  };
}

export function hasMeaningfulLeadResearch(report: LeadResearchReport | null | undefined) {
  return hasMeaningfulResearchContentV1(report);
}

export function getLeadResearchStatus(report: LeadResearchReport | null | undefined) {
  const rawStatus = String(report?.raw?.status || '').trim().toLowerCase();
  if (rawStatus) return rawStatus;
  return hasMeaningfulLeadResearch(report) ? 'completed' : 'missing';
}

export function isLeadResearchReadyForAutoContact(report: LeadResearchReport | null | undefined) {
  return getLeadResearchAutoContactBlockReason(report) === 'ready';
}

export function getLeadResearchAutoContactBlockReason(report: LeadResearchReport | null | undefined, warning?: string | null) {
  if (warning) return String(warning).trim().toLowerCase() || 'research_warning';
  return getResearchAutoContactBlockReasonV1(report) || 'ready';
}

export function getLeadResearchWarnings(response: any) {
  const normalizedResponse = unwrapLeadResearchResponse(response);
  return asArray(normalizedResponse?.warnings).filter(Boolean);
}

import type { LeadSearchResult } from '@/lib/types';
import * as San from '@/lib/input-sanitize';
import { requestFullEnrichSearch } from '@/lib/server/fullenrich-search-client';
import { resolveLeadProvider } from '@/lib/server/provider-routing';

export type SupliaProspectingProvider = 'fullenrich';

export type SearchCompaniesInput = {
  organizationId: string;
  companyName: string;
  perPage?: number;
  page?: number;
  provider?: unknown;
};

export type SearchPeopleInput = {
  organizationId: string;
  personTitles?: string[];
  domains?: string[];
  companyNames?: string[];
  personLocations?: string[];
  perPage?: number;
  maxPages?: number;
  onlyVerifiedEmails?: boolean;
  similarTitles?: boolean;
  dedupe?: 'smart' | 'id' | 'email' | 'none';
  includeLockedEmails?: boolean;
  provider?: unknown;
};

function list(value: unknown, max = 20) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max);
  }
  const text = String(value || '').trim();
  return text ? text.split(/[;,]/g).map((item) => item.trim()).filter(Boolean).slice(0, max) : [];
}

function cleanDomain(value: unknown) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function mapLead(raw: any): LeadSearchResult {
  const organization = raw?.organization && typeof raw.organization === 'object' ? raw.organization : {};
  const sourceProviderId = String(raw?.source_provider_id || raw?.id || '').trim() || undefined;
  return {
    id: sourceProviderId,
    fullName: String(raw?.name || raw?.full_name || '').trim(),
    title: String(raw?.title || raw?.headline || '').trim(),
    linkedinUrl: String(raw?.linkedin_url || '').trim() || undefined,
    location: [raw?.city, raw?.state, raw?.country].map((item) => String(item || '').trim()).filter(Boolean).join(', ') || undefined,
    companyName: String(raw?.organization_name || organization?.name || '').trim() || undefined,
    companyDomain: cleanDomain(raw?.organization_domain || organization?.domain) || undefined,
    sourceProvider: 'fullenrich',
    sourceProviderId,
  };
}

function dedupeLeads(leads: LeadSearchResult[], strategy: SearchPeopleInput['dedupe']) {
  if (strategy === 'none') return leads;
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const key = String(lead.sourceProviderId || lead.id || lead.linkedinUrl || `${lead.fullName}|${lead.companyDomain || lead.companyName}|${lead.title}`).toLowerCase();
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
}

async function companySearch(companyName: string, maxResults: number, filters: Record<string, unknown> = {}) {
  let result = await requestFullEnrichSearch({
    search_mode: 'company_name',
    company_name: companyName,
    max_results: maxResults,
    ...filters,
  });
  const candidates = Array.isArray(result.organization_candidates) ? result.organization_candidates : [];
  if (result.requires_organization_selection && candidates[0]) {
    result = await requestFullEnrichSearch({
      search_mode: 'company_name',
      company_name: companyName,
      max_results: maxResults,
      selected_organization_id: candidates[0].id,
      selected_organization_name: candidates[0].name,
      ...filters,
    });
  }
  return result;
}

export async function searchProspectingCompanies(input: SearchCompaniesInput) {
  const companyName = San.sanitizeName(input.companyName);
  if (!companyName) throw new Error('companyName requerido');
  const providerDecision = resolveLeadProvider({ requestedProvider: input.provider, organizationId: input.organizationId });
  const result = await companySearch(companyName, 1);
  const rawCandidates = Array.isArray(result.organization_candidates)
    ? result.organization_candidates
    : result.selected_organization ? [result.selected_organization] : [];

  return {
    candidates: rawCandidates.slice(0, Math.max(1, Math.min(25, Number(input.perPage || 8)))).map((candidate: any) => ({
      id: candidate.id,
      name: candidate.name,
      website_url: candidate.website_url,
      linkedin_url: candidate.linkedin_url,
      primary_domain: candidate.primary_domain,
      logo: candidate.primary_domain ? `https://logo.clearbit.com/${candidate.primary_domain}` : undefined,
      score: candidate.match_score,
    })),
    providerRequested: providerDecision.requestedProvider,
    providerUsed: providerDecision.provider,
    providerDefault: providerDecision.defaultProvider,
    fallbackApplied: false,
    providerForcedReason: providerDecision.forcedProviderReason,
  };
}

export async function searchProspectingPeople(input: SearchPeopleInput) {
  const providerDecision = resolveLeadProvider({ requestedProvider: input.provider, organizationId: input.organizationId });
  const domains = list(input.domains).map(cleanDomain).filter(Boolean);
  const companyNames = list(input.companyNames, 5);
  const maxResults = Math.max(1, Math.min(100, Number(input.perPage || 25) * Number(input.maxPages || 1)));
  const filters = {
    titles: list(input.personTitles).map(San.sanitizeTitle).filter(Boolean),
    person_locations: list(input.personLocations).map(San.sanitizeLocation).filter(Boolean),
    include_similar_titles: input.similarTitles !== false,
  };
  const results = [];
  if (domains.length > 0) {
    results.push(await requestFullEnrichSearch({
      search_mode: 'batch',
      organization_domains: domains,
      max_results: maxResults,
      ...filters,
    }));
  } else {
    for (const companyName of companyNames) results.push(await companySearch(companyName, maxResults, filters));
  }

  const all = results.flatMap((result) => Array.isArray(result.leads) ? result.leads.map(mapLead) : []);
  const leads = dedupeLeads(all, input.dedupe || 'smart');
  return {
    leads,
    total: all.length,
    returned: leads.length,
    domains,
    providerRequested: providerDecision.requestedProvider,
    providerUsed: providerDecision.provider,
    providerDefault: providerDecision.defaultProvider,
    fallbackApplied: false,
    providerForcedReason: providerDecision.forcedProviderReason,
  };
}

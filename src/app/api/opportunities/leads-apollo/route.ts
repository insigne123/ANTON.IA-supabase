import { NextRequest, NextResponse } from 'next/server';

import type { LeadSearchResult } from '@/lib/types';
import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { requestFullEnrichSearch, FullEnrichSearchClientError } from '@/lib/server/fullenrich-search-client';
import { resolveLeadProvider } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
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

type SearchResult = {
  leads: LeadSearchResult[];
  total: number;
  returned: number;
  domains: string[];
};

function list(value: unknown, max = 20) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max)
    : [];
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
  const city = String(raw?.city || '').trim();
  const state = String(raw?.state || '').trim();
  const country = String(raw?.country || '').trim();
  return {
    id: sourceProviderId,
    fullName: String(raw?.name || raw?.full_name || '').trim(),
    title: String(raw?.title || raw?.headline || '').trim(),
    linkedinUrl: String(raw?.linkedin_url || '').trim() || undefined,
    location: [city, state, country].filter(Boolean).join(', ') || undefined,
    companyName: String(raw?.organization_name || organization?.name || '').trim() || undefined,
    companyDomain: cleanDomain(raw?.organization_domain || organization?.domain || organization?.primary_domain) || undefined,
    sourceProvider: String(raw?.source_provider || 'fullenrich'),
    sourceProviderId,
  };
}

function dedupe(leads: LeadSearchResult[], strategy: Body['dedupe']) {
  if (strategy === 'none') return leads;
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const key = strategy === 'email'
      ? ''
      : String(lead.id || lead.linkedinUrl || `${lead.fullName}|${lead.companyDomain || lead.companyName}|${lead.title}`).toLowerCase();
    if (!key || seen.has(key)) return !key;
    seen.add(key);
    return true;
  });
}

async function searchCompanyName(companyName: string, input: Record<string, unknown>) {
  let result = await requestFullEnrichSearch({
    ...input,
    search_mode: 'company_name',
    company_name: companyName,
  });
  const candidates = Array.isArray(result.organization_candidates) ? result.organization_candidates : [];
  if (result.requires_organization_selection && candidates[0]) {
    const selected = candidates[0];
    result = await requestFullEnrichSearch({
      ...input,
      search_mode: 'company_name',
      company_name: companyName,
      selected_organization_id: selected.id,
      selected_organization_name: selected.name,
      selected_organization_domain: selected.primary_domain,
    });
  }
  return result;
}

async function searchLeads(body: Body): Promise<SearchResult> {
  const domains = list(body.domains).map(cleanDomain).filter(Boolean);
  const companyNames = list(body.companyNames, 5);
  const maxResults = Math.max(1, Math.min(100, Number(body.perPage || 50) * Number(body.maxPages || 1)));
  const input = {
    titles: list(body.personTitles),
    person_locations: list(body.personLocations),
    include_similar_titles: body.similarTitles !== false,
    max_results: maxResults,
  };
  const results: any[] = [];

  if (domains.length > 0) {
    results.push(await requestFullEnrichSearch({
      ...input,
      search_mode: 'batch',
      organization_domains: domains,
    }));
  } else {
    for (const companyName of companyNames) {
      results.push(await searchCompanyName(companyName, input));
    }
  }

  const leads = dedupe(results.flatMap((result) => Array.isArray(result?.leads) ? result.leads.map(mapLead) : []), body.dedupe || 'smart');
  return {
    leads,
    total: leads.length,
    returned: leads.length,
    domains,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const body = await request.json() as Body;
    const providerDecision = resolveLeadProvider({
      requestedProvider: body.provider,
      organizationId,
    });
    const result = await searchLeads(body);
    const response = NextResponse.json({
      ...result,
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedProviderReason,
      fallbackApplied: false,
    });
    response.headers.set('x-provider-used', 'fullenrich');
    return response;
  } catch (error: any) {
    const authResponse = handleAuthError(error);
    if (authResponse.status !== 500 || error?.name === 'AuthError') return authResponse;
    if (error instanceof FullEnrichSearchClientError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'FULLENRICH_SEARCH_FAILED' }, { status: 500 });
  }
}

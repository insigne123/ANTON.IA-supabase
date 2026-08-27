import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { requestFullEnrichSearch, FullEnrichSearchClientError } from '@/lib/server/fullenrich-search-client';
import { resolveLeadProvider } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  companyName?: string;
  perPage?: number;
  provider?: unknown;
};

function asCandidate(value: any, fallbackName: string) {
  const domain = String(value?.primary_domain || value?.domain || '').trim().toLowerCase() || undefined;
  const name = String(value?.name || fallbackName).trim();
  if (!name) return null;
  return {
    id: String(value?.id || domain || name).trim(),
    name,
    website_url: String(value?.website_url || (domain ? `https://${domain}` : '')).trim() || undefined,
    linkedin_url: String(value?.linkedin_url || '').trim() || undefined,
    primary_domain: domain,
    logo: domain ? `https://logo.clearbit.com/${domain}` : undefined,
    score: typeof value?.match_score === 'number' ? value.match_score : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { organizationId } = await requireAuth();
    const body = await request.json() as Body;
    const companyName = String(body.companyName || '').trim();
    if (!companyName) return NextResponse.json({ error: 'COMPANY_NAME_REQUIRED' }, { status: 400 });

    const providerDecision = resolveLeadProvider({
      requestedProvider: body.provider,
      organizationId,
    });
    const result = await requestFullEnrichSearch({
      search_mode: 'company_name',
      company_name: companyName,
      max_results: 1,
    });
    const rawCandidates = Array.isArray(result.organization_candidates)
      ? result.organization_candidates
      : result.selected_organization
        ? [result.selected_organization]
        : [];
    const candidates = rawCandidates
      .slice(0, Math.max(1, Math.min(25, Number(body.perPage || 8))))
      .map((candidate: any) => asCandidate(candidate, companyName))
      .filter(Boolean);

    const response = NextResponse.json({
      candidates,
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
    return NextResponse.json({ error: 'FULLENRICH_COMPANY_SEARCH_FAILED' }, { status: 500 });
  }
}

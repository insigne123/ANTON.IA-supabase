import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { ApolloSearchClientError, requestApolloSearch } from '@/lib/server/apollo-search-client';
import { resolveLeadProvider } from '@/lib/server/provider-routing';
import { consumeLeadSearchQuota, type DailyQuotaResult } from '@/lib/server/daily-quota-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Body = {
  companyName?: string;
  perPage?: number;
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
    const { user, organizationId } = await requireAuth();
    const body = await request.json() as Body;
    const companyName = String(body.companyName || '').trim();
    if (!companyName) return NextResponse.json({ error: 'COMPANY_NAME_REQUIRED' }, { status: 400 });

    const quota = await consumeLeadSearchQuota({ userId: user.id, organizationId });
    if (!quota.allowed) return quotaError(quota);

    const providerDecision = resolveLeadProvider({
      organizationId,
    });
    const result = await requestApolloSearch({
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
      organizationSearchCredits: Math.max(0, Number(result.organization_search_credits) || 0),
    });
    response.headers.set('x-provider-used', 'apollo');
    return response;
  } catch (error: any) {
    const authResponse = handleAuthError(error);
    if (authResponse.status !== 500 || error?.name === 'AuthError') return authResponse;
    if (error instanceof ApolloSearchClientError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: 'APOLLO_COMPANY_SEARCH_FAILED' }, { status: 500 });
  }
}

function quotaError(quota: DailyQuotaResult) {
  return NextResponse.json({
    error: 'DAILY_SEARCH_QUOTA_EXCEEDED',
    count: quota.count,
    limit: quota.limit,
    retryAt: quota.resetAtISO,
  }, { status: 429 });
}

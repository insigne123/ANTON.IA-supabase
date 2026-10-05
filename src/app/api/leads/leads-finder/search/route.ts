import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import type { LeadSearchInput } from '@/lib/server/apollo-provider/validation';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { hasLeadsFinderAccess } from '@/lib/server/leads-finder/access';
import { LEADS_FINDER_PROVIDER, LeadsFinderError, searchLeadsFinder } from '@/lib/server/leads-finder/client';
import { LEADS_FINDER_MAX_PER_RUN } from '@/lib/server/leads-finder/input';
import { LeadsFinderVaultError, storeInVault } from '@/lib/server/leads-finder/vault';
import { requestAuthErrorResponse, requireSessionOrTrustedInternalRequest } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The actor runs synchronously for up to 110 s.
export const maxDuration = 120;

/**
 * «Buscar prospectos» with Apify Leads Finder (Plan 11, PR 6c), a test next to Apollo: only with LEADS_FINDER_ENABLED
 * and for the emails of LEADS_FINDER_ALLOWED_EMAILS; anyone else gets a 404. The same filters and daily search quota
 * as the Apollo search; the results come back like Apollo's (last name masked, no email, phone or personal LinkedIn),
 * and what Apify brought for each person waits encrypted in the vault until «Enriquecer» reveals it.
 */
const list = (max = 25) => z.array(z.string().trim().min(1).max(200)).max(max).optional().default([]);
const FiltersSchema = z.object({
  titles: list(),
  seniorities: list(),
  person_locations: list(),
  company_location: list(),
  industry_keywords: list(),
  company_keywords: list(),
  organization_domains: list(),
  employee_ranges: list(10),
  max_results: z.number().int().min(1).max(LEADS_FINDER_MAX_PER_RUN).optional().default(25),
});

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };
const json = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...noStore, ...headers } });

function maxRunUsd() {
  const value = Number(process.env.LEADS_FINDER_MAX_RUN_USD);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 5) : 0.5;
}

/** People of this search already saved by the organization are left out, as the Apollo search does. */
async function alreadySaved(admin: any, organizationId: string, ids: string[]) {
  const saved = new Set<string>();
  if (ids.length === 0) return saved;
  for (const table of ['leads', 'enriched_leads']) {
    const { data, error } = await admin.from(table).select('source_provider_id')
      .eq('organization_id', organizationId).eq('source_provider', LEADS_FINDER_PROVIDER).in('source_provider_id', ids);
    if (error) throw new Error('SAVED_LEADS_LOOKUP_FAILED');
    for (const row of data || []) saved.add(String(row.source_provider_id));
  }
  return saved;
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireSessionOrTrustedInternalRequest>>;
  try {
    auth = await requireSessionOrTrustedInternalRequest(request);
  } catch (error) {
    const response = requestAuthErrorResponse(error);
    if (response) return response;
    throw error;
  }
  // A person tries it from the screen; agents keep using Apollo until the comparison says otherwise.
  if (auth.source !== 'session' || !hasLeadsFinderAccess(auth.user.email)) return json({ error: 'NOT_FOUND' }, 404);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  if (!organizationId) return json({ error: 'ORGANIZATION_REQUIRED' }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }
  const parsed = FiltersSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'INVALID_REQUEST_BODY', message: 'Revisa los filtros: alguno es demasiado largo o no es válido.' }, 400);
  const filters = parsed.data;
  const input: LeadSearchInput = {
    provider: 'apollo',
    searchMode: 'batch',
    revealEmail: false,
    revealPhone: false,
    organizationDomains: filters.organization_domains,
    titles: filters.titles,
    seniorities: filters.seniorities,
    industryKeywords: filters.industry_keywords,
    companyKeywords: filters.company_keywords,
    companyLocations: filters.company_location,
    personLocations: filters.person_locations,
    employeeRanges: filters.employee_ranges,
    includeSimilarTitles: true,
    maxResults: filters.max_results,
  };
  const hasFilter = [input.titles, input.seniorities, input.industryKeywords, input.companyKeywords, input.companyLocations,
    input.personLocations, input.organizationDomains, input.employeeRanges].some(values => values.length > 0);
  if (!hasFilter) return json({ error: 'FILTER_REQUIRED', message: 'Agrega al menos un filtro: cargo, ubicación, industria o tamaño.' }, 400);

  // The same daily search quota as an Apollo search.
  const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
  const quota = await checkAndConsumeDailyQuota({ userId, organizationId, resource: 'search', limit: limits.leadSearch });
  if (!quota.allowed) {
    return json({ error: 'DAILY_SEARCH_QUOTA_EXCEEDED', count: quota.count, limit: quota.limit, retryAt: quota.resetAtISO }, 429);
  }

  const startedAt = Date.now();
  let found: Awaited<ReturnType<typeof searchLeadsFinder>>;
  try {
    found = await searchLeadsFinder(input, { fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, maxRunUsd: maxRunUsd() });
  } catch (error) {
    if (error instanceof LeadsFinderError) {
      await safeAppendAntoniaEvent({
        eventType: 'search.failed', organizationId, actorId: userId, actorType: 'user', entityType: 'search',
        sourceRoute: '/api/leads/leads-finder/search', provider: LEADS_FINDER_PROVIDER, status: 'failed', outcome: 'provider_error',
        severity: 'warning', metrics: { httpStatus: error.status, mayHaveCharged: error.mayHaveCharged },
      });
      return json({ error: 'LEADS_FINDER_ERROR', message: error.message, mayHaveCharged: error.mayHaveCharged }, error.status);
    }
    throw error;
  }

  const admin = getSupabaseAdminClient() as any;
  try {
    // Shown only if it can be enriched later: the vault write comes first.
    await storeInVault(admin, { organizationId, userId, entries: found.results });
  } catch (error) {
    if (error instanceof LeadsFinderVaultError) {
      return json({ error: error.code, message: 'No pudimos guardar los resultados para enriquecerlos después, así que no los mostramos. Inténtalo de nuevo más tarde.' }, 503);
    }
    throw error;
  }
  let saved: Set<string>;
  try {
    saved = await alreadySaved(admin, organizationId, found.results.map(result => result.lead.id));
  } catch {
    return json({ error: 'SAVED_LEADS_LOOKUP_FAILED' }, 503);
  }
  // Only the public lead leaves the server: the contact stays in the vault.
  const leads = found.results.map(result => result.lead).filter(lead => !saved.has(lead.id));

  await safeAppendAntoniaEvent({
    eventType: 'search.completed', organizationId, actorId: userId, actorType: 'user', entityType: 'search',
    sourceRoute: '/api/leads/leads-finder/search', provider: LEADS_FINDER_PROVIDER, status: 'completed', outcome: 'provider_completed',
    metrics: { fetched: found.fetched, returned: leads.length, alreadySaved: saved.size, costUsd: found.costUsd, ms: Date.now() - startedAt },
  });
  return json({
    leads,
    count: leads.length,
    leads_count: leads.length,
    search_mode: 'leads_finder',
    provider: LEADS_FINDER_PROVIDER,
    already_saved: saved.size,
    not_applied: found.notApplied,
    cost_estimate_usd: found.costUsd,
  }, 200, {
    'x-provider-used': LEADS_FINDER_PROVIDER,
    'x-quota-count': String(quota.count),
    'x-quota-limit': String(quota.limit),
  });
}

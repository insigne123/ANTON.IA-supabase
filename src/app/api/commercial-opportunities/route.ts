import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import {
  ensureHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities, monthSpentUsd, recentRuns,
} from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, hiringSyncPlan, monthStart, monthlyCapUsd } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';

/**
 * Everything the page shows: the search profile, what a search costs before running it, the companies that are hiring,
 * the open tenders, the SEIA projects and the last runs.
 */
export async function GET() {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await ensureHiringProfile(auth.admin, scope);
    const now = new Date().toISOString();
    const [opportunities, tenders, projects, runs, spentUsd] = await Promise.all([
      listHiringOpportunities(auth.admin, scope, { minAds: profile.minAds, now }),
      listTenderOpportunities(auth.admin, scope, { now }),
      listProjectOpportunities(auth.admin, scope),
      recentRuns(auth.admin, scope),
      monthSpentUsd(auth.admin, scope, monthStart(now)),
    ]);
    return opportunitiesJson({
      profile, plan: hiringSyncPlan(profile, hiringSyncEnvironment()), month: { spentUsd: Math.round(spentUsd * 100) / 100, capUsd: monthlyCapUsd() },
      tenderSearch: { ticket: Boolean(process.env.MERCADO_PUBLICO_TICKET), keywords: profile.keywords, unspscCodes: profile.unspscCodes },
      opportunities, tenders, projects, runs,
    });
  } catch (error) {
    return opportunitiesError(error);
  }
}

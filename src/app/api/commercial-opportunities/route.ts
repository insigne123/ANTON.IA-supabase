import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { ensureHiringProfile, listHiringOpportunities, monthSpentUsd, recentRuns } from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, hiringSyncPlan, monthStart, monthlyCapUsd } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';

/** Everything the page shows: the search profile, what a search costs before running it, the companies and the last runs. */
export async function GET() {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await ensureHiringProfile(auth.admin, scope);
    const now = new Date().toISOString();
    const [opportunities, runs, spentUsd] = await Promise.all([
      listHiringOpportunities(auth.admin, scope, { minAds: profile.minAds, now }),
      recentRuns(auth.admin, scope),
      monthSpentUsd(auth.admin, scope, monthStart(now)),
    ]);
    return opportunitiesJson({
      profile, plan: hiringSyncPlan(profile, hiringSyncEnvironment()), month: { spentUsd: Math.round(spentUsd * 100) / 100, capUsd: monthlyCapUsd() },
      opportunities, runs,
    });
  } catch (error) {
    return opportunitiesError(error);
  }
}

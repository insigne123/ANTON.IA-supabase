import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { ensureHiringProfile, supabaseHiringStore } from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/** «Buscar ahora»: one search in every source with its key, within the month's cap. The page showed the cost before. */
export async function POST() {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await ensureHiringProfile(auth.admin, scope);
    const result = await runHiringSync({
      store: supabaseHiringStore(auth.admin, { ...scope, profileId: profile.id }, 'manual'), profile, env: hiringSyncEnvironment(),
      capUsd: monthlyCapUsd(), organizationId: auth.organizationId,
    });
    return opportunitiesJson(result);
  } catch (error) {
    return opportunitiesError(error);
  }
}

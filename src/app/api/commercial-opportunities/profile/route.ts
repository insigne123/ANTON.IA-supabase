import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { createHiringProfile, findHiringProfile, hiringProfilePatchSchema, updateHiringProfile } from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, hiringSyncPlan } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';

/**
 * What to look for: the offer, the roles, the regions and the minimum of ads. The next search uses it. The first save creates
 * the organization's profile (Plan 10): nothing is created just by opening the page.
 */
export async function PUT(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const patch = hiringProfilePatchSchema.parse(await request.json().catch(() => ({})));
    const current = await findHiringProfile(auth.admin, scope);
    const profile = current ? await updateHiringProfile(auth.admin, scope, current.id, patch) : await createHiringProfile(auth.admin, scope, patch);
    if (!profile) return opportunitiesJson({ error: 'No encontramos el perfil de búsqueda.' }, 404);
    return opportunitiesJson({ profile, plan: hiringSyncPlan(profile, hiringSyncEnvironment()) });
  } catch (error) {
    return opportunitiesError(error);
  }
}

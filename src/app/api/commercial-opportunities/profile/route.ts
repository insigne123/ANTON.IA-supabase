import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import {
  createHiringProfile, findHiringProfile, hiringProfilePatchSchema, readPerfilForOpportunities, readSchedule, refreshHiringProfileFromPerfil, saveSchedule,
  updateHiringProfile,
} from '@/lib/server/commercial-opportunities/store';
import { z } from 'zod';
import { hiringSyncEnvironment, hiringSyncPlan } from '@/lib/server/commercial-opportunities/sync';
import { MANUAL_JSEARCH_QUERIES } from '@/lib/commercial-opportunities/search-terms';

export const dynamic = 'force-dynamic';

const scheduleSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Elige al menos un día.').max(7),
  hour: z.number().int().min(0).max(23),
}).strict();
export const maxDuration = 60;

/**
 * What to look for: the roles, the regions and the minimum of ads, plus the words of the tender search, the SEIA sectors and
 * the minimum investment. The first save creates the organization's profile (Plan 10): nothing is created just by opening
 * the page. Since Plan 15 the offer comes from «Perfil», and the words and sectors are generated from it when the profile
 * is created without them, when the offer changed or when the person asks again (`regenerate`).
 */
export async function PUT(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const body = await request.json().catch(() => ({}));
    const regenerate = Boolean(body && typeof body === 'object' && (body as { regenerate?: unknown }).regenerate === true);
    const { regenerate: _ignored, schedule: rawSchedule, ...fields } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const patch = hiringProfilePatchSchema.parse(fields);
    // When the search runs by itself (Plan 15): saved only once its columns exist.
    const schedule = rawSchedule === undefined ? null : scheduleSchema.parse(rawSchedule);
    const [current, perfil] = await Promise.all([findHiringProfile(auth.admin, scope), readPerfilForOpportunities(auth.admin, scope)]);
    const withOffer = { ...patch, offer: perfil.offer || current?.offer || patch.offer };
    const saved = current ? await updateHiringProfile(auth.admin, scope, current.id, withOffer) : await createHiringProfile(auth.admin, scope, withOffer);
    if (!saved) return opportunitiesJson({ error: 'No encontramos el perfil de búsqueda.' }, 404);
    const profile = await refreshHiringProfileFromPerfil(auth.admin, scope, saved, {
      perfil, force: regenerate || (!current && !patch.keywords?.length),
    });
    const currentSchedule = await readSchedule(auth.admin, scope, profile.id);
    const savedSchedule = schedule && currentSchedule.available
      ? { ...(await saveSchedule(auth.admin, scope, profile.id, schedule)), available: true } : currentSchedule;
    return opportunitiesJson({ profile, schedule: savedSchedule, plan: hiringSyncPlan(profile, hiringSyncEnvironment(), { cap: MANUAL_JSEARCH_QUERIES }) });
  } catch (error) {
    return opportunitiesError(error);
  }
}

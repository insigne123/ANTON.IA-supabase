import { z } from 'zod';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { opportunityStatusSchema, setOpportunityStatus } from '@/lib/server/commercial-opportunities/store';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** «Me interesa», «Descartar» or back to «Nueva». */
export async function PATCH(request: Request, context: Context) {
  try {
    const auth = await requireOpportunitiesAccess();
    const id = z.string().uuid().parse((await context.params).id);
    const { status } = opportunityStatusSchema.parse(await request.json().catch(() => ({})));
    const updated = await setOpportunityStatus(auth.admin, { userId: auth.user.id, organizationId: auth.organizationId }, id, status);
    if (!updated) return opportunitiesJson({ error: 'No encontramos esa oportunidad.' }, 404);
    return opportunitiesJson(updated);
  } catch (error) {
    return opportunitiesError(error);
  }
}

import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { enqueueOpportunityDemand, followPlanLine, readOpportunityDemand } from '@/lib/server/commercial-opportunities/purchase-plan';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

/** «Demanda futura»: what public bodies plan to buy that fits the workspace's offer (Plan Anual de Compras). Admins only. */
export async function GET() {
  try {
    const auth = await requireOpportunityWorkspace();
    return opportunitiesJson(await readOpportunityDemand(auth.admin, opportunityScope(auth)));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('refresh') }).strict(),
      z.object({ action: z.literal('follow'), year: z.number().int().min(2015).max(2100), lineId: z.string().regex(/^[a-f0-9]{16,64}$/) }).strict(),
    ]).parse(await request.json());
    if (body.action === 'refresh') return opportunitiesJson({ jobId: await enqueueOpportunityDemand(auth.admin, scope, true) }, 202);
    return opportunitiesJson({ id: await followPlanLine(auth.admin, scope, { year: body.year, lineId: body.lineId }) }, 201);
  } catch (error) { return opportunitiesError(error); }
}

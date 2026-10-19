import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { enqueueWinPlan, readOpportunityMarket } from '@/lib/server/commercial-opportunities/workspace-market';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

/** «Cómo ganar» of a tender: its buyer's history in ChileCompra's open data and the latest strategy. */
export async function GET(_request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const id = z.string().uuid().parse((await context.params).id);
    return opportunitiesJson(await readOpportunityMarket(auth.admin, opportunityScope(auth), id));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const auth = await requireOpportunityWorkspace(); const id = z.string().uuid().parse((await context.params).id);
    const body = z.object({ action: z.literal('winplan'), requestId: z.string().uuid() }).strict().parse(await request.json());
    return opportunitiesJson({ jobId: await enqueueWinPlan(auth.admin, opportunityScope(auth), id, { requestId: body.requestId }) }, 202);
  } catch (error) { return opportunitiesError(error); }
}

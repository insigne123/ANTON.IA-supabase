import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { enqueueMarketContracts, followExpiringContract, readMarketContracts } from '@/lib/server/commercial-opportunities/workspace-market';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

/** «Contratos por vencer»: public contracts held by others that end soon and fit the workspace's offer. Admins only. */
export async function GET() {
  try {
    const auth = await requireOpportunityWorkspace();
    return opportunitiesJson(await readMarketContracts(auth.admin, opportunityScope(auth)));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const body = z.discriminatedUnion('action', [
      z.object({ action: z.literal('refresh') }).strict(),
      z.object({ action: z.literal('follow'), tenderId: z.number().int().positive() }).strict(),
    ]).parse(await request.json());
    if (body.action === 'refresh') return opportunitiesJson({ jobId: await enqueueMarketContracts(auth.admin, scope) }, 202);
    return opportunitiesJson({ id: await followExpiringContract(auth.admin, scope, body.tenderId) }, 201);
  } catch (error) { return opportunitiesError(error); }
}

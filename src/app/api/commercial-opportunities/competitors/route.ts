import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope } from '@/lib/server/commercial-opportunities/workspace-access';
import { followCompetitor, readCompetitor, readCompetitorRadar, searchCompetitors } from '@/lib/server/commercial-opportunities/workspace-market';
import { opportunitiesJson, opportunitiesError } from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic';

/**
 * The competitor radar, from ChileCompra's open data: the followed competitors and suggestions (no query), a search by
 * name or RUT (?q=), or one supplier's profile (?id=). Admins only.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth);
    const params = new URL(request.url).searchParams;
    if (params.has('id')) return opportunitiesJson(await readCompetitor(auth.admin, scope, z.coerce.number().int().positive().parse(params.get('id'))));
    if (params.has('q')) return opportunitiesJson({ items: await searchCompetitors(auth.admin, scope, z.string().trim().min(1).max(120).parse(params.get('q'))) });
    return opportunitiesJson(await readCompetitorRadar(auth.admin, scope));
  } catch (error) { return opportunitiesError(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireOpportunityWorkspace();
    const body = z.object({ action: z.literal('follow'), supplierId: z.number().int().positive(), follow: z.boolean() }).strict().parse(await request.json());
    return opportunitiesJson(await followCompetitor(auth.admin, opportunityScope(auth), body.supplierId, body.follow));
  } catch (error) { return opportunitiesError(error); }
}

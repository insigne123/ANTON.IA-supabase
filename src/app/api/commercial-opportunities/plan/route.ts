import { z } from 'zod';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { MANUAL_JSEARCH_QUERIES, searchRoles } from '@/lib/commercial-opportunities/search-terms';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { generateRoleVariants } from '@/lib/server/commercial-opportunities/search-ai';
import { hiringSyncEnvironment, hiringSyncPlan } from '@/lib/server/commercial-opportunities/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  roles: z.array(z.string().max(80)).max(30),
  regions: z.array(z.enum(CHILE_REGIONS as [string, ...string[]])).max(16).default([]),
}).strict();

/**
 * What «Buscar ahora» will ask before it runs (Plan 15): the roles the person chose with the variants the model adds for each
 * one, the questions to each source and what they may cost. Reads and writes nothing of the organization.
 */
export async function POST(request: Request) {
  try {
    await requireOpportunitiesAccess();
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const roles = searchRoles(body.roles);
    const regions = CHILE_REGIONS.filter(region => body.regions.includes(region));
    const variants = await generateRoleVariants(roles);
    return opportunitiesJson({ roles, regions, variants, plan: hiringSyncPlan({ roles, regions }, hiringSyncEnvironment(), { variants, cap: MANUAL_JSEARCH_QUERIES }) });
  } catch (error) {
    return opportunitiesError(error);
  }
}

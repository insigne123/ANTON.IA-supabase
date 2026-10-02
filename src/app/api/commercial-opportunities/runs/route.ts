import { z } from 'zod';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { ensureHiringProfile, supabaseHiringStore, supabaseTenderStore } from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';
import { runTenderSync } from '@/lib/server/commercial-opportunities/tender-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const bodySchema = z.object({ kind: z.enum(['hiring', 'tenders']).default('hiring') }).strict();

/**
 * «Buscar ahora»: companies that are hiring (paid sources, within the month's cap; the page showed the cost before) or
 * public tenders (free, within the ticket's daily quota).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const { kind } = bodySchema.parse(await request.json().catch(() => ({})));
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await ensureHiringProfile(auth.admin, scope);
    const storeScope = { ...scope, profileId: profile.id };
    if (kind === 'tenders') {
      return opportunitiesJson(await runTenderSync({
        store: supabaseTenderStore(auth.admin, storeScope, 'manual'), profile, ticket: process.env.MERCADO_PUBLICO_TICKET, organizationId: auth.organizationId,
      }));
    }
    return opportunitiesJson(await runHiringSync({
      store: supabaseHiringStore(auth.admin, storeScope, 'manual'), profile, env: hiringSyncEnvironment(), capUsd: monthlyCapUsd(),
      organizationId: auth.organizationId,
    }));
  } catch (error) {
    return opportunitiesError(error);
  }
}

import { z } from 'zod';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { findHiringProfile, supabaseHiringStore, supabaseTenderStore } from '@/lib/server/commercial-opportunities/store';
import { HiringSyncError, hiringSyncEnvironment, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';
import { runTenderSync } from '@/lib/server/commercial-opportunities/tender-sync';
import { markTicketRejected, resolveTicketForUser, ticketWasRejected } from '@/lib/server/commercial-opportunities/tickets';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const bodySchema = z.object({ kind: z.enum(['hiring', 'tenders']).default('hiring') }).strict();

/**
 * «Buscar ahora»: companies that are hiring (paid sources, within the month's cap; the page showed the cost before) or
 * public tenders (free, with the Mercado Público ticket of whoever clicks).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const { kind } = bodySchema.parse(await request.json().catch(() => ({})));
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const profile = await findHiringProfile(auth.admin, scope);
    if (!profile) throw new HiringSyncError('Primero define qué buscas: la oferta, los cargos y las palabras de las licitaciones.', 409);
    const storeScope = { ...scope, profileId: profile.id };
    if (kind === 'tenders') {
      // The ticket of whoever clicks: their own, or the shared one when they are on its list.
      const resolved = await resolveTicketForUser(auth.admin, auth.user);
      if (!resolved.ticket) throw new HiringSyncError('Conecta tu ticket de Mercado Público para buscar licitaciones. Es gratis y se pide una sola vez.', 409);
      const result = await runTenderSync({
        store: supabaseTenderStore(auth.admin, storeScope, 'manual'), profile, ticket: resolved.ticket, organizationId: auth.organizationId,
      });
      if (resolved.source === 'own' && ticketWasRejected(result)) await markTicketRejected(auth.admin, auth.user.id).catch(() => undefined);
      return opportunitiesJson(result);
    }
    return opportunitiesJson(await runHiringSync({
      store: supabaseHiringStore(auth.admin, storeScope, 'manual'), profile, env: hiringSyncEnvironment(), capUsd: monthlyCapUsd(),
      organizationId: auth.organizationId,
    }));
  } catch (error) {
    return opportunitiesError(error);
  }
}

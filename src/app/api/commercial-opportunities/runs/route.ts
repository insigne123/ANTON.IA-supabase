import { z } from 'zod';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import {
  findHiringProfile, readPerfilForOpportunities, refreshHiringProfileFromPerfil, saveSearchChoice, supabaseHiringStore, supabaseTenderStore,
} from '@/lib/server/commercial-opportunities/store';
import { CHILE_REGIONS } from '@/lib/commercial-opportunities/hiring';
import { MANUAL_JSEARCH_QUERIES, cleanRoleVariants, searchRoles } from '@/lib/commercial-opportunities/search-terms';
import { generateRoleVariants } from '@/lib/server/commercial-opportunities/search-ai';
import { HiringSyncError, hiringSyncEnvironment, monthlyCapUsd, runHiringSync } from '@/lib/server/commercial-opportunities/sync';
import { runTenderSync } from '@/lib/server/commercial-opportunities/tender-sync';
import { markTicketRejected, resolveTicketForUser, ticketWasRejected } from '@/lib/server/commercial-opportunities/tickets';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const bodySchema = z.object({
  kind: z.enum(['hiring', 'tenders']).default('hiring'),
  // Plan 15: the roles and regions are chosen when searching, with the variants the dialog showed; absent, the saved ones.
  roles: z.array(z.string().max(80)).max(30).optional(),
  regions: z.array(z.enum(CHILE_REGIONS as [string, ...string[]])).max(16).optional(),
  variants: z.record(z.array(z.string().max(80)).max(8)).optional(),
  /** Keep these roles and regions for the daily search. */
  save: z.boolean().optional(),
}).strict();

/**
 * «Buscar ahora»: companies that are hiring (paid sources, within the month's cap; the page showed the cost before) or
 * public tenders (free, with the Mercado Público ticket of whoever clicks). Both follow «Perfil» first (Plan 15): its offer,
 * and the tender words generated from it.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const { kind } = body;
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const found = await findHiringProfile(auth.admin, scope);
    if (!found) throw new HiringSyncError('Primero define qué buscas.', 409);
    const perfil = await readPerfilForOpportunities(auth.admin, scope);
    let profile = await refreshHiringProfileFromPerfil(auth.admin, scope, found, { perfil });
    const storeScope = { ...scope, profileId: profile.id };
    if (kind === 'tenders') {
      // The ticket of whoever clicks: their own, or the shared one when they are on its list.
      const resolved = await resolveTicketForUser(auth.admin, auth.user);
      if (!resolved.ticket) throw new HiringSyncError('Conecta tu ticket de Mercado Público para buscar licitaciones. Es gratis y se pide una sola vez.', 409);
      if (!profile.keywords.length && !profile.unspscCodes.length) {
        throw new HiringSyncError('Completa en Perfil qué vendes: con eso generamos las palabras para buscar licitaciones.', 409);
      }
      const result = await runTenderSync({
        store: supabaseTenderStore(auth.admin, storeScope, 'manual'), profile, ticket: resolved.ticket, organizationId: auth.organizationId,
      });
      if (resolved.source === 'own' && ticketWasRejected(result)) await markTicketRejected(auth.admin, auth.user.id).catch(() => undefined);
      return opportunitiesJson(result);
    }
    const roles = body.roles ? searchRoles(body.roles) : profile.roles;
    const regions = body.regions ? CHILE_REGIONS.filter(region => body.regions!.includes(region)) : profile.regions;
    if (body.save && body.roles) profile = (await saveSearchChoice(auth.admin, scope, profile.id, { roles, regions })) ?? profile;
    // The variants the dialog showed (the person may have removed some); without them, asked again.
    const variants = body.variants ? cleanRoleVariants(roles, body.variants) : await generateRoleVariants(roles);
    return opportunitiesJson(await runHiringSync({
      store: supabaseHiringStore(auth.admin, storeScope, 'manual'), profile: { ...profile, roles, regions }, env: hiringSyncEnvironment(), capUsd: monthlyCapUsd(),
      organizationId: auth.organizationId, variants, queryCap: MANUAL_JSEARCH_QUERIES,
    }));
  } catch (error) {
    return opportunitiesError(error);
  }
}

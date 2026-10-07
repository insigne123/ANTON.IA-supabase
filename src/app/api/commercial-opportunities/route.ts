import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import {
  findHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities, monthSpentUsd, readHiringProfileSuggestion,
  listMyOpportunities, readPerfilForOpportunities, recentRuns,
} from '@/lib/server/commercial-opportunities/store';
import { MANUAL_JSEARCH_QUERIES } from '@/lib/commercial-opportunities/search-terms';
import { hiringSyncEnvironment, hiringSyncPlan, monthStart, monthlyCapUsd } from '@/lib/server/commercial-opportunities/sync';
import { resolveTicketForUser } from '@/lib/server/commercial-opportunities/tickets';

export const dynamic = 'force-dynamic';

/**
 * Everything the page shows: the search profile, what a search costs before running it, the companies that are hiring,
 * the open tenders, the SEIA projects, the last runs and whether the person's Mercado Público ticket is connected. Without a
 * profile yet (Plan 10) it answers `profile: null` with a suggestion to start from, and creates nothing.
 */
export async function GET() {
  try {
    const auth = await requireOpportunitiesAccess();
    const scope = { userId: auth.user.id, organizationId: auth.organizationId };
    const [profile, perfil] = await Promise.all([findHiringProfile(auth.admin, scope), readPerfilForOpportunities(auth.admin, scope)]);
    const now = new Date().toISOString();
    // What «Perfil» says today (Plan 15): the page shows the offer from there and suggests its regions.
    const fromPerfil = { offer: perfil.offer, regions: perfil.regions };
    if (!profile) {
      const [runs, spentUsd, ticket, suggestion] = await Promise.all([
        recentRuns(auth.admin, scope), monthSpentUsd(auth.admin, scope, monthStart(now)), resolveTicketForUser(auth.admin, auth.user),
        readHiringProfileSuggestion(auth.admin, scope),
      ]);
      return opportunitiesJson({
        profile: null, suggestion, perfil: fromPerfil, mine: [], plan: { sources: [], estimateUsd: 0, queries: [], left: 0 }, month: { spentUsd: Math.round(spentUsd * 100) / 100, capUsd: monthlyCapUsd() },
        tenderSearch: { ticket: Boolean(ticket.ticket), ticketStatus: ticket.status, keywords: [], unspscCodes: [] },
        opportunities: [], tenders: [], projects: [], runs,
      });
    }
    const [opportunities, tenders, projects, runs, spentUsd, ticket, mine] = await Promise.all([
      listHiringOpportunities(auth.admin, scope, { minAds: profile.minAds, now }),
      listTenderOpportunities(auth.admin, scope, { now }),
      listProjectOpportunities(auth.admin, scope),
      recentRuns(auth.admin, scope),
      monthSpentUsd(auth.admin, scope, monthStart(now)),
      resolveTicketForUser(auth.admin, auth.user),
      listMyOpportunities(auth.admin, scope),
    ]);
    return opportunitiesJson({
      mine,
      profile, perfil: fromPerfil, plan: hiringSyncPlan(profile, hiringSyncEnvironment(), { cap: MANUAL_JSEARCH_QUERIES }), month: { spentUsd: Math.round(spentUsd * 100) / 100, capUsd: monthlyCapUsd() },
      // Whether this person can search tenders (their own ticket, or the shared one when they are on its list), never the ticket.
      tenderSearch: { ticket: Boolean(ticket.ticket), ticketStatus: ticket.status, keywords: profile.keywords, unspscCodes: profile.unspscCodes },
      opportunities, tenders, projects, runs,
    });
  } catch (error) {
    return opportunitiesError(error);
  }
}

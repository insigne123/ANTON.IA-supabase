import type { TicketSource } from './tickets';
import { NO_ORGANIZATION_TICKET, ticketWasRejected } from './tickets';

/**
 * Which organizations the daily sync visits and what it asks for each: one visit per organization (its first active
 * profile's creator acts as the scope), tenders always (the ticket is resolved per organization, from its members) and
 * hiring when JSearch has its key.
 */
export function dailyOpportunityPlan(profiles: Array<{ organization_id: string; created_by: string }>, keys: { jsearch: boolean }) {
  const seen = new Set<string>();
  return profiles.flatMap(profile => {
    if (!profile.organization_id || !profile.created_by || seen.has(profile.organization_id)) return [];
    seen.add(profile.organization_id);
    return [{ organizationId: profile.organization_id, userId: profile.created_by, tenders: true, hiring: keys.jsearch }];
  });
}

type TenderOutcome = { status: string; matched: number; created: number; sources: Array<{ source: string; error: string | null }> };
/**
 * The daily tender search of one organization (Plan 10). With a member's ticket it searches, and a ticket Mercado Público
 * refuses is marked so the page asks to replace it. Without any, both sources are recorded as skipped, at no cost, so the
 * page and Cowork can say why there are no new tenders.
 */
export async function dailyTenderSearch(input: {
  resolveTicket: () => Promise<{ ticket: string; userId: string; source: TicketSource } | null>;
  search: (ticket: string) => Promise<TenderOutcome>;
  skip: (source: 'mercado_publico' | 'compra_agil', error: string) => Promise<unknown>;
  markRejected: (userId: string) => Promise<unknown>;
}) {
  let resolved: Awaited<ReturnType<typeof input.resolveTicket>>;
  try {
    resolved = await input.resolveTicket();
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : 'error' };
  }
  if (!resolved) {
    for (const source of ['mercado_publico', 'compra_agil'] as const) await input.skip(source, NO_ORGANIZATION_TICKET);
    return { skipped: NO_ORGANIZATION_TICKET };
  }
  try {
    const result = await input.search(resolved.ticket);
    if (resolved.source === 'own' && ticketWasRejected(result)) await Promise.resolve(input.markRejected(resolved.userId)).catch(() => undefined);
    return { status: result.status, matched: result.matched, created: result.created, ticket: resolved.source,
      errors: result.sources.filter(source => source.error).map(source => source.error) };
  } catch (failure) {
    return { error: failure instanceof Error ? failure.message : 'error' };
  }
}

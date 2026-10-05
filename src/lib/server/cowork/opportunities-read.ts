import type { SupabaseClient } from '@supabase/supabase-js';
import { isOpportunitiesUserAllowed } from '@/lib/commercial-opportunities/access';
import { coworkOpportunitiesSummary } from '@/lib/commercial-opportunities/cowork';
import {
  findHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities, recentRuns,
} from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment } from '@/lib/server/commercial-opportunities/sync';
import { resolveTicketForUser } from '@/lib/server/commercial-opportunities/tickets';

type Scope = { userId: string; organizationId: string };

/**
 * Whether the owner of a Cowork run may see «Oportunidades»: the same list as the page (OPPORTUNITIES_ALLOWED_EMAILS, with a
 * confirmed email), read from the auth record with the worker's service client. Any doubt is a no.
 */
export async function coworkOpportunitiesAllowed(client: SupabaseClient, userId: string, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  return Boolean(await coworkOpportunitiesUser(client, userId, configured));
}

/** The auth record of the run owner when they may see «Oportunidades», or null. */
async function coworkOpportunitiesUser(client: SupabaseClient, userId: string, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  if (!configured?.trim()) return null;
  try {
    const { data, error } = await client.auth.admin.getUserById(userId);
    return !error && data?.user && isOpportunitiesUserAllowed(data.user, configured) ? data.user : null;
  } catch {
    return null;
  }
}

/**
 * opportunities.list (plan 8, phase 3, PR-3f): the organization's companies hiring, open tenders and SEIA projects, a few of
 * each with their signal. `value` narrows them to a company, buyer or project («Falabella»); empty brings the best of each.
 * Read only: without a profile it says so instead of creating one, and the access is checked again on every read.
 */
export async function readCoworkOpportunities(client: SupabaseClient, scope: Scope, value: string) {
  const user = await coworkOpportunitiesUser(client, scope.userId);
  if (!user) throw new Error('Esta consulta no está disponible para esta cuenta.');
  const now = new Date().toISOString();
  const profile = await findHiringProfile(client, scope);
  const [hiring, tenders, projects, runs] = profile ? await Promise.all([
    listHiringOpportunities(client, scope, { minAds: profile.minAds, now }),
    listTenderOpportunities(client, scope, { now }),
    listProjectOpportunities(client, scope),
    recentRuns(client, scope),
  ]) : [[], [], [], []];
  const environment = hiringSyncEnvironment();
  // Tenders are ready when this person has a ticket (their own, or the shared one when they are on its list).
  const ticket = await resolveTicketForUser(client, user).catch(() => null);
  return coworkOpportunitiesSummary({
    profile, hiring, tenders, projects, runs, query: value, now,
    ready: { hiring: Boolean(environment.jsearchKey || environment.apifyToken), tenders: Boolean(ticket?.ticket) },
  });
}

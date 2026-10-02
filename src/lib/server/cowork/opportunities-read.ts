import type { SupabaseClient } from '@supabase/supabase-js';
import { isOpportunitiesUserAllowed } from '@/lib/commercial-opportunities/access';
import { coworkOpportunitiesSummary } from '@/lib/commercial-opportunities/cowork';
import {
  findHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities, recentRuns,
} from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment } from '@/lib/server/commercial-opportunities/sync';

type Scope = { userId: string; organizationId: string };

/**
 * Whether the owner of a Cowork run may see «Oportunidades»: the same list as the page (OPPORTUNITIES_ALLOWED_EMAILS, with a
 * confirmed email), read from the auth record with the worker's service client. Any doubt is a no.
 */
export async function coworkOpportunitiesAllowed(client: SupabaseClient, userId: string, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  if (!configured?.trim()) return false;
  try {
    const { data, error } = await client.auth.admin.getUserById(userId);
    return !error && isOpportunitiesUserAllowed(data?.user, configured);
  } catch {
    return false;
  }
}

/**
 * opportunities.list (plan 8, phase 3, PR-3f): the organization's companies hiring, open tenders and SEIA projects, a few of
 * each with their signal. `value` narrows them to a company, buyer or project («Falabella»); empty brings the best of each.
 * Read only: without a profile it says so instead of creating one, and the access is checked again on every read.
 */
export async function readCoworkOpportunities(client: SupabaseClient, scope: Scope, value: string) {
  if (!await coworkOpportunitiesAllowed(client, scope.userId)) throw new Error('Esta consulta no está disponible para esta cuenta.');
  const now = new Date().toISOString();
  const profile = await findHiringProfile(client, scope);
  const [hiring, tenders, projects, runs] = profile ? await Promise.all([
    listHiringOpportunities(client, scope, { minAds: profile.minAds, now }),
    listTenderOpportunities(client, scope, { now }),
    listProjectOpportunities(client, scope),
    recentRuns(client, scope),
  ]) : [[], [], [], []];
  const environment = hiringSyncEnvironment();
  return coworkOpportunitiesSummary({
    profile, hiring, tenders, projects, runs, query: value, now,
    ready: { hiring: Boolean(environment.jsearchKey || environment.apifyToken), tenders: Boolean(process.env.MERCADO_PUBLICO_TICKET) },
  });
}

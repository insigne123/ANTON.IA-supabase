import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkOpportunitiesSummary } from '@/lib/commercial-opportunities/cowork';
import {
  findHiringProfile, listHiringOpportunities, listProjectOpportunities, listTenderOpportunities, recentRuns,
} from '@/lib/server/commercial-opportunities/store';
import { hiringSyncEnvironment } from '@/lib/server/commercial-opportunities/sync';
import { resolveTicketForUser } from '@/lib/server/commercial-opportunities/tickets';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { opportunityWorkspaceEnabled } from '@/lib/commercial-opportunities/workspace';
import { readWorkspaceOverview } from '@/lib/server/commercial-opportunities/workspace-store';

type Scope = { userId: string; organizationId: string };

/**
 * Whether the owner of a Cowork run may see «Oportunidades» in the run's organization: the same rule as the page
 * (OPPORTUNITIES_ALLOWED_EMAILS, or a member an admin let in, with a confirmed email), read from the auth record with the
 * worker's service client. Any doubt is a no.
 */
export async function coworkOpportunitiesAllowed(client: SupabaseClient, scope: Scope, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  return Boolean(await coworkOpportunitiesUser(client, scope, configured));
}

/** The auth record of the run owner when they may see «Oportunidades», or null. */
async function coworkOpportunitiesUser(client: SupabaseClient, scope: Scope, configured = process.env.OPPORTUNITIES_ALLOWED_EMAILS) {
  try {
    const { data, error } = await client.auth.admin.getUserById(scope.userId);
    return !error && data?.user && await canUseOpportunities(client, data.user, scope.organizationId, configured) ? data.user : null;
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
  const user = await coworkOpportunitiesUser(client, scope);
  if (!user) throw new Error('Esta consulta no está disponible para esta cuenta.');
  if (opportunityWorkspaceEnabled()) {
    const member = await client.from('organization_members').select('role').eq('organization_id', scope.organizationId).eq('user_id', scope.userId).maybeSingle();
    if (member.error || !member.data) throw new Error('Esta consulta no está disponible para esta cuenta.');
    const overview = await readWorkspaceOverview(client, { ...scope, role: member.data.role });
    const query = value.trim().toLocaleLowerCase('es');
    return { scope: overview.mode === 'assigned' ? 'assigned_opportunities' : 'workspace_opportunities', page: '/opportunities',
      opportunities: overview.items.filter(item => !query || `${item.title} ${item.company_name || ''}`.toLocaleLowerCase('es').includes(query)).slice(0, 20)
        .map(item => ({ id: item.id, title: item.title, company: item.company_name, kind: item.kind, reasons: item.reasons, deadline: item.deadline_at,
          source: item.url, state: overview.work.find(w => w.opportunity_id === item.id)?.state || 'unassigned' })) };
  }
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

import type { SupabaseClient } from '@supabase/supabase-js';
import { assignmentDigestEmail, assignmentEmail } from '@/lib/commercial-opportunities/assignment-email';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import { readAlertsEmail } from '@/lib/server/daily-alerts';
import { isTestAddress, sendReportEmail, type SelfEmail } from '@/lib/server/self-email';

type Send = (input: SelfEmail) => Promise<{ ok: boolean }>;
type Row = Record<string, any>;

/** Who is on the opportunity's team right now: read before an assignment, to know who is new after it. */
export async function readParticipantIds(client: SupabaseClient, scope: WorkScope, id: string): Promise<string[]> {
  const { data, error } = await client.from('opportunity_participants').select('user_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).limit(100);
  if (error) return [];
  return ((data || []) as Row[]).map(row => String(row.user_id));
}

/**
 * The email to each person who joined the team in the assignment that just happened (not the one who assigned): who assigned it,
 * what it is, when it closes and what is expected first. Whoever turned the app's emails off in «Tu semana», has no address or has a
 * test one gets none, and a send that fails does not fail the assignment. OPPORTUNITY_ASSIGNMENT_EMAIL=off stops them all.
 */
export async function notifyNewParticipants(client: SupabaseClient, scope: WorkScope, id: string, before: string[],
  deps: { send?: Send; appUrl?: string; env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env;
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (env.OPPORTUNITY_ASSIGNMENT_EMAIL === 'off') return result;
  const known = new Set(before);
  const team = await readParticipantIds(client, scope, id);
  const newcomers = team.filter(user => !known.has(user) && user !== scope.userId);
  if (!newcomers.length) return result;
  const [item, work, people] = await Promise.all([
    client.from('commercial_opportunities').select('title,buyer_name,company_name,deadline_at').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle(),
    client.from('opportunity_work').select('objective,due_at,responsible_id').eq('organization_id', scope.organizationId).eq('opportunity_id', id).maybeSingle(),
    client.from('profiles').select('id,email,full_name,signatures').in('id', [...newcomers, scope.userId]),
  ]);
  const opportunity = item.data as Row | null;
  if (!opportunity || people.error) return { ...result, skipped: newcomers.length };
  const profiles = new Map(((people.data || []) as Row[]).map(row => [String(row.id), row]));
  const actor = profiles.get(scope.userId);
  const assignedBy = String(actor?.full_name || '').trim() || String(actor?.email || '').trim() || null;
  const appUrl = deps.appUrl ?? String(env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');
  const send: Send = deps.send ?? (input => sendReportEmail(client, input));
  for (const user of newcomers) {
    const profile = profiles.get(user);
    const to = String(profile?.email || '').trim();
    if (!to || isTestAddress(to) || !readAlertsEmail(profile?.signatures)) { result.skipped++; continue; }
    try {
      const email = assignmentEmail({
        name: String(profile?.full_name || '').trim(), assignedBy, opportunityId: id, title: String(opportunity.title || ''),
        buyer: String(opportunity.buyer_name || opportunity.company_name || '') || null, deadlineAt: opportunity.deadline_at ?? null,
        nextActionAt: work.data?.due_at ?? null, objective: String(work.data?.objective || ''), responsible: work.data?.responsible_id === user, appUrl,
      });
      const sent = await send({ userId: user, to, ...email });
      if (sent.ok) result.sent++; else result.failed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** The teams of several opportunities at once: read before and after a bulk assignment, to know who is new on each one. */
export async function readTeams(client: SupabaseClient, scope: WorkScope, ids: string[]): Promise<Map<string, string[]>> {
  const teams = new Map(ids.map(id => [id, [] as string[]]));
  if (!ids.length) return teams;
  const { data, error } = await client.from('opportunity_participants').select('opportunity_id,user_id').eq('organization_id', scope.organizationId).in('opportunity_id', ids).limit(5000);
  if (error) return teams;
  for (const row of (data || []) as Row[]) teams.get(String(row.opportunity_id))?.push(String(row.user_id));
  return teams;
}

/**
 * The emails of a bulk assignment: one per person who joined, with every opportunity they joined (the single email when it was one). The
 * same rules as notifyNewParticipants: not the one who assigned, not without an address, a test one or the emails turned off.
 */
export async function notifyBulkAssignment(client: SupabaseClient, scope: WorkScope, before: Map<string, string[]>,
  deps: { send?: Send; appUrl?: string; env?: Record<string, string | undefined> } = {}) {
  const env = deps.env ?? process.env;
  const result = { sent: 0, skipped: 0, failed: 0 };
  const ids = [...before.keys()];
  if (env.OPPORTUNITY_ASSIGNMENT_EMAIL === 'off' || !ids.length) return result;
  const after = await readTeams(client, scope, ids);
  const joined = new Map<string, string[]>();
  for (const id of ids) {
    const known = new Set(before.get(id) || []);
    for (const user of after.get(id) || []) if (!known.has(user) && user !== scope.userId) joined.set(user, [...(joined.get(user) || []), id]);
  }
  if (!joined.size) return result;
  const [items, works, people] = await Promise.all([
    client.from('commercial_opportunities').select('id,title,buyer_name,company_name,deadline_at').eq('organization_id', scope.organizationId).in('id', ids),
    client.from('opportunity_work').select('opportunity_id,objective,due_at,responsible_id').eq('organization_id', scope.organizationId).in('opportunity_id', ids),
    client.from('profiles').select('id,email,full_name,signatures').in('id', [...joined.keys(), scope.userId]),
  ]);
  if (items.error || people.error) return { ...result, skipped: joined.size };
  const byId = new Map(((items.data || []) as Row[]).map(row => [String(row.id), row]));
  const workOf = new Map(((works.data || []) as Row[]).map(row => [String(row.opportunity_id), row]));
  const profiles = new Map(((people.data || []) as Row[]).map(row => [String(row.id), row]));
  const actor = profiles.get(scope.userId);
  const assignedBy = String(actor?.full_name || '').trim() || String(actor?.email || '').trim() || null;
  const appUrl = deps.appUrl ?? String(env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_BASE_URL || 'https://app.antonia.ai');
  const send: Send = deps.send ?? (input => sendReportEmail(client, input));
  for (const [user, list] of joined) {
    const profile = profiles.get(user);
    const to = String(profile?.email || '').trim();
    const mine = list.flatMap(id => byId.has(id) ? [{ id, item: byId.get(id)!, work: workOf.get(id) }] : []);
    if (!to || isTestAddress(to) || !readAlertsEmail(profile?.signatures) || !mine.length) { result.skipped++; continue; }
    try {
      const name = String(profile?.full_name || '').trim();
      const email = mine.length === 1
        ? assignmentEmail({ name, assignedBy, opportunityId: mine[0].id, title: String(mine[0].item.title || ''), buyer: String(mine[0].item.buyer_name || mine[0].item.company_name || '') || null,
          deadlineAt: mine[0].item.deadline_at ?? null, nextActionAt: mine[0].work?.due_at ?? null, objective: String(mine[0].work?.objective || ''), responsible: mine[0].work?.responsible_id === user, appUrl })
        : assignmentDigestEmail({ name, assignedBy, appUrl, items: mine.map(({ id, item, work }) => ({ opportunityId: id, title: String(item.title || ''),
          buyer: String(item.buyer_name || item.company_name || '') || null, deadlineAt: item.deadline_at ?? null, responsible: work?.responsible_id === user })) });
      const sent = await send({ userId: user, to, ...email });
      if (sent.ok) result.sent++; else result.failed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { openDecision, type ActivityLike } from '@/lib/commercial-opportunities/member-work';
import type { WaitingItem } from '@/lib/commercial-opportunities/waiting';

export type { WaitingItem } from '@/lib/commercial-opportunities/waiting';
/** How far back a decision without an answer is still read as waiting. */
const DECISION_WINDOW_DAYS = 60;

/**
 * What waits for the administrators of a workspace on Oportunidades: decisions asked (or a proposal not to apply) with no answer yet, and
 * the opportunities blocked, the oldest first, with who asked and since when. What was closed meanwhile waits for nobody. The morning
 * alert reminds them every day (server/daily-alerts.ts) and «Hoy» shows it (api/home/opportunities). Throws when a read fails.
 */
export async function readWaitingOnAdmins(client: SupabaseClient, organizationId: string, now = new Date()): Promise<WaitingItem[]> {
  const after = new Date(now.getTime() - DECISION_WINDOW_DAYS * 86_400_000).toISOString();
  const [decisions, blocked]: any[] = await Promise.all([
    client.from('opportunity_activity').select('id,opportunity_id,kind,body,actor_id,created_at,data').eq('organization_id', organizationId).eq('kind', 'decision')
      .gte('created_at', after).order('created_at', { ascending: false }).limit(500),
    client.from('opportunity_work').select('opportunity_id,updated_at').eq('organization_id', organizationId).eq('state', 'blocked').limit(50),
  ]);
  if (decisions.error || blocked.error) throw new Error('No pudimos leer lo que espera respuesta.');
  const byOpportunity = new Map<string, ActivityLike[]>();
  for (const row of decisions.data || []) byOpportunity.set(String(row.opportunity_id), [...(byOpportunity.get(String(row.opportunity_id)) || []), row]);
  // The latest line of each opportunity decides whether its decision still waits (an answer closes it).
  const asked = [...byOpportunity].flatMap(([id, lines]) => {
    const open = openDecision([...lines].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    return open ? [{ id, kind: open.type, actorId: open.actorId ?? null, since: open.at, dueAt: open.dueAt }] : [];
  });
  // A blocked opportunity with a decision waiting is said once, as the decision.
  const stuck = ((blocked.data || []) as any[]).filter(row => !asked.some(item => item.id === String(row.opportunity_id)))
    .map(row => ({ id: String(row.opportunity_id), kind: 'blocked' as const, actorId: null as string | null, since: String(row.updated_at), dueAt: null as string | null }));
  const all = [...asked, ...stuck];
  if (!all.length) return [];
  const ids = [...new Set(all.map(item => item.id))];
  const actors = [...new Set(all.map(item => item.actorId).filter((id): id is string => Boolean(id)))];
  const [items, states, people]: any[] = await Promise.all([
    client.from('commercial_opportunities').select('id,title').eq('organization_id', organizationId).in('id', ids),
    client.from('opportunity_work').select('opportunity_id,state').eq('organization_id', organizationId).in('opportunity_id', ids),
    actors.length ? client.from('profiles').select('id,full_name,email').in('id', actors) : Promise.resolve({ data: [], error: null }),
  ]);
  if (items.error || states.error) throw new Error('No pudimos leer lo que espera respuesta.');
  const titleOf = new Map<string, string>(((items.data || []) as any[]).map(row => [String(row.id), String(row.title || 'Oportunidad')]));
  const stateOf = new Map<string, string>(((states.data || []) as any[]).map(row => [String(row.opportunity_id), String(row.state)]));
  const nameOf = new Map<string, string>((((people as any).data || []) as any[]).map(row => [String(row.id), String(row.full_name || '').trim().split(/\s+/)[0] || String(row.email || '').trim()]));
  return all.filter(item => titleOf.has(item.id) && !['won', 'lost', 'archived'].includes(stateOf.get(item.id) || ''))
    .sort((a, b) => a.since.localeCompare(b.since))
    .map(item => ({ id: item.id, title: titleOf.get(item.id)!.slice(0, 140), kind: item.kind, who: (item.actorId && nameOf.get(item.actorId)) || 'Alguien del equipo',
      since: item.since, dueAt: item.dueAt, actorId: item.actorId }));
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { canUseOpportunities } from '@/lib/server/commercial-opportunities/grants';
import { readWaitingOnAdmins } from '@/lib/server/commercial-opportunities/workspace-waiting';
import { isOpportunityAdmin, opportunityWorkspaceEnabled } from '@/lib/commercial-opportunities/workspace';
import { opportunitiesToday, type OpportunitiesToday } from '@/lib/home/opportunities-today';

const FINISHED = ['submitted', 'won', 'lost', 'archived'];

/**
 * What a person has to act on in Oportunidades today (src/lib/home/opportunities-today.ts), read with the service client: «Hoy» shows
 * it (api/home/opportunities) and the menu counts it (api/nav/pending). Null for whoever has no access to Oportunidades.
 */
export async function readHomeOpportunities(client: SupabaseClient, user: { id: string }, organizationId: string, now: Date): Promise<OpportunitiesToday | null> {
  if (!opportunityWorkspaceEnabled() || !(await canUseOpportunities(client, user as any, organizationId))) return null;
  const week = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [member, participations, reports, waiting, closing]: any[] = await Promise.all([
    client.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle(),
    client.from('opportunity_participants').select('opportunity_id').eq('organization_id', organizationId).eq('user_id', user.id).limit(500),
    client.from('opportunity_notifications').select('opportunity_id,title').eq('organization_id', organizationId).eq('user_id', user.id).eq('kind', 'report')
      .is('read_at', null).order('created_at', { ascending: false }).limit(10),
    readWaitingOnAdmins(client, organizationId, now).catch(() => []),
    client.from('commercial_opportunities').select('id,title,deadline_at').eq('organization_id', organizationId).eq('data->>evaluation', 'recommended')
      .gte('deadline_at', now.toISOString()).lt('deadline_at', week).order('deadline_at').limit(200),
  ]);
  if (member.error || participations.error || reports.error || closing.error) throw new Error('No pudimos leer tus oportunidades.');
  const admin = isOpportunityAdmin(member.data?.role);
  const mineIds = ((participations.data || []) as any[]).map(row => String(row.opportunity_id));
  const closingIds = admin ? ((closing.data || []) as any[]).map(row => String(row.id)) : [];
  const lookup = [...new Set([...mineIds, ...closingIds])];
  const [work, items]: any[] = lookup.length ? await Promise.all([
    client.from('opportunity_work').select('opportunity_id,state,due_at').eq('organization_id', organizationId).in('opportunity_id', lookup),
    mineIds.length ? client.from('commercial_opportunities').select('id,title,kind,deadline_at').eq('organization_id', organizationId).in('id', mineIds) : Promise.resolve({ data: [], error: null }),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (work.error || items.error) throw new Error('No pudimos leer tus oportunidades.');
  const workOf = new Map<string, any>(((work.data || []) as any[]).map(row => [String(row.opportunity_id), row]));
  return opportunitiesToday({
    now, admin, userId: user.id,
    mine: ((items.data || []) as any[]).filter(row => !FINISHED.includes(String(workOf.get(String(row.id))?.state || 'assigned')))
      .map(row => ({ id: String(row.id), title: String(row.title || 'Oportunidad'), kind: String(row.kind), deadlineAt: row.deadline_at ?? null, nextActionAt: workOf.get(String(row.id))?.due_at ?? null,
        state: String(workOf.get(String(row.id))?.state || 'assigned') })),
    // «Informe listo: …» (workspace-jobs.ts) or «Borrador de oferta listo: …» (workspace-offer.ts).
    reports: ((reports.data || []) as any[]).map(row => ({ id: String(row.opportunity_id), title: String(row.title || '').replace(/^(?:Informe (?:listo|disponible)|Borrador de oferta listo):\s*/, ''),
      offer: /^Borrador de oferta listo:/.test(String(row.title || '')) })),
    waiting,
    closingWithoutTeam: ((closing.data || []) as any[]).filter(row => { const state = workOf.get(String(row.id))?.state; return !state || state === 'unassigned'; })
      .map(row => ({ id: String(row.id), title: String(row.title || 'Oportunidad'), deadlineAt: String(row.deadline_at) })),
  });
}

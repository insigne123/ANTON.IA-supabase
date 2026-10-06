import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkSinceFrom, coworkSinceItems, type CoworkSince, type CoworkSinceInput } from '@/lib/cowork/since-visit';
import { readLinkedinAccepted } from './agenda-read';
import { coworkRunIsAutomatic } from './runs';

type Scope = { userId: string; organizationId: string };
type Rows = Array<Record<string, unknown>>;

const DAY_MS = 86_400_000;
const AUTOMATIC_REPLIES = new Set(['auto_reply', 'out_of_office']);
const MEETING = new Set(['meeting_request', 'meeting']);

/** The last time the person asked Cowork something: their latest own turn (the worker's continuations do not count). */
export async function readCoworkLastVisit(client: SupabaseClient, scope: Scope): Promise<string | null> {
  const { data, error } = await client.from('cowork_runs').select('created_at,parent_run_id,request_id')
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId).order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error('No se pudo leer tu última visita.');
  const own = ((data || []) as Array<{ created_at: string; parent_run_id: string | null; request_id: string | null }>).find(run => !coworkRunIsAutomatic(run));
  return own?.created_at ?? null;
}

export type CoworkSinceSources = {
  /** The person's own session: replies, research, runs and opportunities go through its row rules. */
  client: SupabaseClient;
  /** LinkedIn jobs are only readable by the worker's role (as in the overview's quota). */
  admin: () => SupabaseClient;
  opportunities: boolean;
};

/**
 * «Desde tu última visita» (Plan 12, 5): what arrived after the person's last own turn, up to two weeks back. Each source
 * is read on its own: one that fails is left out (never shown as zero). Null without a previous visit.
 */
export async function loadCoworkSinceLastVisit(sources: CoworkSinceSources, scope: Scope, nowMs = Date.now()): Promise<CoworkSince | null> {
  const last = await readCoworkLastVisit(sources.client, scope);
  if (!last) return null;
  const since = coworkSinceFrom(last, nowMs);
  const own = (table: string, columns: string) => sources.client.from(table).select(columns)
    .eq('organization_id', scope.organizationId).eq('user_id', scope.userId);
  const [replies, research, opportunities, linkedin] = await Promise.allSettled([
    own('contacted_leads', 'name,company,reply_intent,replied_at').gt('replied_at', since).order('replied_at', { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) throw error;
        return ((data || []) as unknown as Rows).filter(row => !AUTOMATIC_REPLIES.has(String(row.reply_intent || '')))
          .map(row => ({ name: (row.name as string | null) ?? null, company: (row.company as string | null) ?? null, meeting: MEETING.has(String(row.reply_intent || '')) }));
      }),
    own('lead_research_jobs', 'lead_id,company_name,status,completed_at').in('status', ['completed', 'partial']).gt('completed_at', since)
      .order('completed_at', { ascending: false }).limit(20)
      .then(async ({ data, error }) => {
        if (error) throw error;
        const rows = (data || []) as unknown as Rows;
        const ids = [...new Set(rows.map(row => String(row.lead_id || '')).filter(Boolean))];
        const names = new Map<string, string | null>();
        if (ids.length) {
          const leads = await own('leads', 'id,name').in('id', ids);
          for (const lead of ((leads.data || []) as unknown as Rows)) names.set(String(lead.id), (lead.name as string | null) ?? null);
        }
        return rows.map(row => ({ name: names.get(String(row.lead_id || '')) ?? null, company: (row.company_name as string | null) ?? null }));
      }),
    sources.opportunities
      ? sources.client.from('commercial_opportunities').select('kind,status').eq('organization_id', scope.organizationId)
        .neq('status', 'dismissed').gt('first_seen_at', since).limit(300)
        .then(({ data, error }) => {
          if (error) throw error;
          const rows = (data || []) as unknown as Rows;
          const count = (...kinds: string[]) => rows.filter(row => kinds.includes(String(row.kind))).length;
          return { tenders: count('tender', 'compra_agil'), hiring: count('hiring'), projects: count('project') };
        })
      : Promise.resolve(null),
    Promise.resolve().then(() => readLinkedinAccepted(sources.admin(), scope, nowMs)).then(result => {
      if (result.status !== 'ok') return null;
      const days = Math.max(0, Math.floor((nowMs - Date.parse(since)) / DAY_MS));
      return result.accepted.filter(person => person.daysSince <= days).map(person => ({ name: person.name }));
    }),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>) => (result.status === 'fulfilled' ? result.value : null);
  const input: CoworkSinceInput = { replies: value(replies), research: value(research), opportunities: value(opportunities), linkedin: value(linkedin) };
  return { at: last, items: coworkSinceItems(input) };
}

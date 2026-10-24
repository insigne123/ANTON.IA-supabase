import type { SupabaseClient } from '@supabase/supabase-js';
import { sourceHealth, type SourceHealth, type SourceRun } from '@/lib/commercial-opportunities/source-health';

/** The days of search read for the strip: enough to say «3 días seguidos». */
const DAYS = 5;
export type SearchHealth = { sources: SourceHealth[]; ticket: 'own' | 'shared' };

/**
 * How the daily search went, per source (source-health.ts), and whose Mercado Público ticket it runs on: a member's own («own») or the
 * one ANTON.IA shares with every workspace («shared»: one quota and one point of failure for all). A tenders job with a keyword is a
 * Compra Ágil search. Throws when the jobs cannot be read; a failed read of the tickets says «shared», which only invites to connect one.
 */
export async function readSearchHealth(client: SupabaseClient, organizationId: string, now = new Date()): Promise<SearchHealth> {
  const since = new Date(now.getTime() - DAYS * 86_400_000).toISOString();
  const [jobs, members]: any[] = await Promise.all([
    client.from('opportunity_jobs').select('kind,state,error,created_at,updated_at,keyword:payload->>keyword').eq('organization_id', organizationId)
      .in('kind', ['tenders', 'posts', 'hiring']).gte('created_at', since).order('created_at', { ascending: false }).limit(400),
    client.from('organization_members').select('user_id').eq('organization_id', organizationId).limit(1000),
  ]);
  if (jobs.error) throw new Error('No pudimos leer las búsquedas.');
  const runs: SourceRun[] = ((jobs.data || []) as any[]).map(row => ({
    source: row.kind === 'tenders' ? (row.keyword ? 'compraAgil' : 'tenders') : row.kind === 'posts' ? 'posts' : 'hiring',
    state: String(row.state), error: row.error ?? null, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
  const ids = ((members.data || []) as any[]).map(row => String(row.user_id));
  const tickets: any = ids.length && !members.error ? await client.from('commercial_opportunity_tickets').select('user_id').in('user_id', ids).is('last_error', null).limit(1) : { data: [] };
  return { sources: sourceHealth(runs, now), ticket: !tickets.error && (tickets.data || []).length ? 'own' : 'shared' };
}

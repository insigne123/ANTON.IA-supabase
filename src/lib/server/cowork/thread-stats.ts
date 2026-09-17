import type { SupabaseClient } from '@supabase/supabase-js';

type Scope = { userId: string; organizationId: string };

export type CoworkThreadStats = {
  /** Current run plus automatic-chain ancestors (stops at the user run that started the chain). */
  runIds: string[];
  depth: number;
  effects: number;
  searches: number;
  drafts: number;
};

const ACTIVE_EFFECT = ['approved', 'executing', 'executed'];
const ACTIVE_SEARCH = ['approved', 'executing', 'completed'];
const ACTIVE_DRAFT = ['pending', 'executing', 'completed'];

async function countIn(client: SupabaseClient, table: string, runIds: string[], statuses: string[]) {
  if (runIds.length === 0) return 0;
  const { data, error } = await client.from(table).select('run_id').in('run_id', runIds).in('status', statuses);
  if (error) throw error;
  return (data || []).length;
}

/** Walk the automatic chain and count durable work. Bounded and cycle-safe;
 * throws fail-closed on unreadable ancestry. */
export async function loadCoworkThreadStats(
  client: SupabaseClient, scope: Scope, runId: string,
): Promise<CoworkThreadStats> {
  const runIds: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = runId;
  let depth = 0;
  for (let step = 0; step < 12 && cursor; step++) {
    if (seen.has(cursor)) throw new Error('Invalid thread ancestry');
    seen.add(cursor);
    const { data: run, error }: { data: { id: string; parent_run_id: string | null; depth: number | null } | null; error: unknown } = await client.from('cowork_runs')
      .select('id,parent_run_id,depth').eq('id', cursor)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (error || !run) throw new Error('Thread ancestry unavailable');
    runIds.push(run.id);
    const runDepth = run.depth || 0;
    if (step === 0) depth = runDepth;
    cursor = run.parent_run_id || null;
    if (runDepth <= 0) break;
  }
  const [effects, searches, drafts] = await Promise.all([
    countIn(client, 'cowork_effect_proposals', runIds, ACTIVE_EFFECT),
    countIn(client, 'cowork_search_proposals', runIds, ACTIVE_SEARCH),
    countIn(client, 'cowork_draft_requests', runIds, ACTIVE_DRAFT),
  ]);
  return { runIds, depth, effects, searches, drafts };
}

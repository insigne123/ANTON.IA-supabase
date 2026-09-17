import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkDocumentSchema } from '@/lib/cowork/contracts';

export async function loadCoworkHistory(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  parentId: string | null,
) {
  const history: Array<{ runId: string; request: string; reply: string; document: { title: string; content: string } | null; observations: unknown[] }> = [];
  const visited = new Set<string>();
  let remaining = 60000;
  let cursor = parentId;
  while (cursor && history.length < 8 && remaining > 0) {
    if (visited.has(cursor)) throw new Error('Invalid conversation ancestry');
    visited.add(cursor);
    const { data: run, error } = await client.from('cowork_runs')
      .select('id,message,parent_run_id,status').eq('id', cursor)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (error || !run || run.status !== 'completed') throw new Error('Conversation context unavailable');
    const event = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'run.completed').order('sequence', { ascending: false }).limit(1).maybeSingle();
    if (event.error || !event.data) throw new Error('Conversation result unavailable');
    const result = coworkDocumentSchema.parse({ reply: event.data.payload.reply, document: event.data.payload.document });
    // Most recent observations first for the query cap, then back to
    // chronological order: a resumed run must see the latest tool result
    // (for example a completed external search), not only the oldest reads.
    const observed = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'tool.completed').order('sequence', { ascending: false }).limit(3);
    if (observed.error) throw new Error('Conversation observations unavailable');
    const observedPayloads = ((observed.data || []) as Array<{ payload: unknown }>)
      .map((row: { payload: unknown }) => row.payload).reverse();
    const turn = { runId: cursor, request: run.message, ...result, observations: observedPayloads };
    const size = JSON.stringify(turn).length;
    if (size > remaining) {
      // Preserve the immediate parent rather than silently editing a truncated document.
      if (history.length === 0) throw new Error('Previous result exceeds context budget');
      break;
    }
    history.unshift(turn);
    remaining -= size;
    cursor = run.parent_run_id;
  }
  return { turns: history, olderTurnsOmitted: Boolean(cursor) };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, coworkDocumentSchema, coworkStoredBlocks, type CoworkBlock } from '@/lib/cowork/contracts';

export async function loadCoworkHistory(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  parentId: string | null,
) {
  const history: Array<{ runId: string; at: string | null; request: string; reply: string; document: { title: string; content: string } | null; blocks?: CoworkBlock[]; observations: unknown[]; actions?: Array<{ kind: string; label: string; outcome: string; result?: unknown }> }> = [];
  const visited = new Set<string>();
  let remaining = 60000;
  let cursor = parentId;
  while (cursor && history.length < 8 && remaining > 0) {
    if (visited.has(cursor)) throw new Error('Invalid conversation ancestry');
    visited.add(cursor);
    const { data: run, error } = await client.from('cowork_runs')
      .select('id,message,parent_run_id,status,created_at').eq('id', cursor)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (error || !run || run.status !== 'completed') throw new Error('Conversation context unavailable');
    const event = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'run.completed').order('sequence', { ascending: false }).limit(1).maybeSingle();
    if (event.error || !event.data) throw new Error('Conversation result unavailable');
    const result = coworkDocumentSchema.parse({ reply: event.data.payload.reply, document: event.data.payload.document });
    // The cards of that answer (emails, sequences, tables): «usa el segundo correo» refers to them.
    const blocks = coworkStoredBlocks(event.data.payload.blocks);
    // Most recent observations first for the query cap, then back to
    // chronological order: a resumed run must see the latest tool result
    // (for example a completed external search), not only the oldest reads.
    const observed = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'tool.completed').order('sequence', { ascending: false }).limit(5);
    if (observed.error) throw new Error('Conversation observations unavailable');
    // Up to three data reads plus the assistant's note that accompanied a proposal.
    // The plan shown while it worked is not context: the reply already says what was done.
    const newestFirst = ((observed.data || []) as Array<{ payload: unknown }>).map((row: { payload: unknown }) => row.payload)
      .filter(payload => (payload as { action?: unknown } | null)?.action !== COWORK_PLAN_ACTION);
    const isNote = (payload: unknown) => (payload as { action?: unknown } | null)?.action === COWORK_NOTE_ACTION;
    const reads = newestFirst.filter(payload => !isNote(payload)).slice(0, 3);
    const observedPayloads = newestFirst.filter(payload => isNote(payload) || reads.includes(payload)).reverse();
    // Actions approved in that turn and how they ended, so the model never
    // re-proposes something that already ran (for example a failed email lookup).
    const acted = await client.from('cowork_run_events').select('kind,payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .in('kind', ['effect.completed', 'effect.failed']).order('sequence', { ascending: false }).limit(2);
    const actions = acted.error ? [] : ((acted.data || []) as Array<{ kind: string; payload: Record<string, unknown> | null }>).map(row => ({
      kind: String(row.payload?.kind || ''), label: String(row.payload?.label || '').slice(0, 200),
      outcome: row.kind === 'effect.completed' ? 'ejecutada' : 'falló',
      ...(row.payload?.result === undefined ? {} : { result: row.payload.result }),
    })).reverse();
    const turn = { runId: cursor, at: typeof run.created_at === 'string' ? run.created_at : null, request: run.message, reply: result.reply, document: result.document,
      ...(blocks.length ? { blocks } : {}), observations: observedPayloads, ...(actions.length ? { actions } : {}) };
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

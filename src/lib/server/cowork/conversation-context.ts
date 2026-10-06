import type { SupabaseClient } from '@supabase/supabase-js';
import { COWORK_AGENT_ACTION, COWORK_NOTE_ACTION, COWORK_PLAN_ACTION, coworkDocumentSchema, coworkStoredBlocks, type CoworkBlock } from '@/lib/cowork/contracts';

type HistoryTurn = { runId: string; at: string | null; request: string; reply: string; document: { title: string; content: string } | null; blocks?: CoworkBlock[]; observations: unknown[]; actions?: Array<{ kind: string; label: string; outcome: string; result?: unknown }>;
  /** The code artifacts of that turn (Plan 12): «cámbiale el gráfico» refers to them by file name. */
  artifacts?: Array<{ name: string; title: string }> };

/**
 * The parent turn with its long lists cut to their first rows, each saying how many it left out (itemsOmitted), or null
 * when even without rows it does not fit. A search of 100 people must not cost the next turn its parent.
 */
function trimTurnLists(turn: HistoryTurn, budget: number): HistoryTurn | null {
  const cut = (keep: number): HistoryTurn => ({ ...turn, observations: turn.observations.map(observation => {
    const payload = observation as Record<string, unknown> | null;
    const result = payload?.result as Record<string, unknown> | null | undefined;
    if (!payload || !result || typeof result !== 'object' || !Array.isArray(result.items) || result.items.length <= keep) return observation;
    return { ...payload, result: { ...result, items: result.items.slice(0, keep), itemsOmitted: result.items.length - keep } };
  }) });
  const longest = Math.max(0, ...turn.observations.map(observation => {
    const items = ((observation as { result?: { items?: unknown } } | null)?.result)?.items;
    return Array.isArray(items) ? items.length : 0;
  }));
  let best: HistoryTurn | null = null;
  for (let low = 0, high = longest; low <= high;) {
    const keep = Math.floor((low + high) / 2);
    const candidate = cut(keep);
    if (JSON.stringify(candidate).length <= budget) { best = candidate; low = keep + 1; } else high = keep - 1;
  }
  return best;
}

export async function loadCoworkHistory(
  client: SupabaseClient,
  scope: { userId: string; organizationId: string },
  parentId: string | null,
) {
  const history: HistoryTurn[] = [];
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
      .eq('kind', 'tool.completed').order('sequence', { ascending: false }).limit(12);
    if (observed.error) throw new Error('Conversation observations unavailable');
    // Up to three data reads plus the assistant's note that accompanied a proposal.
    // The plan and what the Writer and the Reviewer did are not context: the reply already
    // says what was done (the limit leaves room for them in a turn that wrote).
    const newestFirst = ((observed.data || []) as Array<{ payload: unknown }>).map((row: { payload: unknown }) => row.payload)
      .filter(payload => { const action = (payload as { action?: unknown } | null)?.action; return action !== COWORK_PLAN_ACTION && action !== COWORK_AGENT_ACTION; });
    const isNote = (payload: unknown) => (payload as { action?: unknown } | null)?.action === COWORK_NOTE_ACTION;
    const reads = newestFirst.filter(payload => !isNote(payload)).slice(0, 3);
    const observedPayloads = newestFirst.filter(payload => isNote(payload) || reads.includes(payload)).reverse();
    // Actions approved in that turn and how they ended, so the model never
    // re-proposes something that already ran (for example a failed email lookup).
    const acted = await client.from('cowork_run_events').select('kind,payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .in('kind', ['effect.completed', 'effect.failed']).order('sequence', { ascending: false }).limit(2);
    const effects = acted.error ? [] : ((acted.data || []) as Array<{ kind: string; payload: Record<string, unknown> | null }>).map(row => ({
      kind: String(row.payload?.kind || ''), label: String(row.payload?.label || '').slice(0, 200),
      outcome: row.kind === 'effect.completed' ? 'ejecutada' : 'falló',
      ...(row.payload?.result === undefined ? {} : { result: row.payload.result }),
    })).reverse();
    // Contacts the person saved from the panel of that turn: done, so they are never proposed for saving again.
    const panel = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'contact.saved').order('sequence', { ascending: true }).limit(25);
    const saved = panel.error ? [] : ((panel.data || []) as Array<{ payload: Record<string, unknown> | null }>)
      .filter(row => typeof row.payload?.leadId === 'string' && row.payload.leadId).map(row => {
      const who = [row.payload?.name, row.payload?.company].filter(value => typeof value === 'string' && value).join(' · ');
      return { kind: 'save_contact', label: `Guardaste desde el panel a ${who || 'un contacto'}`.slice(0, 200), outcome: 'ejecutada',
        result: { leadId: row.payload?.leadId ?? null, providerId: row.payload?.providerId ?? null, reused: row.payload?.reused === true } };
    });
    const actions = [...effects, ...saved];
    const made = await client.from('cowork_run_events').select('payload')
      .eq('run_id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .eq('kind', 'artifact.created').order('sequence', { ascending: true }).limit(5);
    const artifacts = made.error ? [] : ((made.data || []) as Array<{ payload: Record<string, unknown> | null }>)
      .filter(row => row.payload?.kind === 'code' && typeof row.payload.name === 'string')
      .map(row => ({ name: String(row.payload!.name), title: String(row.payload!.title || row.payload!.name).slice(0, 120) }));
    let turn: HistoryTurn = { runId: cursor, at: typeof run.created_at === 'string' ? run.created_at : null, request: run.message, reply: result.reply, document: result.document,
      ...(blocks.length ? { blocks } : {}), observations: observedPayloads, ...(actions.length ? { actions } : {}),
      ...(artifacts.length ? { artifacts } : {}) };
    let size = JSON.stringify(turn).length;
    if (size > remaining) {
      if (history.length > 0) break;
      // Preserve the immediate parent rather than silently editing a truncated document: only its lists get shorter.
      const trimmed = trimTurnLists(turn, remaining);
      if (!trimmed) throw new Error('Previous result exceeds context budget');
      turn = trimmed;
      size = JSON.stringify(turn).length;
    }
    history.unshift(turn);
    remaining -= size;
    cursor = run.parent_run_id;
  }
  return { turns: history, olderTurnsOmitted: Boolean(cursor) };
}

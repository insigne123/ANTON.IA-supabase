import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkAnswerFeedback, coworkVersionExcerpt, COWORK_PREVIOUS_VERSIONS_MAX, type CoworkAnswerFeedback, type CoworkPreviousVersion } from '@/lib/cowork/previous-versions';
import { COWORK_FEEDBACK_EVENT } from '@/lib/cowork/turn-actions';
import { coworkRunIsAutomatic } from './runs';

type Scope = { userId: string; organizationId: string };
type Run = { id: string; message: string; parent_run_id?: string | null; created_at?: string | null };
type Row = { id: string; message: string; parent_run_id: string | null; request_id: string | null; created_at: string };

/** «Otra versión» of the first message starts the conversation anew and hides the previous one at once: within this window. */
export const COWORK_ROOT_VERSION_WINDOW_MS = 60 * 60_000;

const own = (client: SupabaseClient, table: string, fields: string, scope: Scope) =>
  client.from(table).select(fields).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);

/**
 * The earlier answers to this same message, newest first, with what the person said about them. A version is a finished run the
 * person sent with the same text after the same answer (another version from the chat, Plan 13). For the first message of a
 * conversation, whose new version starts a new conversation, it is one with the same text that the person replaced within the
 * hour (its conversation was hidden). Best effort: any failure leaves the turn without them.
 */
export async function loadCoworkPreviousVersions(client: SupabaseClient, scope: Scope, run: Run, now = Date.now()): Promise<CoworkPreviousVersion[]> {
  try {
    const before = run.created_at || new Date(now).toISOString();
    let query = own(client, 'cowork_runs', 'id,message,parent_run_id,request_id,created_at', scope)
      .eq('status', 'completed').eq('message', run.message).neq('id', run.id).lt('created_at', before);
    if (run.parent_run_id) query = query.eq('parent_run_id', run.parent_run_id);
    else query = query.is('parent_run_id', null).gte('created_at', new Date(Date.parse(before) - COWORK_ROOT_VERSION_WINDOW_MS).toISOString());
    const { data, error } = await query.order('created_at', { ascending: false }).limit(COWORK_PREVIOUS_VERSIONS_MAX * 2);
    if (error || !Array.isArray(data)) return [];
    let versions = (data as unknown as Row[]).filter(row => !coworkRunIsAutomatic(row));
    if (!run.parent_run_id && versions.length) {
      // A first message asked again hides the conversation it replaces; the same question in a conversation still listed is not a version.
      const hidden = await own(client, 'cowork_thread_settings', 'root_run_id,hidden_at', scope).in('root_run_id', versions.map(row => row.id));
      if (hidden.error) return [];
      const replaced = new Set(((hidden.data || []) as unknown as Array<{ root_run_id: string; hidden_at: string | null }>).filter(row => row.hidden_at).map(row => row.root_run_id));
      versions = versions.filter(row => replaced.has(row.id));
    }
    versions = versions.slice(0, COWORK_PREVIOUS_VERSIONS_MAX);
    if (!versions.length) return [];
    const events = await own(client, 'cowork_run_events', 'run_id,kind,payload,sequence', scope)
      .in('run_id', versions.map(row => row.id)).in('kind', ['run.completed', COWORK_FEEDBACK_EVENT]).order('sequence', { ascending: true });
    if (events.error) return [];
    const byRun = new Map<string, Array<{ kind: string; payload: unknown }>>();
    for (const event of (events.data || []) as unknown as Array<{ run_id: string; kind: string; payload: unknown }>) {
      byRun.set(event.run_id, [...(byRun.get(event.run_id) || []), event]);
    }
    return versions.flatMap(row => {
      const recorded = byRun.get(row.id) || [];
      const completed = recorded.filter(event => event.kind === 'run.completed').at(-1)?.payload as { reply?: unknown } | undefined;
      const reply = typeof completed?.reply === 'string' ? coworkVersionExcerpt(completed.reply) : '';
      return reply ? [{ reply, feedback: coworkAnswerFeedback(recorded) }] : [];
    });
  } catch {
    return [];
  }
}

/** What the person said about each answer of the history, by run: one read for all of them. Best effort. */
export async function loadCoworkHistoryFeedback(client: SupabaseClient, scope: Scope, runIds: string[]): Promise<Map<string, CoworkAnswerFeedback>> {
  const found = new Map<string, CoworkAnswerFeedback>();
  if (!runIds.length) return found;
  try {
    const { data, error } = await own(client, 'cowork_run_events', 'run_id,kind,payload,sequence', scope)
      .in('run_id', runIds).eq('kind', COWORK_FEEDBACK_EVENT).order('sequence', { ascending: true });
    if (error || !Array.isArray(data)) return found;
    const byRun = new Map<string, Array<{ kind: string; payload: unknown }>>();
    for (const event of data as unknown as Array<{ run_id: string; kind: string; payload: unknown }>) byRun.set(event.run_id, [...(byRun.get(event.run_id) || []), event]);
    for (const [runId, events] of byRun) {
      const feedback = coworkAnswerFeedback(events);
      if (feedback) found.set(runId, feedback);
    }
  } catch { /* the turn goes on without it */ }
  return found;
}

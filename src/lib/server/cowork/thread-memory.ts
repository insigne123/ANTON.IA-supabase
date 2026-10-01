import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkThreadMemorySchema, readCoworkThreadMemory, type CoworkThreadMemory } from '@/lib/cowork/thread-memory';

/**
 * The memory of a conversation in cowork_thread_memory (migration 20261001230000), one row per conversation (its first run).
 * Best effort on both sides: without the table, the row or the root of the run (migration 20261001220000), a turn works as before.
 */

type Scope = { userId: string; organizationId: string };
type Run = { id: string; message: string; root_run_id?: string | null; created_at?: string | null };

/** The first request of the conversation (when this is not that turn) and the latest memory, for the next decision. */
export async function loadCoworkThreadMemory(client: SupabaseClient, scope: Scope, run: Run) {
  const rootId = run.root_run_id || null;
  if (!rootId) return { firstRequest: null, memory: null };
  const own = (table: string, fields: string) => client.from(table).select(fields).eq('user_id', scope.userId).eq('organization_id', scope.organizationId);
  const [root, stored] = await Promise.all([
    rootId === run.id ? null : own('cowork_runs', 'message').eq('id', rootId).maybeSingle(),
    own('cowork_thread_memory', 'memory').eq('root_run_id', rootId).maybeSingle(),
  ]);
  const message = (root?.data as { message?: unknown } | null)?.message;
  return {
    firstRequest: !root || root.error || typeof message !== 'string' ? null : message,
    memory: stored.error ? null : readCoworkThreadMemory((stored.data as { memory?: unknown } | null)?.memory),
  };
}

/** Keep the memory a turn wrote, unless a later turn of the same conversation already wrote one. Never throws. */
export async function saveCoworkThreadMemory(client: SupabaseClient, scope: Scope, run: Run, memory: CoworkThreadMemory) {
  try {
    const rootId = run.root_run_id || null;
    if (!rootId) return false;
    const parsed = coworkThreadMemorySchema.parse(memory);
    const writtenAt = run.created_at || new Date().toISOString();
    const existing = await client.from('cowork_thread_memory').select('source_created_at').eq('root_run_id', rootId)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error) return false;
    const newer = (existing.data as { source_created_at?: string } | null)?.source_created_at;
    if (newer && Date.parse(newer) > Date.parse(writtenAt)) return false;
    const saved = await client.from('cowork_thread_memory').upsert({
      root_run_id: rootId, user_id: scope.userId, organization_id: scope.organizationId, memory: parsed,
      source_run_id: run.id, source_created_at: writtenAt, updated_at: new Date().toISOString(),
    }, { onConflict: 'root_run_id' });
    return !saved.error;
  } catch {
    return false;
  }
}

/** The product the person asked to promote in the conversation of a run (its memory), or null. Never throws. */
export async function loadCoworkOfferInPlay(client: SupabaseClient, scope: Scope, runId: string): Promise<string | null> {
  try {
    const run = await client.from('cowork_runs').select('id,root_run_id').eq('id', runId)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (run.error || !run.data) return null;
    const { memory } = await loadCoworkThreadMemory(client, scope, run.data as Run);
    return memory?.offer || null;
  } catch {
    return null;
  }
}

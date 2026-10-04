import { z } from 'zod';
import { COWORK_ACTIVE_STATUSES } from '@/lib/cowork/presentation';

/**
 * Rename and hide Cowork conversations (Plan 9, PR-20) on cowork_thread_settings: one row per conversation, keyed by its
 * first run (root_run_id). The owner reads their rows with their session; only the server writes, with the service role,
 * after checking that the conversation is theirs, is a root, and (to hide it) is not running. «Eliminar» hides, so
 * «Deshacer» brings it back; nothing is deleted. Until the table exists every read answers «unavailable» and the app
 * lists conversations as before.
 */
export const COWORK_THREAD_TITLE_MAX = 120;

type Client = { from: (table: string) => any };
type Scope = { userId: string; organizationId: string };

export type CoworkThreadSettings = { available: boolean; hiddenRootIds: string[]; titles: Record<string, string> };
export type CoworkThreadSetting = { rootRunId: string; title: string | null; hiddenAt: string | null };

export class CoworkThreadError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'ACTIVE' | 'UNAVAILABLE') { super(code); }
}

/** The table is not there yet (PostgREST «could not find the table» or Postgres «undefined table»). */
export function isMissingThreadSettingsTable(error: unknown) {
  const { code, message } = (error || {}) as { code?: string; message?: string };
  return code === 'PGRST205' || code === '42P01' || /cowork_thread_settings/.test(String(message || '')) && /(does not exist|could not find)/i.test(String(message || ''));
}

export const coworkThreadChangeSchema = z.object({
  title: z.string().max(400).nullable().optional(),
  hidden: z.boolean().optional(),
}).strict().refine((change) => change.title !== undefined || change.hidden !== undefined, { message: 'Nada que cambiar' });

/** A name as it is stored: spaces collapsed and trimmed, at most 120 characters; empty goes back to the first message. */
export function normalizeCoworkThreadTitle(value: string | null | undefined): string | null {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  if (title.length > COWORK_THREAD_TITLE_MAX) throw new z.ZodError([{ code: 'too_big', maximum: COWORK_THREAD_TITLE_MAX, type: 'string', inclusive: true, path: ['title'], message: `Usa hasta ${COWORK_THREAD_TITLE_MAX} caracteres.` }]);
  return title;
}

/** The person's names and hidden conversations, read with their own session (RLS: own rows, with Cowork access). */
export async function readCoworkThreadSettings(client: Client, scope: Scope): Promise<CoworkThreadSettings> {
  const { data, error } = await client.from('cowork_thread_settings')
    .select('root_run_id,title,hidden_at')
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
    .order('updated_at', { ascending: false }).limit(1000);
  if (error) {
    if (isMissingThreadSettingsTable(error)) return { available: false, hiddenRootIds: [], titles: {} };
    throw error;
  }
  const hiddenRootIds: string[] = [];
  const titles: Record<string, string> = {};
  for (const row of (data || []) as Array<{ root_run_id: string; title: string | null; hidden_at: string | null }>) {
    if (row.hidden_at) hiddenRootIds.push(row.root_run_id);
    if (row.title) titles[row.root_run_id] = row.title;
  }
  return { available: true, hiddenRootIds, titles };
}

/** Renames or hides one conversation. `client` is the person's session (ownership checks); `admin` writes the row. */
export async function updateCoworkThread(client: Client, admin: Client, scope: Scope, rootRunId: string, input: unknown, now = new Date()): Promise<CoworkThreadSetting> {
  z.string().uuid().parse(rootRunId);
  const change = coworkThreadChangeSchema.parse(input);
  const title = change.title === undefined ? undefined : normalizeCoworkThreadTitle(change.title);

  const { data: root, error: rootError } = await client.from('cowork_runs')
    .select('id,root_run_id').eq('id', rootRunId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (rootError) throw rootError;
  if (!root || (root.root_run_id && root.root_run_id !== root.id)) throw new CoworkThreadError('NOT_FOUND');

  if (change.hidden === true) {
    const { count, error: activeError } = await client.from('cowork_runs')
      .select('id', { count: 'exact', head: true })
      .eq('root_run_id', rootRunId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId)
      .in('status', [...COWORK_ACTIVE_STATUSES]);
    if (activeError) throw activeError;
    if ((count || 0) > 0) throw new CoworkThreadError('ACTIVE');
  }

  const row: Record<string, unknown> = {
    root_run_id: rootRunId, user_id: scope.userId, organization_id: scope.organizationId, updated_at: now.toISOString(),
  };
  if (title !== undefined) row.title = title;
  if (change.hidden !== undefined) row.hidden_at = change.hidden ? now.toISOString() : null;
  const { data, error } = await admin.from('cowork_thread_settings')
    .upsert(row, { onConflict: 'root_run_id' })
    .select('root_run_id,title,hidden_at').single();
  if (error) {
    if (isMissingThreadSettingsTable(error)) throw new CoworkThreadError('UNAVAILABLE');
    throw error;
  }
  return { rootRunId: data.root_run_id, title: data.title ?? null, hiddenAt: data.hidden_at ?? null };
}

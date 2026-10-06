import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkPreferenceKey, coworkPreferenceLabel, coworkPreferenceSchema, type CoworkPreference } from '@/lib/cowork/preference-proposal';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';

type Scope = { userId: string; organizationId: string };
/** What the memory keeps: the sentence the card showed and the turn that proposed it (so a retried turn does not store it twice). */
type PreferenceValue = { text?: unknown; runId?: unknown };

/** Remembering preferences with a card (Plan 12, 5). Off unless COWORK_PREFERENCES_ENABLED=true: it needs the «memory_save»
 * effect in the database (migration 20261006160000). */
export function coworkPreferencesEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_PREFERENCES_ENABLED === 'true';
}

export const COWORK_PREFERENCE_MEMORY_TYPE = 'cowork_preference';

export function parseCoworkPreferenceTarget(targetId: string) {
  const match = /^memory:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(targetId || ''));
  if (!match) throw new Error('La preferencia propuesta no es válida.');
  return { memoryId: match[1].toLowerCase() };
}

/**
 * Stages the preference as a «proposed» memory, which no turn reads (user-context.ts reads only «approved» ones), and returns the
 * target and the card's line. One per turn: the same turn retried finds its own memory; another preference in it is refused.
 */
export async function stageCoworkPreference(scope: Scope, runId: string, input: CoworkPreference) {
  const preference = coworkPreferenceSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const text = preference.text.trim();
  const existing = await client.from('suplia_memories').select('id,value')
    .eq('organization_id', scope.organizationId).eq('memory_type', COWORK_PREFERENCE_MEMORY_TYPE)
    .eq('value->>runId', runId).limit(1).maybeSingle();
  if (existing.error) throw new Error('No se pudo preparar la preferencia.');
  if (existing.data) {
    if ((existing.data.value as PreferenceValue | null)?.text !== text) throw new Error('Este trabajo ya propuso otra preferencia.');
    return { targetId: `memory:${existing.data.id}`, label: coworkPreferenceLabel(preference) };
  }
  const inserted = await client.from('suplia_memories').insert({
    organization_id: scope.organizationId,
    // A personal preference is read only in this person's turns; one for the organization, in the whole team's.
    user_id: scope.userId,
    scope: preference.scope === 'organization' ? 'organization' : 'user',
    memory_type: COWORK_PREFERENCE_MEMORY_TYPE,
    key: coworkPreferenceKey(text),
    value: { text, runId },
    confidence: 1,
    status: 'proposed',
  }).select('id').single();
  if (inserted.error || !inserted.data) throw new Error('No se pudo preparar la preferencia.');
  return { targetId: `memory:${inserted.data.id}`, label: coworkPreferenceLabel(preference) };
}

/** Approving the card: the staged memory becomes «approved» and the next turn reads it. Approving twice is harmless. */
export async function executeCoworkPreferenceSave(auth: AuthContext, runId: string, targetId: string) {
  const { memoryId } = parseCoworkPreferenceTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const row = await client.from('suplia_memories').select('id,scope,user_id,status,value')
    .eq('id', memoryId).eq('organization_id', scope.organizationId).eq('memory_type', COWORK_PREFERENCE_MEMORY_TYPE).maybeSingle();
  if (row.error || !row.data) throw new Error('La preferencia aprobada ya no está disponible.');
  const value = row.data.value as PreferenceValue | null;
  // Only the turn that proposed it, and only its author's (or the organization's) preference.
  if (value?.runId !== runId || (row.data.scope !== 'organization' && row.data.user_id !== scope.userId)) {
    throw new Error('La preferencia aprobada ya no está disponible.');
  }
  const text = typeof value?.text === 'string' ? value.text : '';
  if (row.data.status !== 'approved') {
    if (row.data.status !== 'proposed') throw new Error('La preferencia ya no está disponible.');
    const now = new Date().toISOString();
    const updated = await client.from('suplia_memories')
      .update({ status: 'approved', approved_by: scope.userId, approved_at: now, updated_at: now })
      .eq('id', memoryId).eq('organization_id', scope.organizationId).eq('status', 'proposed')
      .select('id').maybeSingle();
    if (updated.error || !updated.data) throw new Error('No se pudo guardar la preferencia. Inténtalo de nuevo.');
  }
  const who = row.data.scope === 'organization' ? 'en los trabajos de todo tu equipo' : 'en tus próximos trabajos';
  return { reply: `Listo: lo tendré en cuenta ${who}: «${text}».`, result: { memoryId, scope: row.data.scope } };
}

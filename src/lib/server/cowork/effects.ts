import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { saveCoworkContact } from './save-contact';
import { startCoworkResearch } from './start-research';
import { requestCoworkDraft } from './draft-from-research';
import { deterministicCoworkUuid } from './operations';

export const coworkEffectKindSchema = z.enum(['save_contact', 'start_research', 'request_draft']);
export type CoworkEffectKind = z.infer<typeof coworkEffectKindSchema>;

type Scope = { userId: string; organizationId: string };
type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

function workerAuth(client: AdminClient, scope: Scope): AuthContext {
  return { user: { id: scope.userId }, organizationId: scope.organizationId,
    organizationIds: [scope.organizationId], supabase: client };
}

/** Admit one child run resuming from a completed effect or search result. */
export async function admitCoworkContinuation(
  client: AdminClient,
  scope: Scope,
  runId: string,
  message: string,
): Promise<string | null> {
  try {
    await requireCoworkWorkerAccess(client, scope);
    const parent = await client.from('cowork_runs').select('mode').eq('id', runId)
      .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).single();
    if (parent.error || !parent.data) return null;
    const mode = parent.data.mode === 'autonomous' ? 'autonomous' : 'approval';
    const { data, error } = await client.rpc('cowork_admit_followup', {
      p_user_id: scope.userId, p_organization_id: scope.organizationId,
      p_request_id: deterministicCoworkUuid(`cowork:continuation:${runId}`),
      p_message: message, p_mode: mode, p_parent_run_id: runId,
    });
    if (error || typeof data !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export async function proposeCoworkEffect(
  client: AdminClient,
  runId: string,
  lease: string,
  effect: { kind: CoworkEffectKind; originRunId: string; targetId: string; label: string },
): Promise<boolean> {
  const { data, error } = await client.rpc('cowork_propose_effect', {
    p_run_id: runId, p_token: lease, p_kind: effect.kind,
    p_origin_run_id: effect.originRunId, p_target_id: effect.targetId, p_label: effect.label,
  });
  if (error) throw error;
  return data === true;
}

export async function resolveCoworkEffect(
  client: AdminClient, scope: Scope, runId: string, approve: boolean,
): Promise<boolean> {
  await requireCoworkWorkerAccess(client, scope);
  const { data, error } = await client.rpc('cowork_resolve_effect', {
    p_run_id: runId, p_user_id: scope.userId, p_organization_id: scope.organizationId, p_approve: approve,
  });
  if (error) throw error;
  return data === true;
}

async function executeEffect(
  client: AdminClient,
  scope: Scope,
  proposal: { kind: string; origin_run_id: string; target_id: string; label: string },
): Promise<{ reply: string; result: unknown }> {
  const auth = workerAuth(client, scope);
  if (proposal.kind === 'save_contact') {
    const saved = await saveCoworkContact(auth, proposal.origin_run_id, { providerId: proposal.target_id });
    const name = (saved.lead as { name?: string } | null)?.name || 'Contacto';
    return { reply: saved.reused ? `${name} ya estaba en tus guardados.` : `${name} quedó guardado en tus contactos.`,
      result: { leadId: (saved.lead as { id?: string } | null)?.id || null, reused: saved.reused } };
  }
  if (proposal.kind === 'start_research') {
    const started = await startCoworkResearch(auth, proposal.origin_run_id, proposal.target_id);
    return { reply: started.status === 'completed'
      ? 'La investigación ya estaba disponible y quedó vinculada al trabajo.'
      : 'La investigación quedó en curso; el resultado se incorporará al retomarse el trabajo.',
      result: { reportId: started.reportId, status: started.status, reused: started.reused } };
  }
  const requested = await requestCoworkDraft(auth, proposal.origin_run_id, { snapshotId: proposal.target_id });
  return { reply: requested.reused ? 'Ese borrador ya estaba solicitado para este informe.'
      : 'El borrador quedó en preparación; podrás revisarlo cuando esté listo.',
    result: { status: requested.status, reused: requested.reused } };
}

/** Execute approved conversational effects exactly once, then resume the thread. */
export async function processCoworkEffectQueue(): Promise<{ processed: number; claimed: boolean }> {
  if (process.env.COWORK_ENABLED !== 'true') return { processed: 0, claimed: false };
  const client = getSupabaseAdminClient();
  const taken = await client.rpc('cowork_take_effect', { p_user_id: process.env.COWORK_OWNER_USER_ID });
  if (taken.error) throw taken.error;
  const job = taken.data?.[0];
  if (!job) return { processed: 0, claimed: false };
  const scope = { userId: job.user_id, organizationId: job.organization_id };
  const args = { p_run_id: job.run_id, p_user_id: scope.userId, p_organization_id: scope.organizationId };
  const finish = (success: boolean, reply: string, result: unknown) =>
    client.rpc('cowork_finish_effect', { ...args, p_success: success, p_reply: reply,
      p_result: JSON.parse(JSON.stringify(result ?? null)) as unknown });
  try {
    await requireCoworkWorkerAccess(client, scope);
    const current = await client.from('cowork_runs').select('status').eq('id', job.run_id).single();
    if (current.error || current.data.status !== 'waiting_approval') throw new Error('Effect cancelled');
    const outcome = await executeEffect(client, scope, job);
    await requireCoworkWorkerAccess(client, scope);
    const finished = await finish(true, outcome.reply, outcome.result);
    if (finished.error) throw finished.error;
    if (finished.data === true) {
      await admitCoworkContinuation(client, scope, job.run_id,
        'Continúa a partir del efecto recién ejecutado, dentro del mismo encargo. Resume qué quedó hecho y propón el siguiente paso concreto sin repetir el efecto.');
    }
    return { processed: finished.data === true ? 1 : 0, claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo ejecutar la acción.';
    const failed = await finish(false, message, { error: message });
    if (failed.error) throw failed.error;
    return { processed: 0, claimed: true };
  }
}

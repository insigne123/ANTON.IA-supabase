import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { coworkThreadBudgets } from '@/lib/cowork/thread-budget';
import { loadCoworkThreadStats } from './thread-stats';
import { enrichCoworkContact } from './enrich-contact';
import { sendCoworkEmail } from './send-email';
import { createCoworkCampaign, reviewCoworkCampaign } from './campaign-ops';
import { executeCoworkCode } from './code-runner';
import { saveCoworkContact } from './save-contact';
import { startCoworkResearch } from './start-research';
import { requestCoworkDraft } from './draft-from-research';
import { executeCoworkProfileUpdate } from './profile-update';
import { executeCoworkSavedSearchCreate, executeCoworkSavedSearchDelete, executeCoworkSavedSearchUpdate } from './saved-search-ops';
import { executeCoworkCampaignStop } from './campaign-stop';
import { executeCoworkCrmRecordUpdate } from './crm-record-update';
import { executeCoworkCampaignPrepare } from './campaign-prepare';
import { executeCoworkCrmAssign } from './crm-assign';
import { executeCoworkExceptionResolve } from './exception-resolve';
import { executeCoworkMissionControl } from './mission-control';
import { deterministicCoworkUuid } from './operations';

export const coworkEffectKindSchema = z.enum(['save_contact', 'start_research', 'request_draft', 'enrich_contact', 'send_email', 'campaign_create', 'campaign_activate', 'campaign_pause', 'code_execute',
  'profile_update', 'saved_search_create', 'saved_search_update', 'saved_search_delete', 'campaign_stop_v2',
  'crm_update_record', 'campaign_prepare_draft_v2',
  'crm_assign_lead', 'exception_resolve', 'mission_control']);
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
    // Fase 1 (CW-06): automatic chains end gracefully at the thread budget.
    // The thread simply stops; the last completed reply stands as the result.
    const budgets = coworkThreadBudgets(mode, process.env.COWORK_AUTONOMY_ENABLED === 'true');
    let depth = 0;
    let effects = 0;
    try {
      const stats = await loadCoworkThreadStats(client, scope, runId);
      depth = stats.depth;
      effects = stats.effects;
    } catch {
      return null;
    }
    if (depth + 1 > budgets.maxDepth || effects >= budgets.maxEffects) {
      try {
        await client.from('cowork_run_events').insert({
          run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
          kind: 'thread.budget_exhausted',
          payload: { depth, effects, maxDepth: budgets.maxDepth, maxEffects: budgets.maxEffects,
            notice: 'El hilo alcanzó su tope de pasos automáticos. Lo logrado queda guardado; continúa con un mensaje para seguir.' },
        });
      } catch {
        // Observability only; the completed work is already durable.
      }
      return null;
    }
    const closing = depth + 1 === budgets.maxDepth
      ? ' Es el último paso automático del hilo: presenta el resumen final y no propongas más efectos ni búsquedas.'
      : '';
    const { data, error } = await client.rpc('cowork_admit_followup', {
      p_user_id: scope.userId, p_organization_id: scope.organizationId,
      p_request_id: deterministicCoworkUuid(`cowork:continuation:${runId}`),
      p_message: `${message}${closing}`, p_mode: mode, p_parent_run_id: runId,
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
  proposal: { run_id: string; kind: string; origin_run_id: string; target_id: string; label: string },
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
  if (proposal.kind === 'enrich_contact') {
    const enriched = await enrichCoworkContact(auth, proposal.origin_run_id, proposal.target_id);
    return { reply: enriched.reused
      ? 'Ese contacto ya estaba enriquecido y se reutilizó el resultado.'
      : enriched.found
        ? `Encontramos ${enriched.email} (${enriched.emailStatus || 'estado sin confirmar'}). Quedó guardado en el contacto enriquecido.`
        : 'El proveedor no devolvió correo para este contacto. No se inventó ningún dato.',
      result: { email: enriched.email, emailStatus: enriched.emailStatus, found: enriched.found, reused: enriched.reused, enrichedLeadId: enriched.enrichedLeadId } };
  }
  if (proposal.kind === 'send_email') {
    const sent = await sendCoworkEmail(auth, proposal.run_id, proposal.target_id);
    return { reply: sent.status === 'sent'
      ? 'El correo salió con la versión aprobada. Quedó registrado en Contactados.'
      : 'El envío no se confirmó como entregado. Revisa en Contactados antes de reintentar.',
      result: { status: sent.status, providerMessageId: sent.providerMessageId } };
  }
  if (proposal.kind === 'campaign_create') {
    const created = await createCoworkCampaign(auth, proposal.run_id);
    return { reply: `La campaña «${created.name}» quedó creada como borrador pausado. Actívala cuando quieras desde Campañas o pídeme revisarla.`,
      result: { campaignId: created.id, status: created.status } };
  }
  if (proposal.kind === 'campaign_activate' || proposal.kind === 'campaign_pause') {    const reviewed = await reviewCoworkCampaign(auth, proposal.origin_run_id, proposal.target_id,
      proposal.kind === 'campaign_activate' ? 'approve' : 'pause');
    return { reply: proposal.kind === 'campaign_activate'
      ? (process.env.BULK_CAMPAIGNS_AUTOMATION_ENABLED === 'true'
        ? 'La campaña quedó aprobada. La automatización procesará los envíos elegibles.'
        : 'La campaña quedó aprobada. Inicia los envíos desde Campañas; la automatización está desactivada.')
      : 'La campaña quedó en pausa. Los envíos que ya estaban en curso podrían completarse.',
      result: { campaignId: reviewed.id, status: reviewed.status } };
  }
  if (proposal.kind === 'code_execute') {
    const executed = await executeCoworkCode(auth, proposal.run_id, proposal.target_id);
    return { reply: executed.reply, result: executed.result };
  }
  if (proposal.kind === 'profile_update') {
    const updated = await executeCoworkProfileUpdate(auth, proposal.run_id, proposal.target_id);
    return { reply: updated.reply, result: updated.result };
  }
  if (proposal.kind === 'saved_search_create') {
    const created = await executeCoworkSavedSearchCreate(auth, proposal.run_id, proposal.target_id);
    return { reply: created.reply, result: created.result };
  }
  if (proposal.kind === 'saved_search_update') {
    const updated = await executeCoworkSavedSearchUpdate(auth, proposal.run_id, proposal.target_id);
    return { reply: updated.reply, result: updated.result };
  }
  if (proposal.kind === 'saved_search_delete') {
    const deleted = await executeCoworkSavedSearchDelete(auth, proposal.run_id, proposal.target_id);
    return { reply: deleted.reply, result: deleted.result };
  }
  if (proposal.kind === 'campaign_stop_v2') {
    const stopped = await executeCoworkCampaignStop(auth, proposal.run_id, proposal.target_id);
    return { reply: stopped.reply, result: stopped.result };
  }
  if (proposal.kind === 'crm_update_record') {
    const updated = await executeCoworkCrmRecordUpdate(auth, proposal.run_id, proposal.target_id);
    return { reply: updated.reply, result: updated.result };
  }
  if (proposal.kind === 'campaign_prepare_draft_v2') {
    const prepared = await executeCoworkCampaignPrepare(auth, proposal.run_id, proposal.target_id);
    return { reply: prepared.reply, result: prepared.result };
  }
  if (proposal.kind === 'crm_assign_lead') {
    const assigned = await executeCoworkCrmAssign(auth, proposal.run_id, proposal.target_id);
    return { reply: assigned.reply, result: assigned.result };
  }
  if (proposal.kind === 'exception_resolve') {
    const resolved = await executeCoworkExceptionResolve(auth, proposal.run_id, proposal.target_id);
    return { reply: resolved.reply, result: resolved.result };
  }
  if (proposal.kind === 'mission_control') {
    const controlled = await executeCoworkMissionControl(auth, proposal.run_id, proposal.target_id);
    return { reply: controlled.reply, result: controlled.result };
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
    if (job.kind === 'code_execute') {
      // Fase 3: a failed execution resumes the thread with the observed error
      // so the agent can explain it and propose corrected code. Correction is
      // a new proposal and always waits for a fresh human review: nothing
      // re-executes automatically. Budgets bound the chain.
      await admitCoworkContinuation(client, scope, job.run_id,
        `La ejecución de código falló y quedó registrada, sin archivos nuevos. Explica el error en lenguaje claro, corrige el código y, si corresponde, propone una nueva ejecución con code.execute (requiere otra revisión humana; no repitas el mismo código sin cambios). Detalle observado: ${message.slice(0, 600)}`);
    }
    return { processed: 0, claimed: true };
  }
}

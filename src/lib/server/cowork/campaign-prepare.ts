import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { getCampaignV2RecipientStepSendContext } from '@/lib/server/campaigns-v2/send-context';
import { prepareCampaignV2Draft } from '@/lib/server/campaigns-v2/prepare-draft';
import { canonicalSha256 } from '@/lib/messaging-contracts';

/** Fase 4: preparar el borrador de un paso v2 con revisión humana. El target
 * fija el paso observado vía campaigns.step_context más su estado; la
 * ejecución relee el estado y usa el servicio nativo, cuya reserva (claim)
 * sigue siendo atómica frente a la preparación concurrente desde la UI.
 * Nunca envía ni aprueba nada: el borrador queda para revisión. */

type Client = ReturnType<typeof getSupabaseAdminClient>;
type Scope = { userId: string; organizationId: string };

export function parseCoworkCampaignPrepareTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'campaignprep' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de preparación no es válida.');
  }
  return { hash: parts[1] };
}

async function readStep(client: Client, scope: Scope, stepId: string) {
  z.string().uuid().parse(stepId);
  const context = await getCampaignV2RecipientStepSendContext({
    stepId, organizationId: scope.organizationId, userId: scope.userId, client,
  });
  return { state: context.state, nativeDraftId: context.nativeDraftId };
}

export async function stageCoworkCampaignPrepare(scope: Scope, runId: string, stepId: string) {
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const step = await readStep(client, scope, stepId);
  if (step.nativeDraftId) {
    throw new Error('Ese paso ya tiene un borrador. Revísalo desde la pantalla de campañas.');
  }
  const hash = canonicalSha256({ kind: 'campaign_prepare_draft_v2', stepId, state: step.state });
  const inserted = await client.from('cowork_campaign_prepare_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      step_id: stepId, base_state: step.state, base_native_draft_id: null, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (inserted.error) throw new Error('No se pudo preparar la propuesta.');
  if (!inserted.data) {
    const existing = await client.from('cowork_campaign_prepare_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra propuesta de preparación.');
    }
  }
  return { hash, state: step.state };
}

export async function executeCoworkCampaignPrepare(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkCampaignPrepareTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const staged = await client.from('cowork_campaign_prepare_proposals')
    .select('step_id,base_state,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (staged.error || !staged.data || staged.data.proposal_hash !== target.hash) {
    throw new Error('La propuesta aprobada ya no está disponible. Pide una nueva revisión.');
  }
  const stepId = (staged.data as { step_id: string }).step_id;
  const step = await readStep(client, scope, stepId);
  if (step.nativeDraftId || step.state !== (staged.data as { base_state: string }).base_state) {
    throw new Error('El paso cambió desde tu revisión. Revísalo de nuevo.');
  }
  const prepared = await prepareCampaignV2Draft({
    stepId, organizationId: scope.organizationId, userId: scope.userId, client,
  });
  return {
    reply: 'El borrador del paso quedó preparado para tu revisión. No se envió nada.',
    result: { draftId: prepared.draft.draftId, versionId: prepared.draft.versionId, composeUrl: prepared.composeUrl },
  };
}

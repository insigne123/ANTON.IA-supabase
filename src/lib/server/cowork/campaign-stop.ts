import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { stopCampaignV2Enrollment } from '@/lib/server/campaigns-v2/stop';

/** Fase 4: detener el seguimiento de una inscripción de campañas-v2 con
 * revisión humana. El target fija campaña e inscripción observadas en
 * campaigns.inbox; la ejecución relee el estado y usa el servicio nativo
 * (idempotente ante repetición). Nunca prepara ni envía nada. */

export function parseCoworkCampaignStopTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'campaign-stop') {
    throw new Error('La propuesta para detener el seguimiento no es válida.');
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(parts[1]) || !uuid.test(parts[2])) {
    throw new Error('La propuesta para detener el seguimiento no es válida.');
  }
  return { campaignId: parts[1], enrollmentId: parts[2] };
}

export async function executeCoworkCampaignStop(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkCampaignStopTarget(targetId);
  const userId = auth.user.id;
  const scope = { userId, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const stopped = await stopCampaignV2Enrollment({
    campaignId: target.campaignId, enrollmentId: target.enrollmentId,
    organizationId: auth.organizationId, userId, client,
  });
  return {
    reply: stopped.recipientEmail
      ? `Se detuvo el seguimiento de ${stopped.recipientEmail}. Los pasos pendientes quedaron omitidos; lo ya enviado no se revierte.`
      : 'Se detuvo el seguimiento. Los pasos pendientes quedaron omitidos; lo ya enviado no se revierte.',
    result: { campaignId: stopped.campaignId, enrollmentId: stopped.id, status: stopped.status },
  };
}

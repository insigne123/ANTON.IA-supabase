import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { requireCoworkWorkerAccess } from './access';
import { getCoworkRun } from './runs';
import { listCoworkRetryableTouches } from './batch-reads';
import {
  COWORK_CAMPAIGN_RETRY_MAX, coworkCampaignRetryEnabled, coworkCampaignRetryTarget, hashCoworkCampaignRetry, parseCoworkCampaignRetryTarget,
} from '@/lib/cowork/campaign-retry-target';

export { coworkCampaignRetryEnabled } from '@/lib/cowork/campaign-retry-target';

/**
 * Retrying the sends of a campaign that failed for a reason that can be retried («reintentar envíos fallidos»), behind
 * COWORK_CAMPAIGN_RETRY_ENABLED and the campaign_retry effect. Nothing is staged in a table: the approved target carries the campaign
 * and a hash of exactly the drafts the card listed, and the approval lists them again from the database and refuses if they are not the
 * same. Retrying never sends by itself: retry_bulk_campaign_attempt_v1 puts an attempt back in the queue of the campaign sender, which
 * applies every guard it always applies (quota, company of the day, answered, unsubscribed) and sends with the key that protects that
 * draft from being sent twice. It refuses on its own an attempt that is not safe to retry (uncertain, ended, already sent).
 */

type Scope = { userId: string; organizationId: string };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Stages the retry: lists what can be retried now and pins it by hash. Nothing is written and nothing is retried. */
export async function stageCoworkCampaignRetry(scope: Scope, runId: string, campaignId: string, client = getSupabaseAdminClient()) {
  z.string().uuid().parse(campaignId);
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  const listed = await listCoworkRetryableTouches(client, scope, campaignId);
  if (!listed.touches.length) throw new Error('No hay envíos de esa campaña que se puedan reintentar ahora.');
  if (listed.touches.length > COWORK_CAMPAIGN_RETRY_MAX) throw new Error(`Hay más de ${COWORK_CAMPAIGN_RETRY_MAX} envíos por reintentar: se reintentan de a ${COWORK_CAMPAIGN_RETRY_MAX}.`);
  const hash = hashCoworkCampaignRetry(runId, listed.campaignId, listed.touches.map(touch => touch.draftId));
  const label = `Reintentar ${plural(listed.touches.length, 'envío fallido', 'envíos fallidos')}${listed.name ? ` de «${listed.name.slice(0, 80)}»` : ''}`.slice(0, 280);
  return { hash, label, count: listed.touches.length, targetId: coworkCampaignRetryTarget(listed.campaignId, hash) };
}

/** What the approval card shows: who would be retried and why each failed, recomputed now, and whether it still is what was proposed. */
export async function readCoworkCampaignRetryPreview(auth: AuthContext, runId: string, targetId: string) {
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  let target: ReturnType<typeof parseCoworkCampaignRetryTarget>;
  try { target = parseCoworkCampaignRetryTarget(targetId); } catch { return null; }
  let listed: Awaited<ReturnType<typeof listCoworkRetryableTouches>>;
  try { listed = await listCoworkRetryableTouches(getSupabaseAdminClient(), scope, target.campaignId); } catch { return null; }
  const matches = listed.touches.length > 0 && hashCoworkCampaignRetry(runId, listed.campaignId, listed.touches.map(touch => touch.draftId)) === target.hash;
  return {
    campaignName: listed.name, count: listed.touches.length, matches,
    items: listed.touches.slice(0, COWORK_CAMPAIGN_RETRY_MAX).map(touch => ({ email: touch.email, touchNumber: touch.touchNumber, status: touch.status, error: touch.error ? String(touch.error).slice(0, 200) : null })),
    unavailable: matches ? null : 'La lista de envíos por reintentar cambió desde la propuesta. Descártala y pide una nueva.',
  };
}

/** Retries the approved drafts, one by one, and says what happened to each. Never throws for one refused attempt: the others go on. */
export async function executeCoworkCampaignRetry(auth: AuthContext, runId: string, targetId: string) {
  if (!coworkCampaignRetryEnabled()) throw new Error('Reintentar envíos está desactivado por ahora: no se reintentó nada.');
  const target = parseCoworkCampaignRetryTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const scope = { userId, organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El reintento aprobado ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  const run = await client.from('cowork_runs').select('status')
    .eq('id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  if (proposal.error || run.error || proposal.data?.status !== 'executing' || proposal.data.kind !== 'campaign_retry'
    || proposal.data.target_id !== targetId || run.data?.status !== 'waiting_approval') {
    throw new Error('La autorización del reintento ya no está vigente.');
  }
  const listed = await listCoworkRetryableTouches(client, scope, target.campaignId);
  if (hashCoworkCampaignRetry(runId, listed.campaignId, listed.touches.map(touch => touch.draftId)) !== target.hash) {
    throw new Error('La lista de envíos por reintentar cambió desde tu revisión. No se reintentó nada: pide una nueva revisión.');
  }
  const outcomes: Array<{ email: string; ok: boolean; why: string | null }> = [];
  for (const touch of listed.touches) {
    const { error } = await client.rpc('retry_bulk_campaign_attempt_v1', {
      p_campaign_id: listed.campaignId, p_draft_id: touch.draftId, p_user_id: userId, p_organization_id: organizationId,
    });
    outcomes.push({ email: touch.email, ok: !error,
      why: !error ? null : String(error.message || '').includes('BULK_CAMPAIGN_') ? 'necesita revisión y no se puede reintentar' : 'no se pudo reintentar ahora' });
  }
  const done = outcomes.filter(item => item.ok).length;
  const refused = outcomes.filter(item => !item.ok);
  const reply = `Dejé ${plural(done, 'envío', 'envíos')} en la cola para reintentarse${done ? ': salen con los mismos frenos de siempre (cupo, una empresa por día, quien ya respondió o se dio de baja) y ninguno se envía dos veces' : ''}.`
    + (refused.length ? ` ${plural(refused.length, 'no se pudo', 'no se pudieron')} reintentar (${refused.slice(0, 5).map(item => `${item.email}: ${item.why}`).join('; ')}${refused.length > 5 ? '…' : ''}).` : '');
  return { reply, result: { retried: done, refused: refused.length, outcomes } };
}

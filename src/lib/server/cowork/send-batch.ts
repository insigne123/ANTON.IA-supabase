import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { planCompanyDays, santiagoDayBounds } from '@/lib/cowork/send-cadence';

type Scope = { userId: string; organizationId: string };

const scheduleInputSchema = z.object({
  campaignId: z.string().uuid(),
  spacingMinutes: z.number().int().min(5).max(480).default(30),
});

export function hashCoworkSendBatch(runId: string, campaignId: string, revision: number, spacingMinutes: number, days: string[]) {
  return createHash('sha256')
    .update(`cowork|send-batch|${runId}|${campaignId}|${revision}|${spacingMinutes}|${[...days].sort().join(',')}`).digest('hex');
}

export function parseCoworkSendBatchTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 2 || parts[0] !== 'sendbatch' || !/^[a-f0-9]{64}$/.test(parts[1])) {
    throw new Error('La propuesta de programación no es válida.');
  }
  return { hash: parts[1] };
}

/** Programa un lote: espaciado entre envios y dia por empresa reservado.
 * No crea ni activa la campana y no envia nada: la activacion sigue exigiendo
 * su propia revision (campaign.activate) y cada toque su preflight. */
export async function stageCoworkSendBatch(scope: Scope, runId: string, input: unknown) {
  const parsed = scheduleInputSchema.parse(input);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  const campaign = await client.from('bulk_campaigns').select('id,revision,status,recipients,definition')
    .eq('id', parsed.campaignId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (campaign.error || !campaign.data) throw new Error('La campaña no está disponible en tu organización.');
  const row = campaign.data as { id: string; revision: number; status: string;
    recipients: Array<{ email: string; company: string }>; definition: { messages?: unknown[] } };
  if (row.status === 'rejected') throw new Error('La campaña fue rechazada; crea una nueva definición.');
  if (row.status === 'approved') throw new Error('Pausa la campaña antes de programar el lote.');
  if (!Array.isArray(row.recipients) || !row.recipients.length) throw new Error('La campaña no tiene destinatarios.');
  const startDay = santiagoDayBounds(new Date()).day;
  const plan = planCompanyDays(
    row.recipients.map(person => ({ email: person.email, company: person.company })), startDay);
  const days = plan.map(item => `${item.email}|${item.companyKeys.join(';')}|${item.sendDay}`);
  const hash = hashCoworkSendBatch(runId, row.id, row.revision, parsed.spacingMinutes, days);
  const staged = await client.from('cowork_send_batch_proposals').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      campaign_id: row.id, campaign_revision: row.revision,
      spacing_minutes: parsed.spacingMinutes, proposal_hash: hash },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la programación del lote.');
  if (!staged.data) {
    const existing = await client.from('cowork_send_batch_proposals').select('proposal_hash')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || existing.data.proposal_hash !== hash) {
      throw new Error('Este trabajo ya tiene otra programación.');
    }
  }
  const counts = new Map<string, number>();
  for (const item of plan) counts.set(item.companyKey, (counts.get(item.companyKey) || 0) + 1);
  const staggered = [...counts.values()].filter(count => count > 1).length;
  return { hash, recipients: plan.length, spacingMinutes: parsed.spacingMinutes,
    startDay, staggered, touches: Array.isArray(row.definition.messages) ? row.definition.messages.length : 0 };
}

export async function executeCoworkSendBatch(auth: AuthContext, runId: string, targetId: string) {
  const target = parseCoworkSendBatchTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La propuesta aprobada ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const staged = await client.from('cowork_send_batch_proposals')
    .select('campaign_id,campaign_revision,spacing_minutes,proposal_hash')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (staged.error || !staged.data) throw new Error('La propuesta aprobada ya no está disponible.');
  const proposal = staged.data as { campaign_id: string; campaign_revision: number; spacing_minutes: number; proposal_hash: string };
  if (proposal.proposal_hash !== target.hash) throw new Error('La programación cambió desde tu revisión. Pide una nueva revisión.');
  const campaign = await client.from('bulk_campaigns').select('id,revision,status,recipients')
    .eq('id', proposal.campaign_id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (campaign.error || !campaign.data) throw new Error('La campaña ya no está disponible.');
  const row = campaign.data as { id: string; revision: number; status: string; recipients: Array<{ email: string; company: string }> };
  if (row.status === 'rejected') throw new Error('La campaña fue rechazada; crea una nueva definición.');
  if (row.revision !== proposal.campaign_revision) {
    throw new Error('La campaña cambió desde tu revisión. Vuelve a programar el lote.');
  }
  const existing = await client.from('cowork_send_batches').select('proposal_hash,run_id')
    .eq('campaign_id', row.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (existing.error) throw new Error('No se pudo comprobar la programación anterior.');
  if (existing.data?.proposal_hash === target.hash && existing.data.run_id === runId) {
    return { reply: 'Este lote ya está programado. Conservamos sus reservas originales.',
      result: { campaignId: row.id, recipients: row.recipients.length, spacingMinutes: proposal.spacing_minutes, alreadyScheduled: true } };
  }
  const startDay = santiagoDayBounds(new Date()).day;
  const plan = planCompanyDays(
    row.recipients.map(person => ({ email: person.email, company: person.company })), startDay);
  const days = plan.map(item => `${item.email}|${item.companyKeys.join(';')}|${item.sendDay}`);
  if (hashCoworkSendBatch(runId, row.id, row.revision, proposal.spacing_minutes, days) !== target.hash) {
    throw new Error('La programación cambió desde tu revisión. Vuelve a programar el lote.');
  }
  const saved = await client.rpc('cowork_schedule_send_batch', {
    p_org: scope.organizationId, p_user: scope.userId, p_run: runId, p_hash: target.hash, p_plan: plan,
  });
  if (saved.error) {
    if (saved.error.code === '23505') throw new Error('Otra programacion ya reservo esa empresa para ese dia.');
    throw new Error('No se pudo guardar la programación; pausa la campaña y revisa el plan.');
  }
  const lastDay = plan.map(item => item.sendDay).sort().pop() || startDay;
  return { reply: `Lote programado: ${plan.length} destinatarios desde el ${startDay} hasta el ${lastDay}, con ${proposal.spacing_minutes} min entre envíos y una empresa por día. La campaña sigue pausada hasta que la actives.`,
    result: { campaignId: row.id, recipients: plan.length, startDay, lastDay, spacingMinutes: proposal.spacing_minutes } };
}

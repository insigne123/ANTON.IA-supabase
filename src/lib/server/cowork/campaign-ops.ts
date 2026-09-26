import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import { coworkCampaignDraftSchema, type CoworkCampaignDraft } from '@/lib/cowork/campaign-proposal';
import { CampaignInputSchema } from '@/lib/bulk-campaigns';
import { loadAudience } from '@/lib/server/bulk-campaign-audience';
import { reviewBulkCampaign, saveBulkCampaign } from '@/lib/server/bulk-campaigns';
import { canonicalSha256, deterministicMessagingUuid } from '@/lib/messaging-contracts';
import { coworkProposalView } from '@/lib/cowork/presentation';
import { CoworkCampaignEditRefused, coworkEditedCampaignDefinition, type CoworkCampaignEdit } from '@/lib/cowork/campaign-edit';
import type { CoworkEvent, CoworkRun } from '@/lib/cowork/contracts';

/** Fase 2D: campaign effects on bulk campaigns. Creation stages the reviewed
 * definition and always lands paused as a draft; activation revalidates the
 * audience, suppression and every message inside reviewBulkCampaign. Nothing
 * here sends: sending stays in the dispatch pipeline with its own claims. */

function requireBulkEnabled() {
  if (process.env.BULK_CAMPAIGNS_ENABLED !== 'true') throw new Error('Las campañas no están habilitadas.');
}

export async function stageCoworkCampaignDefinition(
  scope: { userId: string; organizationId: string },
  runId: string,
  definition: CoworkCampaignDraft,
): Promise<{ recipients: number }> {
  requireBulkEnabled();
  const parsed = coworkCampaignDraftSchema.parse(definition);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const audience = await loadAudience(
    { user: { id: scope.userId }, organizationId: scope.organizationId, organizationIds: [scope.organizationId], supabase: client } as AuthContext,
    parsed.criteria,
  );
  const matched = new Map(audience.map(person => [person.email.toLowerCase(), person]));
  for (const email of parsed.emails) {
    const person = matched.get(email.toLowerCase());
    if (!person || person.blockedReason) {
      throw new Error(`El destinatario ${email} ya no está disponible para esta audiencia.`);
    }
  }
  const full = CampaignInputSchema.parse({
    name: parsed.name, description: parsed.objective, objective: parsed.objective,
    criteria: parsed.criteria, emails: parsed.emails, messages: parsed.messages,
    provider: parsed.provider, overrides: [],
  });
  const staged = await client.from('cowork_campaign_definitions').upsert(
    { run_id: runId, user_id: scope.userId, organization_id: scope.organizationId, definition: full },
    { onConflict: 'run_id', ignoreDuplicates: true }).select('run_id').maybeSingle();
  if (staged.error) throw new Error('No se pudo preparar la propuesta de campaña.');
  if (!staged.data) {
    const existing = await client.from('cowork_campaign_definitions').select('definition')
      .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    if (existing.error || !existing.data || canonicalSha256(existing.data.definition) !== canonicalSha256(full)) {
      throw new Error('Este trabajo ya tiene otra definición de campaña.');
    }
  }
  return { recipients: parsed.emails.length };
}

/**
 * The person edits the emails of a campaign proposal before approving it. Only
 * subjects and bodies change: recipients, number of emails and spacing stay as
 * reviewed, so the approval card and its label stay true. Creation reads the
 * staged definition when it runs, so the edit is what gets created (paused;
 * activating it is another review bound to its own hash). The edit is recorded
 * as a run event, without the text.
 */
export async function editCoworkCampaignMessages(
  auth: AuthContext, runId: string, edits: CoworkCampaignEdit,
): Promise<{ changed: number[] }> {
  requireBulkEnabled();
  const state = await getCoworkRun(auth, runId);
  if (!state) throw new CoworkCampaignEditRefused('Trabajo no encontrado.', 404);
  const proposal = coworkProposalView(state.run as CoworkRun, state.events as CoworkEvent[]);
  if (proposal?.type !== 'effect' || proposal.payload.kind !== 'campaign_create' || proposal.state !== 'pending') {
    throw new CoworkCampaignEditRefused('Esta propuesta ya no se puede editar: ya se aprobó, se descartó o cambió.', 409);
  }
  const admin = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(admin, { userId: auth.user.id, organizationId: auth.organizationId });
  const row = await admin.from('cowork_campaign_definitions').select('definition')
    .eq('run_id', runId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (row.error || !row.data) throw new CoworkCampaignEditRefused('La definición de la campaña ya no está disponible.', 409);
  const { next, changed } = coworkEditedCampaignDefinition(row.data.definition, edits);
  if (!changed.length) return { changed };
  const updated = await admin.from('cowork_campaign_definitions').update({ definition: next })
    .eq('run_id', runId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).select('run_id').maybeSingle();
  if (updated.error || !updated.data) throw new Error('No se pudo guardar la edición de la campaña.');
  // The trace says an edit happened and which emails; the text stays in the definition.
  const recorded = await admin.from('cowork_run_events').insert({ run_id: runId, user_id: auth.user.id, organization_id: auth.organizationId,
    kind: 'proposal.edited', payload: { kind: 'campaign_create', emails: changed.map(index => index + 1) } });
  if (recorded.error) console.error('[cowork] campaign edit saved without its trace event');
  return { changed };
}

export async function createCoworkCampaign(auth: AuthContext, runId: string) {
  requireBulkEnabled();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La campaña a crear ya no está disponible en este trabajo.');
  }
  const row = await getSupabaseAdminClient().from('cowork_campaign_definitions')
    .select('definition').eq('run_id', runId)
    .eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (row.error || !row.data) throw new Error('La definición aprobada ya no está disponible.');
  await requireCoworkWorkerAccess(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId });
  const campaign = await saveBulkCampaign(auth, row.data.definition, undefined, 0,
    deterministicMessagingUuid(`cowork:${auth.organizationId}:${auth.user.id}:${runId}:campaign`));
  return { id: campaign.id, name: campaign.definition.name, status: campaign.status };
}

const campaignTargetSchema = z.object({
  campaignId: z.string().uuid(),
  revision: z.number().int().positive(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function parseCoworkCampaignTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  const reviewHash = parts.pop() || '';
  const revisionRaw = parts.pop() || '';
  const campaignId = parts.join(':');
  return campaignTargetSchema.parse({ campaignId, revision: Number(revisionRaw), reviewHash });
}

export async function reviewCoworkCampaign(
  auth: AuthContext, runId: string, targetId: string, action: 'approve' | 'pause',
) {
  requireBulkEnabled();
  const target = parseCoworkCampaignTarget(targetId);
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('La campaña ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(getSupabaseAdminClient(), { userId: auth.user.id, organizationId: auth.organizationId });
  try {
    const campaign = await reviewBulkCampaign(auth, target.campaignId,
      { action, revision: target.revision, reviewHash: target.reviewHash });
    return { id: campaign.id as string, status: (campaign as { status?: string }).status || 'unknown' };
  } catch (error) {
    throw new Error(`La campaña cambió o ya no cumple los criterios: ${error instanceof Error ? error.message : 'revisa la campaña'}`.slice(0, 280));
  }
}

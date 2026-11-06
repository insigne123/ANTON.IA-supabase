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
import {
  CoworkCampaignEditRefused, coworkEditedCampaignDefinition, coworkEditedCampaignPerson, type CoworkCampaignEdit, type CoworkCampaignPersonEdit,
} from '@/lib/cowork/campaign-edit';
import { coworkCampaignRenderProblem } from '@/lib/cowork/campaign-people';
import { coworkCampaignProvider } from '@/lib/mail-sender';
import { readMailSenderPreference } from '@/lib/server/mail-sender-preference';
import type { CampaignInput } from '@/lib/bulk-campaigns';
import type { CoworkEvent, CoworkRun } from '@/lib/cowork/contracts';
import { DEFAULT_FOLLOW_UP_DELAYS, writeCampaignFollowUps } from '@/lib/server/campaign-follow-ups';
import { readCoworkResearch } from './research-read';

/** The person asked for a single email: the campaign goes without follow-ups. */
export const COWORK_SINGLE_EMAIL = /\b(?:s[oó]lo|[uú]nicamente)\s+(?:el\s+|un\s+)?(?:primer\s+)?correo\b|\bsin\s+seguimientos?\b|\bun\s+(?:s[oó]lo|[uú]nico)\s+correo\b|\bnada\s+de\s+seguimientos?\b/i;

type StageDependencies = {
  writeFollowUps?: typeof writeCampaignFollowUps;
  readResearch?: (client: ReturnType<typeof getSupabaseAdminClient>, scope: { userId: string; organizationId: string }, leadId: string) => Promise<string | null>;
};

/** What the research says about one person's company, for their follow-ups: its written report, or nothing. Never throws. */
async function researchFor(client: ReturnType<typeof getSupabaseAdminClient>, scope: { userId: string; organizationId: string }, leadId: string) {
  try {
    const found = await readCoworkResearch(client as never, scope, leadId) as { availability?: string; report?: { sections?: Array<{ title: string; text: string }> } | null };
    const text = (found.report?.sections || []).map(section => `${section.title}: ${section.text}`).join('\n\n').trim();
    return found.availability === 'available' && text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

/**
 * The follow-ups of a campaign Cowork proposes with only its first email (6 Nov 2026: the four it created in ten days had none, and the
 * salesperson wrote them by hand in Campañas). Three, on days 3, 7 and 14, written from the first email, and for one person from their
 * research too; unless the person asked for a single email. Best effort: if they cannot be written well, the campaign goes as it came.
 */
async function withCoworkFollowUps(parsed: CoworkCampaignDraft, request: string, context: {
  client: ReturnType<typeof getSupabaseAdminClient>; scope: { userId: string; organizationId: string }; leadRef: string | null;
}, dependencies: StageDependencies): Promise<{ draft: CoworkCampaignDraft; added: number }> {
  if (parsed.messages.length !== 1 || COWORK_SINGLE_EMAIL.test(request)) return { draft: parsed, added: 0 };
  const one = parsed.emails.length === 1;
  const first = one && parsed.firstEmails.length === 1 ? parsed.firstEmails[0] : parsed.messages[0];
  try {
    const research = one && context.leadRef ? await (dependencies.readResearch ?? researchFor)(context.client, context.scope, context.leadRef) : null;
    const followUps = await (dependencies.writeFollowUps ?? writeCampaignFollowUps)({
      first: { subject: first.subject, body: first.body }, objective: parsed.objective || parsed.name,
      relationship: parsed.criteria.relationship ?? 'never_contacted', followUpDelays: [...DEFAULT_FOLLOW_UP_DELAYS],
      research, recipients: parsed.emails.length,
    });
    const checked = coworkCampaignDraftSchema.safeParse({ ...parsed, messages: [parsed.messages[0], ...followUps] });
    if (!checked.success) {
      console.warn('[cowork-campaign] follow-ups rejected', { issue: checked.error.issues[0]?.message?.slice(0, 160) });
      return { draft: parsed, added: 0 };
    }
    return { draft: checked.data, added: followUps.length };
  } catch (error) {
    console.warn('[cowork-campaign] follow-ups not written', { reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return { draft: parsed, added: 0 };
  }
}

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
  /** The person's request: a mailbox they name («desde Outlook») wins over the default one. */
  request = '',
  dependencies: StageDependencies = {},
): Promise<{ recipients: number; provider: 'google' | 'outlook'; messages: number; followUpsAdded: number }> {
  requireBulkEnabled();
  const proposed = coworkCampaignDraftSchema.parse(definition);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const audience = await loadAudience(
    { user: { id: scope.userId }, organizationId: scope.organizationId, organizationIds: [scope.organizationId], supabase: client } as AuthContext,
    proposed.criteria,
  );
  const matched = new Map(audience.map(person => [person.email.toLowerCase(), person]));
  for (const email of proposed.emails) {
    const person = matched.get(email.toLowerCase());
    if (!person || person.blockedReason) {
      throw new Error(`El destinatario ${email} ya no está disponible para esta audiencia.`);
    }
  }
  // The mailbox that sends: the one named in the request if connected, else the default one (Conexiones), else the model's.
  const mailbox = await readMailSenderPreference(client, scope.userId);
  const provider = coworkCampaignProvider({ message: request, connected: mailbox.connected, preferred: mailbox.preferred, proposed: proposed.provider });
  const build = (draft: CoworkCampaignDraft) => CampaignInputSchema.parse({
    name: draft.name, description: draft.objective, objective: draft.objective,
    criteria: draft.criteria, emails: draft.emails, messages: draft.messages,
    provider,
    overrides: draft.firstEmails.map(item => ({ email: item.email, messageIndex: 0, subject: item.subject, body: item.body })),
  });
  // A retried turn finds its campaign already staged: what was staged stands, follow-ups included, and nothing is written again.
  const already = await client.from('cowork_campaign_definitions').select('definition')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (already.error) throw new Error('No se pudo preparar la propuesta de campaña.');
  if (already.data) {
    const stored = CampaignInputSchema.safeParse(already.data.definition);
    const comparable = (value: CampaignInput) => (proposed.messages.length === 1 ? { ...value, messages: value.messages.slice(0, 1) } : value);
    if (!stored.success || canonicalSha256(comparable(stored.data)) !== canonicalSha256(comparable(build(proposed)))) {
      throw new Error('Este trabajo ya tiene otra definición de campaña.');
    }
    return { recipients: proposed.emails.length, provider: stored.data.provider, messages: stored.data.messages.length,
      followUpsAdded: stored.data.messages.length - proposed.messages.length };
  }
  const withFollowUps = await withCoworkFollowUps(proposed, request, {
    client, scope, leadRef: proposed.emails.length === 1 ? matched.get(proposed.emails[0].toLowerCase())?.leadRef ?? null : null,
  }, dependencies);
  // The first email written for a person replaces the template's first email for them only.
  let parsed = withFollowUps.draft;
  let added = withFollowUps.added;
  let full = build(parsed);
  // Every email of every person is built here, with their data, before the card exists: a missing first name or
  // an unknown variable goes back to the model instead of failing when the campaign is created. Follow-ups the app
  // wrote that do not build for someone are dropped: the campaign goes with its first email, as it came.
  let problem = coworkCampaignRenderProblem(full, audience);
  if (problem && added) {
    parsed = proposed; added = 0; full = build(proposed);
    problem = coworkCampaignRenderProblem(full, audience);
  }
  if (problem) throw new Error(problem);
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
  return { recipients: parsed.emails.length, provider, messages: full.messages.length, followUpsAdded: added };
}

/**
 * The person edits the emails of a campaign proposal before approving it. Only
 * subjects and bodies change: recipients, number of emails and spacing stay as
 * reviewed, so the approval card and its label stay true. Creation reads the
 * staged definition when it runs, so the edit is what gets created (paused;
 * activating it is another review bound to its own hash). The edit is recorded
 * as a run event, without the text. With M4 applied it is one transaction with
 * the approval, and an edit over a version another tab changed is refused.
 */
export async function editCoworkCampaignMessages(
  auth: AuthContext, runId: string, edits: CoworkCampaignEdit, expectedHash?: string,
): Promise<{ changed: number[] }> {
  return saveCoworkCampaignEdit(auth, runId, expectedHash, definition => coworkEditedCampaignDefinition(definition, edits));
}

/**
 * The person edits the first email of one recipient (by hand, or applying what the AI proposed for them). It is
 * stored as that person's own version (an override at the first step), with the same guarantees as the sequence:
 * only while the proposal is pending, only over the version they saw, recorded without the text.
 */
export async function editCoworkCampaignPerson(
  auth: AuthContext, runId: string, person: CoworkCampaignPersonEdit, expectedHash?: string,
): Promise<{ changed: number[] }> {
  return saveCoworkCampaignEdit(auth, runId, expectedHash, definition => coworkEditedCampaignPerson(definition, person));
}

async function saveCoworkCampaignEdit(
  auth: AuthContext, runId: string, expectedHash: string | undefined,
  apply: (definition: unknown) => { next: CampaignInput; changed: number[] },
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
  // The version in the browser may already be stale before this server request starts.
  if (!expectedHash || canonicalSha256(row.data.definition) !== expectedHash) {
    throw new CoworkCampaignEditRefused('La campaña cambió mientras la editabas: vuelve a abrirla y repite el cambio.', 409);
  }
  const { next, changed } = apply(row.data.definition);
  if (!changed.length) return { changed };
  // One transaction with the approval (M4, cowork_edit_campaign_definition): the edit lands only while the
  // proposal is pending and only over the version read above, and records its event. Until that migration
  // is applied, the two steps of before.
  const atomic = await admin.rpc('cowork_edit_campaign_definition', {
    p_run_id: runId, p_user_id: auth.user.id, p_organization_id: auth.organizationId,
    p_expected: row.data.definition, p_definition: next, p_changed: changed.map(index => index + 1),
  });
  if (!atomic.error) {
    if (atomic.data === 'edited') return { changed };
    if (atomic.data === 'stale') throw new CoworkCampaignEditRefused('La campaña cambió mientras la editabas: vuelve a abrirla y repite el cambio.', 409);
    throw new CoworkCampaignEditRefused('Esta propuesta ya no se puede editar: ya se aprobó, se descartó o cambió.', 409);
  }
  if (!['PGRST202', '42883'].includes(String((atomic.error as { code?: string }).code || ''))) {
    throw new Error('No se pudo guardar la edición de la campaña.');
  }
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
  return { id: campaign.id, name: campaign.definition.name, status: campaign.status,
    messages: campaign.definition.messages.length, recipients: campaign.definition.emails.length };
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

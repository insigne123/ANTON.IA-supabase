import { z } from 'zod';
import { AuthError, type AuthContext } from '@/lib/server/auth-utils';
import {
  CampaignInputSchema,
  isCampaignMessageLocked, renderCampaignMessage,
  type BulkCampaign,
} from '@/lib/bulk-campaigns';
import { MessagingDraftV1Schema, canonicalSha256, deterministicMessagingUuid, hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { validateOutboundEmail } from '@/lib/email-outbound';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { assertCampaignRecipientAllowed, campaignDeliveries, getBulkCampaign } from '@/lib/server/bulk-campaigns';
import { loadAudience } from '@/lib/server/bulk-campaign-audience';

export const ReviseInputSchema = z.object({
  revision: z.number().int().positive(),
  reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  definition: z.unknown(),
}).strict();

/** Versioned edit of pending messages. Locked (sent/in-flight/failed/unknown) content must stay identical. */
export async function reviseBulkCampaignPending(auth: AuthContext, id: string, input: unknown): Promise<BulkCampaign> {
  const parsed = ReviseInputSchema.parse(input);
  const definition = CampaignInputSchema.parse(parsed.definition);
  const campaign = await getBulkCampaign(auth, id);
  if (!['approved', 'paused'].includes(campaign.status)) throw new AuthError('Solo puedes editar pendientes de una campaña aprobada o en pausa.', 409);
  if (campaign.revision !== parsed.revision || campaign.review_hash !== parsed.reviewHash) {
    throw new AuthError('La campaña cambió. Vuelve a abrirla antes de editar.', 409);
  }
  const currentEmails = campaign.recipients.map(person => person.email).sort();
  if (JSON.stringify([...definition.emails].sort()) !== JSON.stringify(currentEmails)) {
    throw new AuthError('Esta edición conserva la audiencia aprobada. Crea una campaña nueva para cambiar destinatarios.', 409);
  }
  const deliveries = await campaignDeliveries(auth, campaign);
  // The first send changes relationship eligibility; it must not remove an
  // enrolled person from their own pending sequence revision.
  const audience = await loadAudience(auth);
  const now = new Date().toISOString();
  const recipients = [];
  const drafts = [];
  for (const email of definition.emails) {
    const previous = campaign.recipients.find(person => person.email === email);
    const person = audience.find(candidate => candidate.email === email);
    if (!previous || !person || person.blockedReason) throw new AuthError(`${email} ya no está disponible. Revisa su historial.`, 409);
    await assertCampaignRecipientAllowed(auth, email);
    if (definition.messages.length !== previous.messages.length) {
      throw new AuthError('Esta edición conserva la estructura de mensajes aprobada.', 409);
    }
    const messages = [];
    for (let index = 0; index < definition.messages.length; index++) {
      const old = previous.messages[index];
      if (isCampaignMessageLocked(old.draftId, deliveries)) {
        const override = definition.overrides.find(value => value.email === email && value.messageIndex === index);
        const rendered = renderCampaignMessage({ ...definition.messages[index],
          ...(override ? { subject: override.subject, body: override.body } : {}),
        }, previous);
        if (rendered.subject !== old.subject || rendered.body !== old.body || rendered.delayDays !== old.delayDays) {
          throw new AuthError(`El mensaje ${index + 1} de ${email} ya fue enviado o está en curso y no se puede modificar.`, 409);
        }
        messages.push(old);
        continue;
      }
      const rendered = renderCampaignMessage({ ...definition.messages[index], ...(() => {
        const override = definition.overrides.find(value => value.email === email && value.messageIndex === index);
        return override ? { subject: override.subject, body: override.body } : {};
      })() }, person);
      const check = validateOutboundEmail({ to: email, subject: rendered.subject, text: rendered.body, requireUnsubscribe: false });
      if (!check.ok) throw new AuthError(check.errors.join(' '), 422);
      const draftId = deterministicMessagingUuid(`bulk-revise:${campaign.id}:${campaign.revision + 1}:${email}:${index}`);
      const versionId = deterministicMessagingUuid(`bulk-revise-version:${campaign.id}:${campaign.revision + 1}:${email}:${index}`);
      messages.push({ ...rendered, draftId, versionId });
      const payload = MessagingDraftV1Schema.parse({
        schemaVersion: 1, draftId, versionId,
        organizationId: auth.organizationId, userId: auth.user.id, researchSnapshotId: null,
        revision: 1, parentVersionId: null, lifecycle: 'ready', channel: 'email',
        recipient: { leadRef: person.leadRef, displayName: person.name || null, email, linkedinUrl: null },
        content: { subject: rendered.subject, text: rendered.body, html: null },
        approval: { status: 'approved', decidedBy: auth.user.id, decidedAt: now, reason: null },
        preflight: { status: 'passed', checkedAt: now, errors: [], warnings: [] }, createdAt: now,
      });
      drafts.push({ payload, hash: hashMessagingDraftContent(payload) });
    }
    recipients.push({ ...person, messages });
  }
  const reviewHash = canonicalSha256({ definition, recipients });
  const { data, error } = await getSupabaseAdminClient().rpc('revise_bulk_campaign_pending_v1', {
    p_id: id, p_organization_id: auth.organizationId, p_user_id: auth.user.id,
    p_expected_revision: parsed.revision, p_review_hash: parsed.reviewHash,
    p_new_review_hash: reviewHash, p_definition: definition, p_recipients: recipients, p_drafts: drafts,
  });
  if (error) {
    if (String(error.message || '').includes('INVALID_REVISE_LOCKED')) {
      throw new AuthError('Un mensaje ya enviado o en curso no se puede modificar.', 409);
    }
    throw error;
  }
  return data as BulkCampaign;
}

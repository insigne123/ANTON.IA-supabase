import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CampaignInputSchema, matchAudience, renderCampaignMessage, type BulkCampaign, type CampaignDelivery } from '@/lib/bulk-campaigns';
import { getCampaignAttempts } from '@/lib/server/bulk-campaign-attempts';
import { withSentAttemptsAsDeliveries } from '@/lib/bulk-campaign-attempts';
import { canonicalSha256, deterministicMessagingUuid, MessagingDraftV1Schema, hashMessagingDraftContent } from '@/lib/messaging-contracts';
import { validateOutboundEmail } from '@/lib/email-outbound';
import { AuthError, handleAuthError, requireAuth, type AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { loadAudience } from '@/lib/server/bulk-campaign-audience';

export const ReviewActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'pause', 'resume']),
  revision: z.number().int().positive(), reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function requireBulkCampaignAuth() {
  const auth = await requireAuth();
  if (process.env.BULK_CAMPAIGNS_ENABLED !== 'true') throw new AuthError('La nueva experiencia de campañas todavía no está habilitada.', 404);
  return auth;
}

export async function getBulkCampaign(auth: AuthContext, id: string): Promise<BulkCampaign> {
  z.string().uuid().parse(id);
  const { data, error } = await auth.supabase.from('bulk_campaigns').select('*')
    .eq('id', id).eq('organization_id', auth.organizationId).eq('user_id', auth.user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AuthError('No encontramos esta campaña.', 404);
  return data;
}

export async function campaignDeliveries(auth: AuthContext, campaign: BulkCampaign): Promise<CampaignDelivery[]> {
  const ids = campaign.recipients.flatMap(person => person.messages.map(message => message.draftId));
  const { data, error } = await auth.supabase.from('outbound_dispatches')
    .select('draft_id,status,completed_at,error_message').eq('organization_id', auth.organizationId)
    .eq('user_id', auth.user.id).in('draft_id', ids).limit(1000);
  if (error) throw error;
  return data || [];
}

export async function assertCampaignRecipientAllowed(auth: AuthContext, email: string) {
  if (await isEmailSuppressedForScope(email, { userId: auth.user.id, organizationId: auth.organizationId })) {
    throw new AuthError(`${email} se dio de baja. Actualiza la audiencia.`, 409);
  }
  const { data, error } = await getSupabaseAdminClient().from('excluded_domains').select('id')
    .eq('organization_id', auth.organizationId).eq('domain', email.split('@')[1]).limit(1);
  if (error) throw error;
  if (data?.length) throw new AuthError(`El dominio de ${email} está excluido.`, 409);
}

export async function saveBulkCampaign(auth: AuthContext, input: unknown, id?: string, revision = 0) {
  const definition = CampaignInputSchema.parse(input);
  const campaignId = id ? z.string().uuid().parse(id) : randomUUID();
  if (id) {
    const current = await getBulkCampaign(auth, id);
    if (!['draft', 'rejected'].includes(current.status) || current.revision !== revision) throw new AuthError('La campaña cambió. Vuelve a abrirla antes de editar.', 409);
  }
  const matches = await loadAudience(auth, definition.criteria);
  const recipients = definition.emails.map(email => {
    const person = matches.find(candidate => candidate.email === email);
    if (!person || person.blockedReason) throw new AuthError(`${email} ya no está disponible para esta audiencia. Vuelve a buscar.`, 409);
    return { ...person, messages: definition.messages.map((message, index) => ({
      ...renderCampaignMessage({ ...message, ...(() => {
        const override = definition.overrides.find(value => value.email === email && value.messageIndex === index);
        return override ? { subject: override.subject, body: override.body } : {};
      })() }, person),
      draftId: deterministicMessagingUuid(`bulk:${campaignId}:${revision + 1}:${email}:${index}`),
      versionId: deterministicMessagingUuid(`bulk-version:${campaignId}:${revision + 1}:${email}:${index}`),
    })) };
  });
  const reviewHash = canonicalSha256({ definition, recipients });
  const { data, error } = await getSupabaseAdminClient().rpc('mutate_bulk_campaign_v1', {
    p_id: campaignId, p_organization_id: auth.organizationId, p_user_id: auth.user.id,
    p_action: 'save', p_expected_revision: revision, p_review_hash: reviewHash, p_definition: definition, p_recipients: recipients,
  });
  if (error) throw error;
  return data as BulkCampaign;
}

export async function reviewBulkCampaign(auth: AuthContext, id: string, input: unknown) {
  const action = ReviewActionSchema.parse(input);
  const campaign = await getBulkCampaign(auth, id);
  if (campaign.revision !== action.revision || campaign.review_hash !== action.reviewHash) throw new AuthError('La campaña cambió. Revisa la nueva versión antes de aprobar.', 409);
  const now = new Date().toISOString();
  const drafts = [];
  if (action.action === 'approve' && campaign.status !== 'approved') {
    const audience = await loadAudience(auth);
    const deliveries = withSentAttemptsAsDeliveries(await campaignDeliveries(auth, campaign), await getCampaignAttempts(auth.supabase, campaign));
    for (const recipient of campaign.recipients) {
      const current = audience.find(person => person.email === recipient.email);
      const initialSent = deliveries.some(value => value.draft_id === recipient.messages[0]?.draftId && value.status === 'sent');
      if (!current || current.blockedReason || (initialSent ? current.replied : !matchAudience(current, campaign.definition.criteria))) {
        throw new AuthError(`${recipient.email} ya no cumple los criterios. Actualiza la audiencia.`, 409);
      }
      await assertCampaignRecipientAllowed(auth, recipient.email);
      for (const message of recipient.messages) {
        const check = validateOutboundEmail({ to: recipient.email, subject: message.subject, text: message.body, requireUnsubscribe: false });
        if (!check.ok) throw new AuthError(check.errors.join(' '), 422);
        const payload = MessagingDraftV1Schema.parse({
          schemaVersion: 1, draftId: message.draftId, versionId: message.versionId,
          organizationId: auth.organizationId, userId: auth.user.id, researchSnapshotId: null,
          revision: 1, parentVersionId: null, lifecycle: 'ready', channel: 'email',
          recipient: { leadRef: recipient.leadRef, displayName: recipient.name || null, email: recipient.email, linkedinUrl: null },
          content: { subject: message.subject, text: message.body, html: null },
          approval: { status: 'approved', decidedBy: auth.user.id, decidedAt: now, reason: null },
          preflight: { status: 'passed', checkedAt: now, errors: [], warnings: [] }, createdAt: now,
        });
        drafts.push({ payload, hash: hashMessagingDraftContent(payload) });
      }
    }
  }
  const { data, error } = await getSupabaseAdminClient().rpc('mutate_bulk_campaign_v1', {
    p_id: id, p_organization_id: auth.organizationId, p_user_id: auth.user.id,
    p_action: action.action, p_expected_revision: action.revision, p_review_hash: action.reviewHash, p_drafts: drafts,
  });
  if (error) throw error;
  return data as BulkCampaign;
}

export function bulkCampaignError(error: unknown) {
  if (error instanceof AuthError) return handleAuthError(error);
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return NextResponse.json({ error: (error as Error).message || 'No se pudo completar la operación.' }, { status });
  }
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || 'Revisa los campos de la campaña.' }, { status: 400 });
  const value = error as { code?: string; message?: string };
  if (value.code === '40001') return NextResponse.json({ error: 'La campaña cambió en otra pestaña. Vuelve a abrirla.' }, { status: 409 });
  if (['42P01', '42p01', 'PGRST205', 'PGRST202'].includes(value.code || '')) return NextResponse.json({ error: 'La nueva experiencia de campañas aún necesita activar su configuración de datos.', setupRequired: true }, { status: 503 });
  console.error('[bulk-campaigns]', error);
  return NextResponse.json({ error: 'No pudimos completar la operación. Inténtalo nuevamente.' }, { status: 500 });
}

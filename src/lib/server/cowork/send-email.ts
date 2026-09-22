import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { coworkMailboxIdentity } from './sender-identity';
import { requireCoworkWorkerAccess } from './access';
import { getCurrentNativeDraft, approveNativeDraft } from '@/lib/server/native-drafts';
import {
  createMessagingSendMetadataV1,
  hashMessagingDraftContent,
  resolveApprovedEmailSendV1,
} from '@/lib/messaging-contracts';
import { prepareOutboundEmail, validateOutboundEmail } from '@/lib/email-outbound';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import {
  dispatchOutboundMessage,
  OutboundPreProviderDeferredError,
} from '@/lib/server/outbound-dispatch';

/** Fase 2C: send exactly the approved native draft version. The proposal target
 * carries draftId:versionId:contentHash; any drift refuses before approving.
 * Sends never self-approve, never retry alone, and fail closed on suppression,
 * domain policy, provider connection or quota. */

const sendTargetSchema = z.object({
  draftId: z.string().uuid(),
  versionId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(['google', 'outlook']),
  senderHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export function parseCoworkSendTarget(targetId: string) {
  const parts = String(targetId || '').split(':');
  if (parts.length !== 5) throw new Error('La propuesta de envío debe incluir el remitente confirmado.');
  const [draftId, versionId, contentHash, provider, senderHash] = parts;
  return sendTargetSchema.parse({ draftId, versionId, contentHash, provider, senderHash });
}

export type CoworkSendResult = { status: 'sent' | 'deferred' | 'failed' | 'unknown'; providerMessageId: string | null };

export async function sendCoworkEmail(
  auth: AuthContext, runId: string, targetId: string,
): Promise<CoworkSendResult> {
  const target = parseCoworkSendTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const client = getSupabaseAdminClient();
  const assertApprovedExecution = async () => {
    await requireCoworkWorkerAccess(client, { userId, organizationId });
    const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
      .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
    const run = await client.from('cowork_runs').select('status')
      .eq('id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
    if (proposal.error || run.error || proposal.data?.status !== 'executing'
      || proposal.data.kind !== 'send_email' || proposal.data.target_id !== targetId
      || run.data?.status !== 'waiting_approval') {
      throw new Error('La autorización de envío ya no está vigente.');
    }
  };
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El borrador a enviar ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, { userId, organizationId });
  await assertApprovedExecution();
  const current = await getCurrentNativeDraft({ userId, organizationId, draftId: target.draftId });
  if (!current || current.channel !== 'email') throw new Error('El borrador a enviar ya no está disponible.');
  if (current.versionId !== target.versionId || hashMessagingDraftContent(current) !== target.contentHash) {
    throw new Error('El borrador cambió desde tu revisión. Revísalo de nuevo antes de enviar.');
  }
  // Native approval runs its own preflight (suppression included) and fails closed.
  let approved;
  try {
    approved = await approveNativeDraft({ userId, organizationId, draftId: target.draftId, versionId: target.versionId });
  } catch (error) {
    throw new Error(`El borrador no pasó la revisión previa al envío: ${error instanceof Error ? error.message : 'revisión rechazada'}`.slice(0, 280));
  }
  const canonical = resolveApprovedEmailSendV1(approved);
  if (approved.versionId !== target.versionId || hashMessagingDraftContent(approved) !== target.contentHash) {
    throw new Error('El borrador cambió durante la aprobación. Revísalo de nuevo.');
  }
  if (canonical.to !== (current.recipient.email || '')) throw new Error('El destinatario cambió desde tu revisión.');
  const scope = { userId, organizationId };
  try {
    if (await isEmailSuppressedForScope(canonical.to, scope)) {
      throw new Error('El destinatario se dio de baja. No se envió el correo.');
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'El destinatario se dio de baja. No se envió el correo.') throw error;
    throw new Error('No se pudo verificar el estado del destinatario. No se envió el correo.');
  }
  const domain = canonical.to.split('@')[1]?.trim().toLowerCase() || '';
  if (domain) {
    const { data: blocked, error } = await client.from('excluded_domains').select('domain').eq('organization_id', organizationId);
    if (error) throw new Error('No se pudo verificar la política de dominios. No se envió el correo.');
    if ((blocked || []).some((row: { domain?: string }) => String(row.domain || '').trim().toLowerCase().replace(/^@/, '') === domain)) {
      throw new Error(`El dominio ${domain} está bloqueado. No se envió el correo.`);
    }
  }
  // Mandatory language gate on the exact approved version: consulting the
  // check tool is not enough, because skipping it would skip the control.
  try {
    const { readCoworkMessageContext } = await import('./message-context');
    const { checkMessageTerms } = await import('@/lib/cowork/message-checks');
    const messaging = await readCoworkMessageContext(client, scope);
    const context = messaging.context as { prohibitedTerms?: string[]; requiredTerms?: string[] } | null;
    const gate = checkMessageTerms(`${canonical.subject || ''}\n${canonical.text || ''}`,
      { prohibitedTerms: context?.prohibitedTerms || [], requiredTerms: context?.requiredTerms || [] });
    if (gate.verdict === 'blocked' || gate.verdict === 'fail') {
      const detail = gate.prohibitedFound.length ? `Término prohibido: ${gate.prohibitedFound.join(', ')}`
        : `Falta término obligatorio: ${gate.requiredMissing.join(', ')}`;
      throw new Error(`El borrador incumple las reglas de lenguaje aprobadas (${detail}). No se envió el correo.`);
    }
  } catch (error) {
    if (error instanceof Error && /incumple las reglas de lenguaje/.test(error.message)) throw error;
    throw new Error('No se pudo verificar las reglas de lenguaje. No se envió el correo.');
  }
  const unsubscribeUrl = generateUnsubscribeLink(canonical.to, userId, organizationId);
  const prepared = prepareOutboundEmail({ text: canonical.text || undefined, html: canonical.html || undefined, unsubscribeUrl });
  const check = validateOutboundEmail({ to: canonical.to, subject: canonical.subject, ...prepared, requireUnsubscribe: true, unsubscribeUrl });
  if (!check.ok) throw new Error(`El correo no pasó la validación: ${check.errors.join(' ')}`.slice(0, 280));
  // Provider label is resolved before dispatch so the durable record matches
  // the actual sender account; tokens are refreshed inside the claim below.
  const provider = target.provider;
  const existingToken = await tokenService.getToken(client, userId, provider);
  if (!existingToken?.refresh_token) {
    throw new Error('Reconecta tu cuenta de correo para continuar. No se envió el correo.');
  }
  const metadata = createMessagingSendMetadataV1(approved, {
    idempotencyKey: `cowork:send:${target.versionId}`,
    provider: provider === 'google' ? 'gmail' : 'outlook', requestedAt: new Date().toISOString(),
  });
  const result = await dispatchOutboundMessage({ draft: approved, metadata, provider: {
    async send({ dispatchId }) {
      const admin = getSupabaseAdminClient();
      await assertApprovedExecution();
      let token = await tokenService.getToken(admin, userId, provider);
      if (!token?.refresh_token) {
        throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.',
          { code: 'provider_connection_unavailable', retryAfterMs: 3600000 });
      }
      let accessToken: string;
      try {
        if (provider === 'google') {
          const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
          accessToken = refreshed.access_token;
        } else {
          const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID!);
          accessToken = refreshed.access_token;
          if (refreshed.refresh_token) {
            const saved = await admin.from('provider_tokens').update({ refresh_token: encryptStoredToken(refreshed.refresh_token), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('provider', provider);
            if (saved.error) throw saved.error;
          }
        }
      } catch (cause) {
        throw new OutboundPreProviderDeferredError('Reconecta tu cuenta de correo para continuar.',
          { code: 'provider_connection_unavailable', cause, retryAfterMs: 3600000 });
      }
      let quota;
      const mailbox = await coworkMailboxIdentity(provider, accessToken);
      if (mailbox.identityHash !== target.senderHash) {
        throw new OutboundPreProviderDeferredError('La cuenta remitente cambió. Revisa el envío nuevamente.', { code: 'sender_changed' });
      }
      try {
        const limits = await getEffectiveDailyQuotaLimits(scope);
        quota = await reserveOutboundContactQuota({ ...scope, dispatchId, limit: limits.contact });
      } catch (cause) {
        throw new OutboundPreProviderDeferredError('No se pudo reservar la cuota.', { code: 'quota_reservation_unavailable', cause });
      }
      if (!quota.allowed) return { outcome: 'deferred', code: 'daily_quota_exceeded', message: 'Se alcanzó el límite diario de contactos.', retryAfterMs: 3600000 };
      // Recheck after token refresh/quota reservation, immediately before the provider.
      await assertApprovedExecution();
      const latest = await getCurrentNativeDraft({ userId, organizationId, draftId: target.draftId });
      if (!latest || latest.versionId !== target.versionId || hashMessagingDraftContent(latest) !== target.contentHash) {
        throw new OutboundPreProviderDeferredError('El borrador cambió. Revisa la versión actual.', { code: 'draft_version_changed' });
      }
      if (await isEmailSuppressedForScope(canonical.to, scope)) {
        return { outcome: 'rejected', code: 'recipient_suppressed', message: 'El destinatario se dio de baja.' };
      }
      const receipt = provider === 'google'
        ? await sendGmail(accessToken, canonical.to, canonical.subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey })
        : await sendOutlook(accessToken, canonical.to, canonical.subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey: metadata.idempotencyKey });
      const response = (receipt || {}) as Record<string, unknown>;
      const providerMessageId = String(response.id || response.messageId || response.internetMessageId || '');
      if (!providerMessageId) throw new Error('El proveedor no confirmó el envío.');
      return { outcome: 'accepted', providerMessageId, response };
    },
  } });
  const dispatch = result.dispatch;
  if (dispatch.status === 'sent') return { status: 'sent', providerMessageId: dispatch.providerMessageId };
  if (dispatch.status === 'deferred') {
    if (dispatch.errorCode === 'daily_quota_exceeded') throw new Error('Se alcanzó el límite diario de contactos. El correo quedó diferido, no duplicado.');
    throw new Error(`El envío quedó diferido: ${dispatch.errorMessage || dispatch.errorCode || 'revisa en Contactados'}.`.slice(0, 280));
  }
  if (dispatch.status === 'unknown') {
    throw new Error('No pudimos confirmar si el correo salió. Revisa en Contactados antes de reintentar: no se reenviará solo.');
  }
  throw new Error(`No se pudo enviar el correo: ${dispatch.errorMessage || dispatch.errorCode || 'error del proveedor'}.`.slice(0, 280));
}

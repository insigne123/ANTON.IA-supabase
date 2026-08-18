import { randomUUID } from 'crypto';

import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { normalizeConnectedEmailProvider, type ConnectedEmailProvider } from '@/lib/email-provider';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { getEffectiveDailyQuotaLimits, reserveOutboundContactQuota } from '@/lib/server/daily-quota-store';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { buildThreadKey, safeInsertEmailEvent } from '@/lib/email-observability';
import {
  createLegacyReadyEmailDraftV1,
  createMessagingSendMetadataV1,
  deterministicMessagingUuid,
} from '@/lib/messaging-contracts';
import { ensureMessagingDraftV1 } from '@/lib/server/messaging-drafts';
import { dispatchOutboundMessage, OutboundPreProviderDeferredError } from '@/lib/server/outbound-dispatch';
import { prepareOutboundEmail } from '@/lib/email-outbound';
import { SupliaRuntimeError } from '@/lib/suplia/runtime';
import { SupliaRecipientDeliveryError } from '@/lib/server/suplia-bulk-send-outcomes';

export type SupliaEmailPayload = {
  to?: unknown;
  subject?: unknown;
  htmlBody?: unknown;
  textBody?: unknown;
  provider?: unknown;
  recipientName?: unknown;
  company?: unknown;
  role?: unknown;
  leadId?: unknown;
};

function asText(value: unknown) {
  return String(value || '').trim();
}

export function parseRequestedSupliaProvider(value: unknown): ConnectedEmailProvider | null {
  const rawProvider = asText(value);
  const provider = normalizeConnectedEmailProvider(rawProvider);
  if (rawProvider && !provider) throw new SupliaRecipientDeliveryError('rejected', `Proveedor de email no soportado: ${rawProvider}.`);
  return provider;
}

async function getRefreshToken(supabase: any, userId: string, requestedProvider?: ConnectedEmailProvider | null) {
  const providers: ConnectedEmailProvider[] = requestedProvider ? [requestedProvider] : ['google', 'outlook'];

  for (const provider of providers) {
    const token = await tokenService.getToken(supabase, userId, provider);
    if (token?.refresh_token) return { provider, refreshToken: token.refresh_token };
  }

  throw new Error(requestedProvider ? `No hay conexion activa con ${requestedProvider}.` : 'No hay conexion activa con Gmail u Outlook.');
}

async function refreshAccessToken(provider: ConnectedEmailProvider, refreshToken: string) {
  if (provider === 'google') {
    const refreshed = await refreshGoogleToken(
      refreshToken,
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!
    );
    return refreshed.access_token as string;
  }

  const refreshed = await refreshMicrosoftToken(
    refreshToken,
    process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
    process.env.AZURE_AD_CLIENT_SECRET!,
    process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common'
  );
  return refreshed.access_token as string;
}

export async function persistSupliaSentHistory(input: {
  admin: any;
  dispatchId: string;
  organizationId: string;
  contactedPayload: Record<string, any>;
  eventPayload: Record<string, any>;
}) {
  const deterministicContactedId = deterministicMessagingUuid(`suplia:contacted:${input.dispatchId}`);
  const sentEventId = deterministicMessagingUuid(`suplia:email-event:sent:${input.dispatchId}`);
  const { data: existingContacted, error: existingContactedError } = await input.admin
    .from('contacted_leads')
    .select('id')
    .eq('organization_id', input.organizationId)
    .contains('data', { dispatchId: input.dispatchId })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingContactedError) throw existingContactedError;
  const contactedId = existingContacted?.id || deterministicContactedId;

  if (!existingContacted) {
    const { error: contactedError } = await input.admin
      .from('contacted_leads')
      .upsert({
        ...input.contactedPayload,
        id: contactedId,
        data: { ...(input.contactedPayload.data || {}), dispatchId: input.dispatchId },
      }, { onConflict: 'id', ignoreDuplicates: true });
    if (contactedError) throw contactedError;
  }

  const { data: persistedContacted, error: persistedContactedError } = await input.admin
    .from('contacted_leads')
    .select('id, provider, email, subject, message_id, thread_id, conversation_id, internet_message_id, thread_key, sent_at, created_at')
    .eq('id', contactedId)
    .single();
  if (persistedContactedError) throw persistedContactedError;

  const { data: existingSentEvent, error: existingSentEventError } = await input.admin
    .from('email_events')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('event_type', 'sent')
    .eq('event_source', 'suplia')
    .contains('meta', { dispatchId: input.dispatchId })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingSentEventError) throw existingSentEventError;
  if (!existingSentEvent) {
    await safeInsertEmailEvent(input.admin, {
      ...input.eventPayload,
      id: sentEventId,
      contacted_id: contactedId,
      meta: { ...(input.eventPayload.meta || {}), dispatchId: input.dispatchId },
    });
  }

  return persistedContacted;
}

export async function sendSupliaEmail(input: {
  supabase: any;
  userId: string;
  organizationId: string;
  conversationId?: string | null;
  actionId?: string | null;
  payload: SupliaEmailPayload;
}) {
  const to = asText(input.payload.to).toLowerCase();
  const subject = asText(input.payload.subject);
  const htmlBody = asText(input.payload.htmlBody || input.payload.textBody);
  const textBody = asText(input.payload.textBody);
  const requestedProvider = parseRequestedSupliaProvider(input.payload.provider);

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new SupliaRecipientDeliveryError('rejected', 'El destinatario no es un email valido.');
  if (!subject) throw new SupliaRecipientDeliveryError('rejected', 'Falta el asunto del email.');
  if (!htmlBody) throw new SupliaRecipientDeliveryError('rejected', 'Falta el cuerpo del email.');

  const suppressed = await isEmailSuppressedForScope(to, { userId: input.userId, organizationId: input.organizationId });
  if (suppressed) throw new SupliaRecipientDeliveryError('rejected', 'El destinatario esta dado de baja o bloqueado por privacidad.');

  const domain = to.split('@')[1]?.trim().toLowerCase();
  if (domain) {
    const { data: blockedDomain, error } = await getSupabaseAdminClient()
      .from('excluded_domains')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw error;
    if (blockedDomain) throw new SupliaRecipientDeliveryError('rejected', `El dominio ${domain} esta bloqueado por la organizacion.`);
  }

  const { provider, refreshToken } = await getRefreshToken(input.supabase, input.userId, requestedProvider);
  const accessToken = await refreshAccessToken(provider, refreshToken);
  if (!accessToken) throw new Error('No se pudo obtener access token para enviar.');

  const unsubscribeUrl = generateUnsubscribeLink(to, input.userId, input.organizationId);
  const providerLabel = provider === 'google' ? 'gmail' : 'outlook';
  const prepared = prepareOutboundEmail({ html: htmlBody, text: textBody || undefined, unsubscribeUrl });
  const requestedAt = new Date().toISOString();
  const idempotencyKey = `suplia:${input.actionId || input.conversationId || randomUUID()}:${to}`;
  const draft = createLegacyReadyEmailDraftV1({
    organizationId: input.organizationId,
    userId: input.userId,
    idempotencyKey,
    requestedAt,
    leadRef: asText(input.payload.leadId) || to,
    displayName: asText(input.payload.recipientName) || null,
    to,
    subject,
    text: prepared.text,
    html: prepared.html,
  });
  await ensureMessagingDraftV1(draft);
  const messagingMetadata = createMessagingSendMetadataV1(draft, { idempotencyKey, provider: providerLabel, requestedAt });
  const dispatchResult = await dispatchOutboundMessage({
    draft,
    metadata: messagingMetadata,
    provider: {
      async send({ dispatchId }) {
        let quota;
        try {
          const quotaLimits = await getEffectiveDailyQuotaLimits({ userId: input.userId, organizationId: input.organizationId });
          quota = await reserveOutboundContactQuota({
            dispatchId,
            userId: input.userId,
            organizationId: input.organizationId,
            limit: quotaLimits.contact,
          });
        } catch (error) {
          throw new OutboundPreProviderDeferredError(
            'Contact quota could not be reserved. The provider was not invoked.',
            { code: 'quota_reservation_unavailable', cause: error },
          );
        }
        if (!quota.allowed) {
          return { outcome: 'deferred' as const, code: 'daily_quota_exceeded', message: `Cuota diaria de contactos excedida. Usado ${quota.count}/${quota.limit}.` };
        }
        const result = provider === 'google'
          ? await sendGmail(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey })
          : await sendOutlook(accessToken, to, subject, prepared.html, { textBody: prepared.text, unsubscribeUrl, idempotencyKey });
        const providerMessageId = String((result as any)?.id || (result as any)?.messageId || (result as any)?.internetMessageId || '').trim();
        return { outcome: 'accepted' as const, providerMessageId, response: result as Record<string, unknown> };
      },
    },
  });
  if (dispatchResult.status === 'deferred') {
    const current = new Date();
    const retryAtMs = Date.parse(dispatchResult.retry?.retryAt || '');
    const retryAfterMs = dispatchResult.retry?.retryAfterMs
      ?? (Number.isFinite(retryAtMs)
        ? Math.max(0, retryAtMs - current.getTime())
        : Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1) - current.getTime());
    throw new SupliaRuntimeError('deferred', dispatchResult.dispatch.errorMessage || 'El envío fue diferido.', {
      retryAfterMs,
      metadata: {
        status: 'deferred',
        code: dispatchResult.dispatch.errorCode || 'daily_quota_exceeded',
        dispatchId: dispatchResult.dispatch.id,
        retryAt: dispatchResult.retry?.retryAt || new Date(current.getTime() + retryAfterMs).toISOString(),
        retry: dispatchResult.retry,
      },
    });
  }
  if (dispatchResult.status === 'failed') {
    throw new SupliaRecipientDeliveryError('rejected', dispatchResult.dispatch.errorMessage || 'El proveedor rechazo el envio.', {
      status: dispatchResult.status,
      code: dispatchResult.dispatch.errorCode,
      dispatchId: dispatchResult.dispatch.id,
    });
  }
  if (dispatchResult.status !== 'sent') {
    throw new SupliaRecipientDeliveryError('unknown', dispatchResult.dispatch.errorMessage || `El envío quedó ${dispatchResult.status}.`, {
      status: dispatchResult.status,
      code: dispatchResult.dispatch.errorCode || 'delivery_outcome_unknown',
      dispatchId: dispatchResult.dispatch.id,
      requiresReconciliation: true,
    });
  }
  const result = dispatchResult.dispatch.providerResponse || {};

  const messageId = String((result as any)?.id || (result as any)?.messageId || '').trim() || null;
  const threadId = String((result as any)?.threadId || '').trim() || null;
  const conversationId = String((result as any)?.conversationId || '').trim() || null;
  const internetMessageId = String((result as any)?.internetMessageId || '').trim() || null;
  const threadKey = buildThreadKey({ provider: providerLabel, threadId, conversationId, internetMessageId, messageId });
  const dispatchId = dispatchResult.dispatch.id;
  const sentAt = dispatchResult.dispatch.completedAt || new Date().toISOString();
  const admin = getSupabaseAdminClient();

  const contactedPayload = {
    user_id: input.userId,
    organization_id: input.organizationId,
    lead_id: asText(input.payload.leadId) || null,
    name: asText(input.payload.recipientName) || null,
    email: to,
    company: asText(input.payload.company) || null,
    role: asText(input.payload.role) || null,
    status: 'sent',
    provider: providerLabel,
    subject,
    message_id: messageId,
    thread_id: threadId,
    conversation_id: conversationId,
    internet_message_id: internetMessageId,
    thread_key: threadKey,
    lifecycle_state: 'sent',
    last_event_type: 'sent',
    last_event_at: sentAt,
    sent_at: sentAt,
    created_at: sentAt,
    data: {
      source: 'suplia',
      supliaConversationId: input.conversationId || null,
      supliaActionId: input.actionId || null,
      draftId: draft.draftId,
      draftVersionId: draft.versionId,
      contentHash: messagingMetadata.contentHash,
      dispatchId,
    },
  };

  const persistedContacted = await persistSupliaSentHistory({
    admin,
    dispatchId,
    organizationId: input.organizationId,
    contactedPayload,
    eventPayload: {
      organization_id: input.organizationId,
      lead_id: asText(input.payload.leadId) || null,
      provider: providerLabel,
      event_type: 'sent',
      event_source: 'suplia',
      event_at: sentAt,
      thread_key: threadKey,
      message_id: messageId,
      internet_message_id: internetMessageId,
      meta: {
        subject,
        to,
        supliaConversationId: input.conversationId || null,
        supliaActionId: input.actionId || null,
        draftId: draft.draftId,
        draftVersionId: draft.versionId,
        contentHash: messagingMetadata.contentHash,
        dispatchId,
      },
    },
  });

  return {
    contactedId: persistedContacted.id,
    provider: persistedContacted.provider || providerLabel,
    to: persistedContacted.email || to,
    subject: persistedContacted.subject || subject,
    messageId: persistedContacted.message_id || messageId,
    threadId: persistedContacted.thread_id || threadId,
    conversationId: persistedContacted.conversation_id || conversationId,
    internetMessageId: persistedContacted.internet_message_id || internetMessageId,
    threadKey: persistedContacted.thread_key || threadKey,
    sentAt: persistedContacted.sent_at || persistedContacted.created_at || sentAt,
  };
}

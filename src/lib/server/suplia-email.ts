import { randomUUID } from 'crypto';

import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { sendGmail, sendOutlook } from '@/lib/server-email-sender';
import { normalizeConnectedEmailProvider, type ConnectedEmailProvider } from '@/lib/email-provider';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { checkAndConsumeDailyQuota, getEffectiveDailyQuotaLimits } from '@/lib/server/daily-quota-store';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { buildThreadKey, safeInsertEmailEvent } from '@/lib/email-observability';

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
  const requestedProvider = normalizeConnectedEmailProvider(asText(input.payload.provider));

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('El destinatario no es un email valido.');
  if (!subject) throw new Error('Falta el asunto del email.');
  if (!htmlBody) throw new Error('Falta el cuerpo del email.');

  const suppressed = await isEmailSuppressedForScope(to, { userId: input.userId, organizationId: input.organizationId });
  if (suppressed) throw new Error('El destinatario esta dado de baja o bloqueado por privacidad.');

  const domain = to.split('@')[1]?.trim().toLowerCase();
  if (domain) {
    const { data: blockedDomain, error } = await getSupabaseAdminClient()
      .from('excluded_domains')
      .select('id')
      .eq('organization_id', input.organizationId)
      .eq('domain', domain)
      .maybeSingle();
    if (error) throw error;
    if (blockedDomain) throw new Error(`El dominio ${domain} esta bloqueado por la organizacion.`);
  }

  const quotaLimits = await getEffectiveDailyQuotaLimits({ userId: input.userId, organizationId: input.organizationId });
  const quota = await checkAndConsumeDailyQuota({
    userId: input.userId,
    organizationId: input.organizationId,
    resource: 'contact',
    limit: quotaLimits.contact,
  });
  if (!quota.allowed) throw new Error(`Cuota diaria de contactos excedida. Usado ${quota.count}/${quota.limit}.`);

  const { provider, refreshToken } = await getRefreshToken(input.supabase, input.userId, requestedProvider);
  const accessToken = await refreshAccessToken(provider, refreshToken);
  if (!accessToken) throw new Error('No se pudo obtener access token para enviar.');

  const unsubscribeUrl = generateUnsubscribeLink(to, input.userId, input.organizationId);
  const providerLabel = provider === 'google' ? 'gmail' : 'outlook';
  const result = provider === 'google'
    ? await sendGmail(accessToken, to, subject, htmlBody, { textBody: textBody || undefined, unsubscribeUrl })
    : await sendOutlook(accessToken, to, subject, htmlBody, { textBody: textBody || undefined, unsubscribeUrl });

  const messageId = String((result as any)?.id || (result as any)?.messageId || '').trim() || null;
  const threadId = String((result as any)?.threadId || '').trim() || null;
  const conversationId = String((result as any)?.conversationId || '').trim() || null;
  const internetMessageId = String((result as any)?.internetMessageId || '').trim() || null;
  const threadKey = buildThreadKey({ provider: providerLabel, threadId, conversationId, internetMessageId, messageId });
  const sentAt = new Date().toISOString();
  const contactedId = randomUUID();

  const contactedPayload = {
    id: contactedId,
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
    },
  };

  const { error: contactedError } = await getSupabaseAdminClient().from('contacted_leads').insert(contactedPayload as any);
  if (contactedError) throw contactedError;

  await safeInsertEmailEvent(getSupabaseAdminClient(), {
    organization_id: input.organizationId,
    contacted_id: contactedId,
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
    },
  });

  return {
    contactedId,
    provider: providerLabel,
    to,
    subject,
    messageId,
    threadId,
    conversationId,
    internetMessageId,
    threadKey,
    sentAt,
  };
}

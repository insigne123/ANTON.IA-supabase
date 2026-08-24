import { normalizeConnectedEmailProvider, type ConnectedEmailProvider } from '@/lib/email-provider';
import { generateUnsubscribeLink } from '@/lib/unsubscribe-helpers';
import { isEmailSuppressedForScope } from '@/lib/server/privacy-subject-data';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { safeInsertEmailEvent } from '@/lib/email-observability';
import {
  MessagingDraftV1Schema,
  PendingMessagingApprovalV1,
  PendingMessagingPreflightV1,
  deterministicMessagingUuid,
} from '@/lib/messaging-contracts';
import { ensureMessagingDraftV1, getCurrentMessagingDraftVersionV1 } from '@/lib/server/messaging-drafts';
import { prepareOutboundEmail } from '@/lib/email-outbound';
import { SupliaRecipientDeliveryError } from '@/lib/server/suplia-bulk-send-outcomes';
import { ensureSupliaEmailReviewItem } from '@/lib/server/suplia-review-inbox';

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
  idempotencyKey?: unknown;
};

export type SupliaEmailReviewResult = {
  status: 'review_required';
  draftId: string;
  versionId: string;
  to: string;
  subject: string;
  provider: 'gmail' | 'outlook' | null;
  note: string;
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

export function createSupliaEmailReviewDraft(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
  requestedAt: string;
  leadRef?: string | null;
  displayName?: string | null;
  to: string;
  subject: string;
  text?: string | null;
  html?: string | null;
}) {
  const ids = supliaEmailReviewDraftIds(input);
  return MessagingDraftV1Schema.parse({
    schemaVersion: 1,
    draftId: ids.draftId,
    versionId: ids.versionId,
    organizationId: input.organizationId,
    userId: input.userId,
    researchSnapshotId: null,
    revision: 1,
    parentVersionId: null,
    lifecycle: 'draft',
    channel: 'email',
    recipient: {
      leadRef: asText(input.leadRef) || null,
      displayName: asText(input.displayName) || null,
      email: asText(input.to).toLowerCase(),
      linkedinUrl: null,
    },
    content: {
      subject: asText(input.subject),
      text: asText(input.text) || null,
      html: asText(input.html) || null,
    },
    approval: PendingMessagingApprovalV1,
    preflight: PendingMessagingPreflightV1,
    createdAt: input.requestedAt,
  });
}

function supliaEmailReviewDraftIds(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
}) {
  const identity = `${input.organizationId}:${input.userId}:${input.idempotencyKey}`;
  return {
    draftId: deterministicMessagingUuid(`suplia-review-draft:${identity}`),
    versionId: deterministicMessagingUuid(`suplia-review-version:${identity}`),
  };
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
    .select('id, lead_id, name, company, role, subject, message_id, thread_id, conversation_id, internet_message_id, thread_key, data')
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
  } else {
    // The dispatch finalizer may have created the canonical row first. Enrich it
    // with SUPL.IA-only context instead of appending a second sent contact.
    const { error: contactedUpdateError } = await input.admin
      .from('contacted_leads')
      .update({
        lead_id: existingContacted.lead_id || input.contactedPayload.lead_id || null,
        name: existingContacted.name || input.contactedPayload.name || null,
        company: existingContacted.company || input.contactedPayload.company || null,
        role: existingContacted.role || input.contactedPayload.role || null,
        subject: existingContacted.subject || input.contactedPayload.subject || null,
        message_id: existingContacted.message_id || input.contactedPayload.message_id || null,
        thread_id: existingContacted.thread_id || input.contactedPayload.thread_id || null,
        conversation_id: existingContacted.conversation_id || input.contactedPayload.conversation_id || null,
        internet_message_id: existingContacted.internet_message_id || input.contactedPayload.internet_message_id || null,
        thread_key: existingContacted.thread_key || input.contactedPayload.thread_key || null,
        data: {
          ...(existingContacted.data || {}),
          ...(input.contactedPayload.data || {}),
          dispatchId: input.dispatchId,
        },
      })
      .eq('id', contactedId);
    if (contactedUpdateError) throw contactedUpdateError;
  }

  const { data: persistedContacted, error: persistedContactedError } = await input.admin
    .from('contacted_leads')
    .select('id, provider, email, subject, message_id, thread_id, conversation_id, internet_message_id, thread_key, sent_at, created_at')
    .eq('id', contactedId)
    .single();
  if (persistedContactedError) throw persistedContactedError;

  const { data: existingSentEvent, error: existingSentEventError } = await input.admin
    .from('email_events')
    .select('id, meta')
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
  } else {
    const { error: eventUpdateError } = await input.admin
      .from('email_events')
      .update({
        meta: {
          ...(existingSentEvent.meta || {}),
          ...(input.eventPayload.meta || {}),
          dispatchId: input.dispatchId,
        },
      })
      .eq('id', existingSentEvent.id);
    if (eventUpdateError) throw eventUpdateError;
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

  const reviewRequestedAt = new Date().toISOString();
  const fallbackReviewKey = deterministicMessagingUuid([
    'suplia-review-fallback',
    input.organizationId,
    input.userId,
    to,
    subject,
    htmlBody,
    textBody,
    asText(input.payload.leadId),
  ].join(':'));
  const reviewSourceKey = asText(input.payload.idempotencyKey)
    || asText(input.actionId)
    || asText(input.conversationId)
    || fallbackReviewKey;
  const reviewIdempotencyKey = `suplia-review:${reviewSourceKey}:${to}`;
  const reviewDraftIds = supliaEmailReviewDraftIds({
    organizationId: input.organizationId,
    userId: input.userId,
    idempotencyKey: reviewIdempotencyKey,
  });
  let persistedDraft = await getCurrentMessagingDraftVersionV1({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId: reviewDraftIds.draftId,
  });

  if (!persistedDraft) {
    const reviewPrepared = prepareOutboundEmail({
      html: htmlBody,
      text: textBody || undefined,
      unsubscribeUrl: generateUnsubscribeLink(to, input.userId, input.organizationId),
    });
    const reviewDraft = createSupliaEmailReviewDraft({
      organizationId: input.organizationId,
      userId: input.userId,
      idempotencyKey: reviewIdempotencyKey,
      requestedAt: reviewRequestedAt,
      leadRef: asText(input.payload.leadId) || to,
      displayName: asText(input.payload.recipientName) || null,
      to,
      subject,
      text: reviewPrepared.text,
      html: reviewPrepared.html,
    });
    persistedDraft = await ensureMessagingDraftV1(reviewDraft);
  }
  await ensureSupliaEmailReviewItem({
    organizationId: input.organizationId,
    requestedByUserId: input.userId,
    senderUserId: input.userId,
    draft: persistedDraft,
    conversationId: input.conversationId,
    actionId: input.actionId,
    requestedProvider,
  });

  return {
    status: 'review_required' as const,
    draftId: persistedDraft.draftId,
    versionId: persistedDraft.versionId,
    to: persistedDraft.recipient.email || to,
    subject: persistedDraft.content.subject || subject,
    provider: requestedProvider === 'google' ? 'gmail' : requestedProvider,
    note: 'Correo preparado en el inbox de revision de SUPL.IA. Apruebalo ahi antes de enviarlo.',
  } satisfies SupliaEmailReviewResult;
}

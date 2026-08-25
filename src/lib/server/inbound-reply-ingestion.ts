import { createHash } from 'node:crypto';

export type InboundReplyIngestionResult = {
  inserted: boolean;
  reason: 'inserted' | 'duplicate' | 'globally_suppressed' | 'contact_missing' | 'contact_context_mismatch';
  eventKey: string;
  leadResponseId?: string | null;
  emailEventId?: string | null;
};

export type InboundReplyIngestionInput = {
  contactedId: string;
  recipientEmail?: string | null;
  provider: string;
  messageId?: string | null;
  internetMessageId?: string | null;
  eventType: 'reply' | 'bounce';
  eventSource: string;
  eventAt: string;
  threadKey?: string | null;
  threadId?: string | null;
  conversationId?: string | null;
  subject?: string | null;
  content?: string | null;
  preview?: string | null;
  classification: Record<string, unknown>;
};

function text(value: unknown) {
  return String(value || '').trim();
}

export function normalizeInboundProvider(value: string) {
  const provider = text(value).toLowerCase();
  if (provider === 'google') return 'gmail';
  if (provider === 'microsoft') return 'outlook';
  return provider;
}

export function createStableInboundMessageId(input: {
  provider: string;
  contactedId: string;
  sourceIdentity?: string | null;
  content?: string | null;
}) {
  const sourceIdentity = text(input.sourceIdentity);
  if (sourceIdentity) return sourceIdentity.replace(/^<|>$/g, '');

  const seed = [
    normalizeInboundProvider(input.provider),
    text(input.contactedId),
    text(input.content).replace(/\r\n?/g, '\n'),
  ].join('\u001f');
  return `internal:${createHash('sha256').update(seed, 'utf8').digest('hex')}`;
}

export async function safetyStopCampaignRecipientFromContacted(supabase: any, input: {
  contactedId: string;
  reason: 'recipient_replied' | 'recipient_bounced';
}) {
  const { data, error } = await supabase.rpc('safety_stop_campaign_recipient_from_contacted_v2', {
    p_contacted_id: text(input.contactedId),
    p_reason: input.reason,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.matched !== 'boolean') {
    throw new Error('Invalid Campaign V2 contacted safety-stop result');
  }
  return data as { matched: boolean; reason?: string; campaignSafetyStop?: Record<string, unknown> };
}

export async function ingestInboundReply(supabase: any, input: InboundReplyIngestionInput): Promise<InboundReplyIngestionResult> {
  const { data, error } = await supabase.rpc('ingest_inbound_reply_v1', {
    p_contacted_id: text(input.contactedId),
    p_recipient_email: text(input.recipientEmail) || null,
    p_provider: normalizeInboundProvider(input.provider),
    p_message_id: text(input.messageId) || null,
    p_internet_message_id: text(input.internetMessageId) || null,
    p_event_type: input.eventType,
    p_event_source: text(input.eventSource),
    p_event_at: input.eventAt,
    p_thread_key: text(input.threadKey) || null,
    p_thread_id: text(input.threadId) || null,
    p_conversation_id: text(input.conversationId) || null,
    p_subject: text(input.subject) || null,
    p_content: text(input.content) || null,
    p_preview: text(input.preview) || null,
    p_classification: input.classification,
  });

  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.inserted !== 'boolean' || typeof data.reason !== 'string') {
    throw new Error('Invalid inbound reply ingestion result');
  }
  return data as InboundReplyIngestionResult;
}

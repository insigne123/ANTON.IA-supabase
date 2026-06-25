import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';
import { buildThreadKey, deriveLifecycleState, safeInsertEmailEvent } from '@/lib/email-observability';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';
import { notificationService } from '@/lib/services/notification-service';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { stripHtmlToText } from '@/lib/email-outbound';

type ContactedRow = {
  id: string;
  user_id?: string | null;
  organization_id?: string | null;
  mission_id?: string | null;
  lead_id?: string | null;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  role?: string | null;
  subject?: string | null;
  sent_at?: string | null;
  status?: string | null;
  provider?: string | null;
  message_id?: string | null;
  thread_id?: string | null;
  conversation_id?: string | null;
  internet_message_id?: string | null;
  lifecycle_state?: string | null;
  reply_intent?: string | null;
};

type InboundReply = {
  provider: 'gmail' | 'outlook';
  id: string;
  threadId?: string | null;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: string | null;
  receivedAt: string;
  text?: string | null;
  html?: string | null;
  snippet?: string | null;
};

export type ReplySyncResult = {
  scanned: number;
  synced: number;
  skippedNoToken: number;
  errors: Array<{ contactedId?: string; email?: string | null; provider?: string | null; error: string }>;
};

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function extractEmailAddress(value?: string | null) {
  const raw = String(value || '').trim();
  const bracket = raw.match(/<([^>]+)>/);
  const candidate = (bracket?.[1] || raw).replace(/^mailto:/i, '').trim();
  const email = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  return email.toLowerCase();
}

function isSystemSender(address?: string | null) {
  return /mailer-daemon|postmaster|mail delivery subsystem|microsoftoffice|outlook/i.test(String(address || ''));
}

function getHeader(headers: any[] | undefined, name: string) {
  return (headers || []).find((header) => String(header?.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64Url(data?: string | null) {
  if (!data) return '';
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractGmailBodies(payload: any): { html?: string; text?: string } {
  let html = '';
  let text = '';
  const visit = (node: any) => {
    if (!node) return;
    const mime = String(node.mimeType || '').toLowerCase();
    const bodyData = decodeBase64Url(node?.body?.data);
    if (bodyData) {
      if (!html && mime === 'text/html') html = bodyData;
      if (!text && mime === 'text/plain') text = bodyData;
    }
    for (const part of Array.isArray(node.parts) ? node.parts : []) visit(part);
  };
  visit(payload);
  return { html: html || undefined, text: text || undefined };
}

function gmailMessageToReply(message: any): InboundReply {
  const headers = message?.payload?.headers || [];
  const bodies = extractGmailBodies(message?.payload);
  return {
    provider: 'gmail',
    id: message?.id,
    threadId: message?.threadId,
    internetMessageId: getHeader(headers, 'Message-ID').replace(/^<|>$/g, '') || null,
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    receivedAt: message?.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
    text: bodies.text,
    html: bodies.html,
    snippet: message?.snippet || null,
  };
}

function pickInboundCandidate(messages: InboundReply[], row: ContactedRow, myEmail?: string | null) {
  const leadEmail = normalizeEmail(row.email);
  const senderEmail = normalizeEmail(myEmail);
  const sentAtMs = row.sent_at ? Date.parse(row.sent_at) : 0;

  return messages
    .filter((message) => {
      const fromEmail = extractEmailAddress(message.from);
      const receivedAtMs = Date.parse(message.receivedAt || '');
      if (!message.id || Number.isNaN(receivedAtMs)) return false;
      if (sentAtMs && receivedAtMs <= sentAtMs + 1000) return false;
      if (senderEmail && fromEmail === senderEmail) return false;
      if (leadEmail && fromEmail !== leadEmail && !isSystemSender(fromEmail)) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0] || null;
}

async function fetchGmailMessage(accessToken: string, id: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchGmailThread(accessToken: string, threadId: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.messages) ? data.messages : [];
}

function gmailAfterDate(sentAt?: string | null) {
  const date = sentAt ? new Date(sentAt) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

async function searchGmailReplies(accessToken: string, row: ContactedRow) {
  const email = normalizeEmail(row.email);
  if (!email) return [];
  const query = `from:${email} after:${gmailAfterDate(row.sent_at)}`;
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!list.ok) return [];
  const data = await list.json();
  const ids = (data?.messages || []).map((item: any) => item.id).filter(Boolean);
  const messages = await Promise.all(ids.map((id: string) => fetchGmailMessage(accessToken, id)));
  return messages.filter(Boolean);
}

async function findGmailReply(accessToken: string, row: ContactedRow): Promise<InboundReply | null> {
  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).then((res) => res.ok ? res.json() : null).catch(() => null);
  const myEmail = profile?.emailAddress || null;

  let messages: any[] = [];
  if (row.thread_id) {
    messages = await fetchGmailThread(accessToken, row.thread_id);
  } else if (row.message_id) {
    const sent = await fetchGmailMessage(accessToken, row.message_id).catch(() => null);
    if (sent?.threadId) messages = await fetchGmailThread(accessToken, sent.threadId);
  }
  if (messages.length === 0) messages = await searchGmailReplies(accessToken, row);

  return pickInboundCandidate(messages.map(gmailMessageToReply), row, myEmail);
}

function escapeODataLiteral(value: string) {
  return value.replace(/'/g, "''");
}

async function graphFetch(accessToken: string, path: string) {
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ConsistencyLevel: 'eventual',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
}

function outlookMessageToReply(message: any): InboundReply {
  return {
    provider: 'outlook',
    id: message?.id,
    conversationId: message?.conversationId || null,
    internetMessageId: String(message?.internetMessageId || '').replace(/^<|>$/g, '') || null,
    subject: message?.subject || null,
    from: message?.from?.emailAddress?.address || null,
    receivedAt: message?.receivedDateTime || new Date().toISOString(),
    text: message?.bodyPreview || null,
    html: message?.body?.content || null,
    snippet: message?.bodyPreview || null,
  };
}

async function findOutlookReply(accessToken: string, row: ContactedRow): Promise<InboundReply | null> {
  const select = '$select=id,subject,conversationId,internetMessageId,from,receivedDateTime,bodyPreview,body';
  let items: any[] = [];

  if (row.conversation_id) {
    const params = new URLSearchParams();
    params.set('$filter', `conversationId eq '${escapeODataLiteral(row.conversation_id)}'`);
    params.set('$top', '25');
    const res = await graphFetch(accessToken, `/me/messages?${params.toString()}&${select}`);
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data?.value) ? data.value : [];
    }
  }

  if (items.length === 0 && row.email) {
    const params = new URLSearchParams();
    params.set('$search', `"from:${normalizeEmail(row.email)}"`);
    params.set('$top', '10');
    const res = await graphFetch(accessToken, `/me/messages?${params.toString()}&${select}`);
    if (res.ok) {
      const data = await res.json();
      items = Array.isArray(data?.value) ? data.value : [];
    }
  }

  return pickInboundCandidate(items.map(outlookMessageToReply), row, null);
}

function stripUnavailableColumns(data: any, mode: 'reply' | 'observability') {
  const copy = { ...data };
  if (mode === 'reply') {
    delete copy.reply_message_id;
    delete copy.reply_subject;
    delete copy.reply_snippet;
    return copy;
  }
  delete copy.thread_key;
  delete copy.lifecycle_state;
  delete copy.last_event_type;
  delete copy.last_event_at;
  return copy;
}

function isReplyColumnError(error: any) {
  const text = String(error?.message || error?.details || '').toLowerCase();
  return text.includes('reply_message_id') || text.includes('reply_subject') || text.includes('reply_snippet');
}

function isObservabilityColumnError(error: any) {
  const text = String(error?.message || error?.details || '').toLowerCase();
  return text.includes('thread_key') || text.includes('lifecycle_state') || text.includes('last_event_type') || text.includes('last_event_at');
}

async function updateContactedLead(supabase: any, contactedId: string, updateData: any) {
  let payload = updateData;
  let { error } = await supabase.from('contacted_leads').update(payload).eq('id', contactedId);
  if (error && isReplyColumnError(error)) {
    payload = stripUnavailableColumns(payload, 'reply');
    ({ error } = await supabase.from('contacted_leads').update(payload).eq('id', contactedId));
  }
  if (error && isObservabilityColumnError(error)) {
    payload = stripUnavailableColumns(payload, 'observability');
    ({ error } = await supabase.from('contacted_leads').update(payload).eq('id', contactedId));
  }
  if (error) throw error;
}

async function recordInboundReply(supabase: any, row: ContactedRow, reply: InboundReply) {
  const nowIso = new Date().toISOString();
  const receivedAt = reply.receivedAt || nowIso;
  const rawText = String(reply.text || stripHtmlToText(reply.html || '') || reply.snippet || '').trim();
  const preview = extractReplyPreview(rawText || reply.html || reply.snippet || '');
  const failure = detectDeliveryFailure({ subject: reply.subject, from: reply.from, text: rawText, html: reply.html });
  const threadKey = buildThreadKey({
    provider: reply.provider,
    threadId: reply.threadId || row.thread_id,
    conversationId: reply.conversationId || row.conversation_id,
    internetMessageId: reply.internetMessageId || row.internet_message_id,
    messageId: reply.id,
  });

  const updateData: any = {
    reply_message_id: reply.id || null,
    reply_subject: reply.subject || null,
    reply_preview: preview || null,
    reply_snippet: preview || null,
    last_reply_text: rawText.slice(0, 4000) || null,
    last_interaction_at: receivedAt,
    last_update_at: nowIso,
    thread_key: threadKey,
    thread_id: reply.threadId || row.thread_id || null,
    conversation_id: reply.conversationId || row.conversation_id || null,
    internet_message_id: row.internet_message_id || null,
    last_event_type: 'reply',
    last_event_at: receivedAt,
    lifecycle_state: deriveLifecycleState(row.lifecycle_state || row.status, 'reply'),
  };

  let classification: any = null;
  if (failure) {
    updateData.status = 'failed';
    updateData.replied_at = null;
    updateData.delivery_status = failure.deliveryStatus;
    updateData.bounced_at = receivedAt;
    updateData.bounce_category = failure.bounceCategory;
    updateData.bounce_reason = failure.bounceReason;
    updateData.reply_intent = failure.replyIntent;
    updateData.reply_sentiment = 'neutral';
    updateData.reply_confidence = 0.98;
    updateData.reply_summary = failure.bounceReason;
    updateData.campaign_followup_allowed = false;
    updateData.campaign_followup_reason = failure.campaignFollowupReason;
    updateData.evaluation_status = failure.evaluationStatus;
    classification = failure;
  } else {
    classification = await classifyReply(rawText || reply.snippet || '');
    updateData.status = 'replied';
    updateData.replied_at = receivedAt;
    updateData.delivery_status = 'replied';
    updateData.reply_intent = classification.intent;
    updateData.reply_sentiment = classification.sentiment;
    updateData.reply_confidence = classification.confidence;
    updateData.reply_summary = classification.summary || null;
    updateData.campaign_followup_allowed = classification.shouldContinue;
    updateData.campaign_followup_reason = classification.reason || null;
    updateData.evaluation_status = classification.intent === 'negative' || classification.intent === 'unsubscribe'
      ? 'do_not_contact'
      : classification.intent === 'meeting_request' || classification.intent === 'positive'
        ? 'action_required'
        : 'pending';
  }

  await updateContactedLead(supabase, row.id, updateData);

  await supabase.from('lead_responses').insert({
    lead_id: row.lead_id || null,
    contacted_id: row.id,
    organization_id: row.organization_id || null,
    mission_id: row.mission_id || null,
    email_message_id: reply.id || reply.internetMessageId || null,
    type: failure ? 'bounce' : 'reply',
    content: rawText || reply.html || reply.snippet || null,
    created_at: receivedAt,
  } as any);

  await safeInsertEmailEvent(supabase, {
    organization_id: row.organization_id || null,
    mission_id: row.mission_id || null,
    contacted_id: row.id,
    lead_id: row.lead_id || null,
    provider: reply.provider,
    event_type: failure ? 'bounce' : 'reply',
    event_source: 'reply_sync',
    event_at: receivedAt,
    thread_key: threadKey,
    message_id: reply.id || null,
    internet_message_id: reply.internetMessageId || null,
    meta: { subject: reply.subject || null, preview: preview || null },
  });

  if ((classification?.intent === 'unsubscribe' || classification?.intent === 'negative') && row.email) {
    await supabase.from('unsubscribed_emails').upsert({
      email: normalizeEmail(row.email),
      user_id: row.user_id || null,
      organization_id: row.organization_id || null,
      reason: `reply:${classification.intent}`,
    }, { onConflict: 'email,user_id,organization_id' } as any);
  }

  if (!failure && row.organization_id && (classification.intent === 'meeting_request' || classification.intent === 'positive')) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.antonia.ai';
    const summary = classification.summary || preview || 'Respuesta positiva detectada';
    await notificationService.sendAlert(
      row.organization_id,
      'Respuesta positiva detectada',
      `Lead ${row.email || row.lead_id || row.id} respondio: ${summary}. Revisar: ${appUrl}/contacted/replied`
    ).catch(() => null);

    await createAntoniaException(supabase, {
      organizationId: row.organization_id,
      missionId: row.mission_id || null,
      leadId: row.lead_id || null,
      category: 'positive_reply',
      severity: classification.intent === 'meeting_request' ? 'critical' : 'high',
      title: classification.intent === 'meeting_request' ? 'Lead solicito reunion' : 'Lead con respuesta positiva',
      description: summary,
      dedupeKey: `positive_reply_${row.id}`,
      payload: {
        lead: { id: row.lead_id, name: row.name, email: row.email, company: row.company, title: row.role },
        classification,
        preview,
        contactedId: row.id,
      },
    }).catch(() => null);

    if (row.lead_id) {
      await syncLeadAutopilotToCrm(supabase, {
        organizationId: row.organization_id,
        leadId: row.lead_id,
        stage: classification.intent === 'meeting_request' ? 'meeting' : 'engaged',
        notes: summary,
        nextAction: classification.intent === 'meeting_request' ? 'Confirmar reunion y preparar contexto comercial' : 'Responder rapido y proponer siguiente paso',
        nextActionType: classification.intent === 'meeting_request' ? 'meeting_handoff' : 'hot_reply_followup',
        nextActionDueAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        autopilotStatus: classification.intent === 'meeting_request' ? 'meeting_requested' : 'positive_reply',
        lastAutopilotEvent: classification.intent,
      }).catch(() => null);
    }
  }

  if (!failure && row.organization_id && row.user_id && classification.intent !== 'negative' && classification.intent !== 'unsubscribe' && classification.intent !== 'delivery_failure') {
    await maybeEscalateReplyReviewFromContactedId({
      supabase,
      organizationId: row.organization_id,
      userId: row.user_id,
      contactedId: row.id,
      rawReply: rawText,
      replySubject: reply.subject || undefined,
    }).catch((error) => console.warn('[reply-sync] escalation failed:', error));
  }
}

export async function syncRepliesForOrganization(supabase: any, input: { organizationId: string; userId?: string | null; limit?: number }): Promise<ReplySyncResult> {
  const limit = Math.min(Math.max(Number(input.limit || 200), 1), 500);
  const result: ReplySyncResult = { scanned: 0, synced: 0, skippedNoToken: 0, errors: [] };

  let query = supabase
    .from('contacted_leads')
    .select('id, user_id, organization_id, mission_id, lead_id, name, email, company, role, subject, sent_at, status, provider, message_id, thread_id, conversation_id, internet_message_id, lifecycle_state, reply_intent, replied_at')
    .eq('organization_id', input.organizationId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (input.userId) query = query.eq('user_id', input.userId);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).filter((row: any) => row.provider === 'gmail' || row.provider === 'outlook').filter((row: any) => row.status !== 'replied' && !row.replied_at && row.status !== 'failed') as ContactedRow[];
  result.scanned = rows.length;

  const tokenCache = new Map<string, string | null>();

  for (const row of rows) {
    const provider = row.provider === 'gmail' ? 'google' : 'outlook';
    const tokenKey = `${row.user_id || ''}:${provider}`;
    try {
      if (!row.user_id) {
        result.skippedNoToken += 1;
        continue;
      }

      if (!tokenCache.has(tokenKey)) {
        const token = await tokenService.getToken(supabase, row.user_id, provider as 'google' | 'outlook');
        if (!token?.refresh_token) {
          tokenCache.set(tokenKey, null);
        } else if (provider === 'google') {
          const refreshed = await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!);
          tokenCache.set(tokenKey, refreshed.access_token || null);
        } else {
          const refreshed = await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common');
          tokenCache.set(tokenKey, refreshed.access_token || null);
        }
      }

      const accessToken = tokenCache.get(tokenKey);
      if (!accessToken) {
        result.skippedNoToken += 1;
        continue;
      }

      const reply = row.provider === 'gmail'
        ? await findGmailReply(accessToken, row)
        : await findOutlookReply(accessToken, row);

      if (!reply) continue;
      await recordInboundReply(supabase, row, reply);
      result.synced += 1;
    } catch (err: any) {
      result.errors.push({ contactedId: row.id, email: row.email, provider: row.provider, error: err?.message || String(err) });
    }
  }

  return result;
}

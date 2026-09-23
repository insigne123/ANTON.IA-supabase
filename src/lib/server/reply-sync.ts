import { classifyReply, extractReplyPreview } from '@/lib/reply-classifier';
import { detectDeliveryFailure } from '@/lib/delivery-failure-detector';
import { buildThreadKey } from '@/lib/email-observability';
import { tokenService } from '@/lib/services/token-service';
import { refreshGoogleToken, refreshMicrosoftToken } from '@/lib/server-auth-helpers';
import { maybeEscalateReplyReviewFromContactedId } from '@/lib/server/antonia-reply-escalation';
import { notificationService } from '@/lib/services/notification-service';
import { createAntoniaException } from '@/lib/server/antonia-exceptions';
import { syncLeadAutopilotToCrm } from '@/lib/server/crm-autopilot';
import { stripHtmlToText } from '@/lib/email-outbound';
import { ingestInboundReply } from '@/lib/server/inbound-reply-ingestion';
import { isExplicitOptOut } from '@/lib/reply-text';
import { conversationAdvice } from '@/lib/conversation-advice';
import { replySyncDueFilter } from '@/lib/server/reply-sync-policy';

export { ingestInboundReply } from '@/lib/server/inbound-reply-ingestion';
export type { InboundReplyIngestionResult } from '@/lib/server/inbound-reply-ingestion';

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
  replied_at?: string | null;
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
  references?: string | null;
};

export type ReplySyncResult = {
  scanned: number;
  synced: number;
  skippedNoToken: number;
  nextCursor: string | null;
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
    receivedAt: message?.internalDate && Number.isFinite(Number(message.internalDate)) ? new Date(Number(message.internalDate)).toISOString() : '',
    text: bodies.text,
    html: bodies.html,
    snippet: message?.snippet || null,
    references: `${getHeader(headers, 'In-Reply-To')} ${getHeader(headers, 'References')}`,
  };
}

export function inboundCandidates(messages: InboundReply[], row: ContactedRow, myEmail?: string | null) {
  const leadEmail = normalizeEmail(row.email);
  const senderEmail = normalizeEmail(myEmail);
  const sentAtMs = row.sent_at ? Date.parse(row.sent_at) : 0;

  return messages
    .filter((message) => {
      const fromEmail = extractEmailAddress(message.from);
      const receivedAtMs = Date.parse(message.receivedAt || '');
      if (!message.id || Number.isNaN(receivedAtMs) || !leadEmail || !Number.isFinite(sentAtMs) || !sentAtMs) return false;
      if (sentAtMs && receivedAtMs <= sentAtMs + 1000) return false;
      if (senderEmail && fromEmail === senderEmail) return false;
      const threadMatches = Boolean(row.thread_id && message.threadId === row.thread_id)
        || Boolean(row.conversation_id && message.conversationId === row.conversation_id);
      const parentId = String(row.internet_message_id || '').replace(/^<|>$/g, '');
      const references: string[] = String(message.references || '').match(/<[^<>\s]+>/g) || [];
      if (!threadMatches && !(parentId && references.includes(`<${parentId}>`))) return false;
      if (fromEmail !== leadEmail && !(isSystemSender(fromEmail) && detectDeliveryFailure({ subject: message.subject, from: message.from, text: message.text, html: message.html }))) return false;
      return true;
    })
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

function pickInboundCandidate(messages: InboundReply[], row: ContactedRow, myEmail?: string | null) {
  return inboundCandidates(messages, row, myEmail).at(-1) || null;
}

export type MailboxMessage = InboundReply & { to: string[]; direction: 'inbound' | 'outbound'; source: 'provider' };

export async function mailboxAccessToken(supabase: any, userId: string, provider: string): Promise<string | null> {
  const token = await tokenService.getToken(supabase, userId, provider === 'gmail' ? 'google' : 'outlook');
  if (!token?.refresh_token) return null;
  const refreshed = provider === 'gmail'
    ? await refreshGoogleToken(token.refresh_token, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!)
    : await refreshMicrosoftToken(token.refresh_token, process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!, process.env.AZURE_AD_CLIENT_SECRET!, process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID || 'common');
  return refreshed.access_token || null;
}

/** Read only the verified thread. Bounded Graph pagination never claims full coverage. */
export async function readMailboxConversation(accessToken: string, row: ContactedRow): Promise<{ messages: MailboxMessage[]; complete: boolean }> {
  let messages: MailboxMessage[] = [];
  let complete = true;
  if (row.provider === 'gmail') {
    let threadId = row.thread_id;
    if (!threadId && row.message_id) threadId = (await fetchGmailMessage(accessToken, row.message_id)).threadId;
    const raw = threadId ? await fetchGmailThread(accessToken, threadId) : await searchGmailReplies(accessToken, row);
    complete = Boolean(threadId);
    messages = raw.filter((message: any) => !message.labelIds?.includes('DRAFT')).map((message: any) => ({ ...gmailMessageToReply(message), to: getHeader(message.payload?.headers, 'To').split(',').map(extractEmailAddress), direction: message.labelIds?.includes('SENT') ? 'outbound' : 'inbound', source: 'provider' }));
    if (!threadId) {
      const verified = new Set(inboundCandidates(messages, row).map(m => m.id));
      messages = messages.filter(m => verified.has(m.id));
    }
  } else if (row.provider === 'outlook') {
    let conversationId = row.conversation_id;
    if (!conversationId && row.message_id) {
      const response = await graphFetch(accessToken, `/me/messages/${encodeURIComponent(row.message_id)}?$select=conversationId`);
      if (!response.ok) throw new Error('No se pudo consultar el mensaje original.');
      conversationId = (await response.json()).conversationId;
    }
    if (!conversationId) return { messages: [], complete: false };
    const profileResponse = await graphFetch(accessToken, '/me?$select=mail,userPrincipalName');
    if (!profileResponse.ok) throw new Error('No se pudo verificar el remitente.');
    const profile = await profileResponse.json();
    const ownEmails = [profile.mail, profile.userPrincipalName].filter(Boolean).map(normalizeEmail);
    const params = new URLSearchParams({ '$filter': `conversationId eq '${escapeODataLiteral(conversationId)}'`, '$top': '100', '$select': 'id,subject,conversationId,internetMessageId,internetMessageHeaders,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,body,isDraft' });
    let next: string | null = `/me/messages?${params}`;
    for (let page = 0; next && page < 10; page++) {
      const response = await graphFetch(accessToken, next);
      if (!response.ok) throw new Error(`Outlook conversation lookup failed (${response.status})`);
      const data = await response.json();
      messages.push(...(data.value || []).filter((message: any) => !message.isDraft).map((message: any): MailboxMessage => {
        const direction = ownEmails.includes(extractEmailAddress(message.from?.emailAddress?.address)) ? 'outbound' : 'inbound';
        return { ...outlookMessageToReply(message), receivedAt: direction === 'outbound' ? message.sentDateTime || message.receivedDateTime : message.receivedDateTime, text: message.body?.contentType === 'text' ? message.body.content : stripHtmlToText(message.body?.content || message.bodyPreview || ''), to: (message.toRecipients || []).map((to: any) => extractEmailAddress(to.emailAddress?.address)), direction, source: 'provider' };
      }));
      const link = data['@odata.nextLink'];
      if (link && !String(link).startsWith('https://graph.microsoft.com/v1.0/')) throw new Error('Invalid Graph pagination URL');
      next = link ? String(link).slice('https://graph.microsoft.com/v1.0'.length) : null;
    }
    complete = !next;
  }
  // Never expose unrelated participants simply because a provider grouped a thread.
  const email = normalizeEmail(row.email);
  return { complete, messages: messages.filter(message => Number.isFinite(Date.parse(message.receivedAt)) && (extractEmailAddress(message.from) === email || (message.direction === 'outbound' && message.to.includes(email)) || (isSystemSender(message.from) && detectDeliveryFailure({ subject: message.subject, from: message.from, text: message.text, html: message.html })))).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)) };
}

async function fetchGmailMessage(accessToken: string, id: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gmail message lookup failed (${res.status})`);
  return res.json();
}

async function fetchGmailThread(accessToken: string, threadId: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Gmail thread lookup failed (${res.status})`);
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
  if (!list.ok) throw new Error(`Gmail search failed (${list.status})`);
  const data = await list.json();
  const ids = (data?.messages || []).map((item: any) => item.id).filter(Boolean);
  const messages = await Promise.all(ids.map((id: string) => fetchGmailMessage(accessToken, id)));
  return messages.filter(Boolean);
}

export async function findGmailReply(accessToken: string, row: ContactedRow): Promise<InboundReply | null> {
  const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  }).then((res) => {
    if (!res.ok) throw new Error(`Gmail profile lookup failed (${res.status})`);
    return res.json();
  });
  const myEmail = profile?.emailAddress || null;

  let messages: any[] = [];
  if (row.thread_id) {
    messages = await fetchGmailThread(accessToken, row.thread_id);
  } else if (row.message_id) {
    const sent = await fetchGmailMessage(accessToken, row.message_id);
    if (sent?.threadId) {
      row = { ...row, thread_id: sent.threadId };
      messages = await fetchGmailThread(accessToken, sent.threadId);
    }
  }
  if (messages.length === 0 && !row.thread_id && row.internet_message_id) messages = await searchGmailReplies(accessToken, row);

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
    receivedAt: message?.receivedDateTime || '',
    text: message?.bodyPreview || null,
    html: message?.body?.content || null,
    snippet: message?.bodyPreview || null,
    references: `${getHeader(message?.internetMessageHeaders, 'In-Reply-To')} ${getHeader(message?.internetMessageHeaders, 'References')}`,
  };
}

export async function findOutlookReply(accessToken: string, row: ContactedRow): Promise<InboundReply | null> {
  const sentAt = Date.parse(row.sent_at || '');
  if (!Number.isFinite(sentAt)) return null;
  const select = '$select=id,subject,conversationId,internetMessageId,internetMessageHeaders,from,receivedDateTime,bodyPreview,body';
  let items: any[] = [];

  if (row.conversation_id) {
    const params = new URLSearchParams();
    params.set('$filter', `receivedDateTime gt ${new Date(sentAt).toISOString()} and conversationId eq '${escapeODataLiteral(row.conversation_id)}'`);
    params.set('$top', '25');
    params.set('$orderby', 'receivedDateTime desc');
    const res = await graphFetch(accessToken, `/me/messages?${params.toString()}&${select}`);
    if (!res.ok) throw new Error(`Outlook conversation lookup failed (${res.status})`);
    {
      const data = await res.json();
      items = Array.isArray(data?.value) ? data.value : [];
    }
  }

  if (items.length === 0 && !row.conversation_id && row.internet_message_id && row.email) {
    const params = new URLSearchParams();
    params.set('$search', `"from:${normalizeEmail(row.email)}"`);
    params.set('$top', '10');
    const res = await graphFetch(accessToken, `/me/messages?${params.toString()}&${select}`);
    if (!res.ok) throw new Error(`Outlook search failed (${res.status})`);
    {
      const data = await res.json();
      items = Array.isArray(data?.value) ? data.value : [];
    }
  }

  return pickInboundCandidate(items.map(outlookMessageToReply), row, null);
}

async function recordInboundReply(supabase: any, row: ContactedRow, reply: InboundReply) {
  const receivedAt = reply.receivedAt || new Date().toISOString();
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

  let classification: any = null;
  if (failure) {
    classification = {
      intent: failure.replyIntent,
      sentiment: 'neutral',
      confidence: 0.98,
      summary: failure.bounceReason,
      reason: failure.campaignFollowupReason,
      shouldContinue: false,
      evaluationStatus: failure.evaluationStatus,
      deliveryStatus: failure.deliveryStatus,
      bounceCategory: failure.bounceCategory,
      bounceReason: failure.bounceReason,
    };
  } else {
    classification = await classifyReply(rawText || reply.snippet || '');
    classification.evaluationStatus = classification.intent === 'negative' || classification.intent === 'unsubscribe'
      ? 'do_not_contact'
      : classification.intent === 'meeting_request' || classification.intent === 'positive'
        ? 'action_required'
        : 'pending';
  }

  const ingestion = await ingestInboundReply(supabase, {
    contactedId: row.id,
    recipientEmail: normalizeEmail(row.email),
    provider: reply.provider,
    messageId: reply.id,
    internetMessageId: reply.internetMessageId,
    eventType: failure ? 'bounce' : 'reply',
    eventSource: 'reply_sync',
    eventAt: receivedAt,
    threadKey,
    threadId: reply.threadId || row.thread_id,
    conversationId: reply.conversationId || row.conversation_id,
    subject: reply.subject,
    content: rawText || reply.html || reply.snippet,
    preview,
    classification,
  });

  if (!ingestion.inserted) return false;
  if (row.organization_id && row.user_id) {
    const advice = await supabase.rpc('update_contacted_work', { p_org: row.organization_id, p_user: row.user_id, p_contact: row.id, p_kind: 'advice', p_value: conversationAdvice(classification, reply.id) });
    if (advice.error) console.warn('[reply-sync] next action persistence failed', advice.error.code);
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
        stage: 'engaged',
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

  return true;
}

export async function syncRepliesForOrganization(supabase: any, input: { organizationId: string; userId?: string | null; limit?: number; cursor?: string | null; fairQueue?: boolean; contactedIds?: string[] }): Promise<ReplySyncResult> {
  const limit = Number.isFinite(input.limit) ? Math.min(Math.max(Math.trunc(input.limit!), 1), 500) : 200;
  const result: ReplySyncResult = { scanned: 0, synced: 0, skippedNoToken: 0, errors: [], nextCursor: null };

  let query = supabase
    .from('contacted_leads')
    .select('id, user_id, organization_id, mission_id, lead_id, name, email, company, role, subject, sent_at, status, provider, message_id, thread_id, conversation_id, internet_message_id, lifecycle_state, reply_intent, replied_at')
    .eq('organization_id', input.organizationId)
    .in('provider', ['gmail', 'outlook'])
    .not('sent_at', 'is', null)
    .or('status.is.null,status.not.in.(scheduled,failed)')
    .or(replySyncDueFilter());
  if (input.fairQueue) query = query.order('reply_sync_attempted_at', { ascending: true, nullsFirst: true });
  query = query.order('id', { ascending: true }).limit(limit + 1);
  if (input.contactedIds) query = query.in('id', input.contactedIds);

  if (input.userId) query = query.eq('user_id', input.userId);
  if (input.cursor) query = query.gt('id', input.cursor);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).slice(0, limit) as ContactedRow[];
  result.nextCursor = !input.fairQueue && (data || []).length > limit ? rows[rows.length - 1].id : null;
  result.scanned = rows.length;

  const tokenCache = new Map<string, string | null>();
  const tokenErrors = new Map<string, unknown>();
  // One scoped attempt write for the entire page instead of one per contact.
  // Returning only ids: full rows would multiply PostgREST egress every tick.
  if (rows.length) {
    const attempt = await supabase.from('contacted_leads').update({ reply_sync_attempted_at: new Date().toISOString() })
      .eq('organization_id', input.organizationId).in('id', rows.map(row => row.id)).select('id');
    if (attempt.error) throw attempt.error;
  }
  const errorsByState = new Map<string, string[]>();
  const noteError = (state: string, id: string) => errorsByState.set(state, [...(errorsByState.get(state) || []), id]);

  for (const row of rows) {
    const provider = row.provider === 'gmail' ? 'google' : 'outlook';
    const tokenKey = `${row.user_id || ''}:${provider}`;
    try {
      if (!row.user_id) {
        result.skippedNoToken += 1;
        noteError('connection_required', row.id);
        continue;
      }

      if (tokenErrors.has(tokenKey)) throw tokenErrors.get(tokenKey);
      if (!tokenCache.has(tokenKey)) {
        try { tokenCache.set(tokenKey, await mailboxAccessToken(supabase, row.user_id, row.provider || '')); }
        catch (error) { tokenErrors.set(tokenKey, error); throw error; }
      }

      const accessToken = tokenCache.get(tokenKey);
      if (!accessToken) {
        result.skippedNoToken += 1;
        noteError('connection_required', row.id);
        continue;
      }

      const conversation = await readMailboxConversation(accessToken, row);
      const boundRow = { ...row, thread_id: row.thread_id || conversation.messages.find(m => m.threadId)?.threadId, conversation_id: row.conversation_id || conversation.messages.find(m => m.conversationId)?.conversationId };
      for (const reply of inboundCandidates(conversation.messages, boundRow)) {
        if (row.replied_at && Date.parse(reply.receivedAt) <= Date.parse(row.replied_at)) {
          // Backfill must not replace the latest conversation state. An older
          // explicit opt-out still needs suppression even if first polling missed it.
          if (isExplicitOptOut(reply.text || reply.html || '')) {
            const stop = await supabase.rpc('record_scoped_unsubscribe_v2', { p_email: normalizeEmail(row.email), p_user_id: row.user_id, p_organization_id: input.organizationId, p_reason: 'reply_opt_out_backfill' });
            if (stop.error) throw stop.error;
          }
          continue;
        }
        // The ingestion RPC owns idempotency through provider message aliases.
        const inserted = await recordInboundReply(supabase, row, reply);
        if (inserted) result.synced += 1;
      }
      const outboundAt = conversation.messages.filter(m => m.direction === 'outbound').at(-1)?.receivedAt;
      if (!conversation.complete) {
        noteError('incomplete_thread', row.id);
        result.errors.push({ contactedId: row.id, error: 'incomplete_thread' });
        continue;
      }
      const saved = await supabase.from('contacted_leads').update({
        ...(conversation.complete ? { reply_sync_succeeded_at: new Date().toISOString() } : {}),
        reply_sync_error: conversation.complete ? null : 'incomplete_thread',
        ...(outboundAt ? { conversation_outbound_at: outboundAt } : {}),
      }).eq('id', row.id).eq('organization_id', input.organizationId).select('id');
      if (saved.error) throw saved.error;
      if (!conversation.complete) result.errors.push({ contactedId: row.id, error: 'incomplete_thread' });
    } catch (err: any) {
      noteError('sync_failed', row.id);
      result.errors.push({ contactedId: row.id, email: row.email, provider: row.provider, error: err?.message || String(err) });
    }
  }

  for (const [state, ids] of errorsByState) {
    const saved = await supabase.from('contacted_leads').update({ reply_sync_error: state })
      .eq('organization_id', input.organizationId).in('id', ids).select('id');
    if (saved.error) throw saved.error;
  }

  return result;
}

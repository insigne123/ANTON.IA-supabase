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
import { shouldGloballySuppressReply } from '@/lib/contact-history-guard';
import {
  ingestInboundReply,
  recordInboundUnsubscribe,
} from '@/lib/server/inbound-reply-ingestion';

export {
  ingestInboundReply,
  recordInboundUnsubscribe,
} from '@/lib/server/inbound-reply-ingestion';
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

  if (shouldGloballySuppressReply(classification) && row.email) {
    const suppression = await recordInboundUnsubscribe(supabase, {
      contactedId: row.id,
      recipientEmail: normalizeEmail(row.email),
      eventKey: ingestion.eventKey,
    });
    if (!suppression.recorded) return false;
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

  return true;
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
      const inserted = await recordInboundReply(supabase, row, reply);
      if (inserted) result.synced += 1;
    } catch (err: any) {
      result.errors.push({ contactedId: row.id, email: row.email, provider: row.provider, error: err?.message || String(err) });
    }
  }

  return result;
}

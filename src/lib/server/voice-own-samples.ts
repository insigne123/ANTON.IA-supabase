/**
 * A person's own emails as the samples of their voice: the search in what they sent, and what they chose to keep
 * (src/lib/voice-own-samples.ts says which emails qualify; «Tu voz» in «Firmas y estilo» is the screen).
 *
 * The mailbox is read only here and only when the person asks: the Sent folder of the last 90 days is listed by its headers, the
 * messages that cannot be a sample (replies, forwards, internal or mass mail, mail the app sent) are left unopened, and the text of at
 * most 40 of the rest is read to offer up to eight. Nothing of the search is stored. What the person confirms goes to
 * `user_voice_samples`, which only the server reads, for that person alone.
 */
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { extractEmailAddress, mailboxAccessToken } from '@/lib/server/reply-sync';
import { organizationVoiceSamples } from '@/lib/server/outreach-voice-samples';
import { OWN_VOICE_SAMPLES_MAX, isOwnWritingSubject, ownVoiceSampleProblem, voiceCandidates, type SentEmail, type VoiceCandidate } from '@/lib/voice-own-samples';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOOKBACK_DAYS = 90;
const LISTED = 150;
const READ = 40;

export type VoiceMailbox = 'gmail' | 'outlook';
export type OwnVoiceSample = { id: string; source: 'mailbox' | 'manual'; provider: VoiceMailbox | null; subject: string | null; body: string; sentAt: string | null; createdAt: string };
export type VoiceScan = { provider: VoiceMailbox | null; candidates: VoiceCandidate[]; reason?: 'not_connected' | 'reconnect' | 'nothing_found' };
type Listed = { id: string; internetMessageId: string | null; subject: string; sentAt: string; recipients: string[]; from: string; reply: boolean };

const header = (headers: Array<{ name?: string; value?: string }> | undefined, name: string) =>
  (headers || []).find((item) => String(item?.name || '').toLowerCase() === name)?.value || '';
const addresses = (value: string) => value.split(',').map((part) => extractEmailAddress(part)).filter(Boolean) as string[];

function decodeBase64Url(data: string) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** The text of an HTML body, with its line breaks where the paragraphs were. */
export function htmlAsText(html: string) {
  return String(html || '')
    .replace(/<(?:style|script|head)[\s\S]*?<\/(?:style|script|head)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The text a Gmail message carries: its plain part, or its HTML part as text. */
export function gmailBodyText(payload: any): string {
  let text = '';
  let html = '';
  const walk = (part: any) => {
    if (!part) return;
    const data = part.body?.data ? decodeBase64Url(part.body.data) : '';
    if (part.mimeType === 'text/plain' && !part.filename && !text) text = data;
    if (part.mimeType === 'text/html' && !part.filename && !html) html = data;
    for (const child of part.parts || []) walk(child);
  };
  walk(payload);
  return text.trim() ? text : htmlAsText(html);
}

async function chunked<T, R>(items: T[], size: number, run: (item: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    for (const result of await Promise.all(items.slice(index, index + size).map((item) => run(item).catch(() => null)))) if (result) out.push(result);
  }
  return out;
}

async function gmailListed(accessToken: string): Promise<Listed[]> {
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const ids: string[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 2 && ids.length < LISTED; page += 1) {
    const params = new URLSearchParams({ q: `in:sent newer_than:${LOOKBACK_DAYS}d -in:chats`, maxResults: '100', fields: 'messages(id),nextPageToken' });
    if (pageToken) params.set('pageToken', pageToken);
    const listed = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: authorization, cache: 'no-store' });
    if (!listed.ok) throw new Error(`Gmail sent list failed (${listed.status})`);
    const body = await listed.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    ids.push(...(body.messages || []).map((message) => message.id));
    pageToken = body.nextPageToken || null;
    if (!pageToken) break;
  }
  const names = ['To', 'Cc', 'From', 'Subject', 'Message-ID', 'In-Reply-To', 'References'].map((name) => `metadataHeaders=${name}`).join('&');
  return chunked(ids.slice(0, LISTED), 10, async (id) => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&${names}&fields=id,internalDate,payload/headers`,
      { headers: authorization, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const headers = data?.payload?.headers;
    return {
      id: String(data?.id || id), internetMessageId: header(headers, 'message-id') || null, subject: header(headers, 'subject').slice(0, 500),
      sentAt: new Date(Number(data?.internalDate || 0)).toISOString(), from: extractEmailAddress(header(headers, 'from')) || '',
      recipients: [...addresses(header(headers, 'to')), ...addresses(header(headers, 'cc'))],
      reply: Boolean(header(headers, 'in-reply-to') || header(headers, 'references')),
    } satisfies Listed;
  });
}

async function gmailBody(accessToken: string, id: string) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full&fields=payload`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  if (!res.ok) return null;
  return gmailBodyText((await res.json())?.payload);
}

async function outlookListed(accessToken: string): Promise<Listed[]> {
  const out: Listed[] = [];
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const first = (fields: string) => `/me/mailFolders/sentitems/messages?${new URLSearchParams({
    '$filter': `sentDateTime ge ${since}`, '$orderby': 'sentDateTime desc', '$top': '50', '$select': fields,
  })}`;
  const FIELDS = 'id,internetMessageId,subject,sentDateTime,toRecipients,ccRecipients,from';
  let path: string | null = first(`${FIELDS},conversationIndex`);
  for (let page = 0; page < 3 && path && out.length < LISTED; page += 1) {
    let res: Response = await fetch(`${GRAPH_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
    // A mailbox that will not give the conversation index is still read: an answer is then told by its subject and by the thread under it.
    if (res.status === 400 && page === 0) {
      res = await fetch(`${GRAPH_BASE}${first(FIELDS)}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
    }
    if (!res.ok) throw new Error(`Outlook sent list failed (${res.status})`);
    const data: { value?: unknown[]; '@odata.nextLink'?: string } = await res.json();
    for (const item of (data.value || []) as Array<Record<string, any>>) {
      out.push({
        id: String(item.id), internetMessageId: item.internetMessageId || null, subject: String(item.subject || '').slice(0, 500), sentAt: String(item.sentDateTime || ''),
        from: String(item.from?.emailAddress?.address || '').toLowerCase(),
        recipients: [...(item.toRecipients || []), ...(item.ccRecipients || [])].map((person: any) => String(person?.emailAddress?.address || '').toLowerCase()).filter(Boolean),
        // The first message of a conversation carries a 22-byte index (32 characters in base64); each answer adds five bytes.
        reply: String(item.conversationIndex || '').length > 32,
      });
    }
    const next: string | null = data['@odata.nextLink'] ? String(data['@odata.nextLink']) : null;
    if (next && !next.startsWith(GRAPH_BASE)) throw new Error('Invalid Graph pagination URL');
    path = next ? next.slice(GRAPH_BASE.length) : null;
  }
  return out;
}

async function outlookBody(accessToken: string, id: string) {
  const res = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?$select=body`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', Prefer: 'outlook.body-content-type="text"' }, cache: 'no-store' });
  if (!res.ok) return null;
  const body = (await res.json())?.body;
  return body?.contentType === 'html' ? htmlAsText(String(body?.content || '')) : String(body?.content || '');
}

/** The mailboxes a person connected, the one that sends first. */
export async function connectedVoiceMailboxes(userId: string): Promise<VoiceMailbox[]> {
  const tokens = await getSupabaseAdminClient().from('provider_tokens').select('provider').eq('user_id', userId);
  if (tokens.error) throw tokens.error;
  const providers = (tokens.data || []).map((row: { provider: string }) => (row.provider === 'google' ? 'gmail' : String(row.provider)));
  return (['outlook', 'gmail'] as const).filter((value) => providers.includes(value));
}

/**
 * The emails of the person that can be samples of their voice, from the mailbox they connected. Only on their request; never stored.
 * `read`: how the mailbox is read, for tests.
 */
export async function scanSentForVoice(userId: string, read?: { listed: (provider: VoiceMailbox) => Promise<Listed[]>; body: (provider: VoiceMailbox, id: string) => Promise<string | null>; mailboxes?: VoiceMailbox[]; skip?: Set<string> }): Promise<VoiceScan> {
  const admin = read ? null : getSupabaseAdminClient();
  const mailboxes = read?.mailboxes ?? await connectedVoiceMailboxes(userId);
  if (!mailboxes.length) return { provider: null, candidates: [], reason: 'not_connected' };
  // What the app sent for this person was written by the app: it is never a sample of how they write.
  const skip = read?.skip ?? new Set<string>();
  if (admin) {
    const sent = await admin.from('contacted_leads').select('message_id,internet_message_id').eq('user_id', userId)
      .gte('sent_at', new Date(Date.now() - (LOOKBACK_DAYS + 7) * 86_400_000).toISOString()).limit(3000);
    for (const row of (sent.data || []) as Array<{ message_id: string | null; internet_message_id: string | null }>) {
      if (row.message_id) skip.add(String(row.message_id));
      if (row.internet_message_id) skip.add(String(row.internet_message_id));
    }
  }
  let reconnect = false;
  for (const provider of mailboxes) {
    try {
      const accessToken = read ? 'test' : await mailboxAccessToken(admin, userId, provider);
      if (!accessToken) { reconnect = true; continue; }
      const listed = read ? await read.listed(provider) : provider === 'gmail' ? await gmailListed(accessToken) : await outlookListed(accessToken);
      // Left unopened: answers and forwards, mail to more than three people or to nobody, and what the app sent.
      const openable = listed.filter((message) => !message.reply && isOwnWritingSubject(message.subject) && message.recipients.length >= 1 && message.recipients.length <= 3
        && !skip.has(message.id) && !(message.internetMessageId && skip.has(message.internetMessageId))).slice(0, READ);
      const opened = await chunked(openable, 8, async (message): Promise<(SentEmail & { from: string }) | null> => {
        const body = read ? await read.body(provider, message.id) : provider === 'gmail' ? await gmailBody(accessToken, message.id) : await outlookBody(accessToken, message.id);
        return body ? { id: message.id, subject: message.subject, sentAt: message.sentAt, recipients: message.recipients, body, from: message.from } : null;
      });
      const ownEmail = opened.find((message) => message.from)?.from || listed.find((message) => message.from)?.from || '';
      const candidates = voiceCandidates(opened, { ownEmail });
      if (candidates.length) return { provider, candidates };
    } catch (error) {
      console.warn('[voice-own-samples] the sent folder could not be read:', error instanceof Error ? error.message : error);
      reconnect = true;
    }
  }
  return { provider: mailboxes[0], candidates: [], reason: reconnect ? 'reconnect' : 'nothing_found' };
}

const clean = (value: unknown, max: number) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‍﻿]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

export async function listOwnVoiceSamples(userId: string, client?: any): Promise<OwnVoiceSample[]> {
  const { data, error } = await (client || getSupabaseAdminClient()).from('user_voice_samples').select('id,source,provider,subject,body,sent_at,created_at')
    .eq('user_id', userId).order('created_at', { ascending: true }).limit(OWN_VOICE_SAMPLES_MAX);
  if (error) throw error;
  return ((data || []) as Array<Record<string, any>>).map((row) => ({ id: row.id, source: row.source, provider: row.provider ?? null, subject: row.subject ?? null,
    body: row.body, sentAt: row.sent_at ?? null, createdAt: row.created_at }));
}

export class OwnVoiceSampleError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Keeps what the person chose. The texts come from their own screen (they may have trimmed a candidate), so each is checked again. */
export async function saveOwnVoiceSamples(userId: string, items: Array<{ body?: unknown; subject?: unknown; sentAt?: unknown; source?: unknown; provider?: unknown }>): Promise<OwnVoiceSample[]> {
  if (!Array.isArray(items) || items.length === 0) throw new OwnVoiceSampleError('Elige al menos un correo.');
  const existing = await listOwnVoiceSamples(userId);
  if (existing.length + items.length > OWN_VOICE_SAMPLES_MAX) {
    throw new OwnVoiceSampleError(`Puedes guardar hasta ${OWN_VOICE_SAMPLES_MAX} ejemplos. Quita uno para agregar otro.`);
  }
  const known = new Set(existing.map((sample) => sample.body));
  const rows = items.map((item) => {
    const body = clean(item.body, 2400);
    const problem = ownVoiceSampleProblem(body);
    if (problem) throw new OwnVoiceSampleError(problem);
    const sentAt = typeof item.sentAt === 'string' && Number.isFinite(Date.parse(item.sentAt)) ? new Date(item.sentAt).toISOString() : null;
    const source = item.source === 'mailbox' ? 'mailbox' : 'manual';
    return { user_id: userId, source, provider: source === 'mailbox' && (item.provider === 'gmail' || item.provider === 'outlook') ? item.provider : null,
      subject: clean(item.subject, 200) || null, body, sent_at: sentAt };
  }).filter((row, index, all) => !known.has(row.body) && all.findIndex((other) => other.body === row.body) === index);
  if (rows.length) {
    const { error } = await getSupabaseAdminClient().from('user_voice_samples').insert(rows);
    if (error) throw error;
  }
  return listOwnVoiceSamples(userId);
}

export async function deleteOwnVoiceSample(userId: string, id: string): Promise<OwnVoiceSample[]> {
  const { error } = await getSupabaseAdminClient().from('user_voice_samples').delete().eq('user_id', userId).eq('id', id);
  if (error) throw error;
  return listOwnVoiceSamples(userId);
}

/**
 * The samples a person's emails are written from: their own when they chose some, else the ones their organization saved in Cowork's
 * writing context, else none (the built-in ones are used). Never blocks a draft.
 */
export async function voiceSamplesFor(input: { userId?: string | null; organizationId?: string | null; client?: any }): Promise<string[]> {
  if (input.userId) {
    try {
      const own = (await listOwnVoiceSamples(input.userId, input.client)).map((sample) => sample.body);
      if (own.length) return own;
    } catch (error) {
      console.warn('[voice-own-samples] could not read the person\'s samples:', error instanceof Error ? error.message : error);
    }
  }
  return input.organizationId ? organizationVoiceSamples(input.organizationId, input.client) : [];
}

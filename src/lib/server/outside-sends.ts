import { extractEmailAddress, mailboxAccessToken, normalizeEmail } from './reply-sync';

/**
 * Emails a person sends from their own mailbox to a lead their organization keeps in ANTON.IA, without going through the app
 * (audit T1, 1 Nov 2026): on 1 Nov one company had 38 drafts ready and no send from the app, and leads taken from ANTON.IA
 * were written to straight from Gmail or Outlook, so nothing measured them. With the read permission the person already
 * granted (gmail.readonly / Mail.Read), the Sent folder is listed and only a message addressed to one of those leads, who has
 * no contact recorded yet, becomes a «contacted» row: recipient, subject, date and the message ids. The body is never read.
 * From then on the reply sync follows that thread like any other.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** How far back a run looks: the first one for a mailbox reaches a month, later ones three days. */
export const OUTSIDE_SENDS_LOOKBACK_DAYS = 3;
export const OUTSIDE_SENDS_FIRST_LOOKBACK_DAYS = 30;
const PAGE_SIZE = 50;
const PAGE_BUDGET = 4;

export type SentMessage = {
  id: string;
  threadId: string | null;
  internetMessageId: string | null;
  subject: string;
  sentAt: string;
  recipients: string[];
};
export type KnownLead = { id: string; email: string; name: string | null; company: string | null; title: string | null };
export type OutsideSendMatch = { message: SentMessage; lead: KnownLead };

/**
 * Pure: which sent messages are a first contact with a known lead. A lead already contacted (by the app or by an earlier match)
 * is skipped, a message already recorded is skipped, and each lead is matched once, by its earliest message.
 */
export function matchOutsideSends(messages: SentMessage[], leads: Map<string, KnownLead>, contacted: Set<string>, recordedMessageIds: Set<string>) {
  const taken = new Set(contacted);
  const matches: OutsideSendMatch[] = [];
  const ordered = [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  for (const message of ordered) {
    if (recordedMessageIds.has(message.id) || (message.internetMessageId && recordedMessageIds.has(message.internetMessageId))) continue;
    for (const raw of message.recipients) {
      const email = extractEmailAddress(raw);
      const lead = email ? leads.get(email) : undefined;
      if (!lead || taken.has(email)) continue;
      taken.add(email);
      matches.push({ message, lead });
    }
  }
  return matches;
}

const header = (headers: Array<{ name?: string; value?: string }> | undefined, name: string) =>
  (headers || []).find(item => String(item?.name || '').toLowerCase() === name)?.value || '';
const addresses = (value: string) => value.split(',').map(part => extractEmailAddress(part)).filter(Boolean);

async function gmailSent(accessToken: string, days: number): Promise<SentMessage[]> {
  const out: SentMessage[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < PAGE_BUDGET; page++) {
    const params = new URLSearchParams({ q: `in:sent newer_than:${days}d`, maxResults: String(PAGE_SIZE), fields: 'messages(id,threadId),nextPageToken' });
    if (pageToken) params.set('pageToken', pageToken);
    const listed = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    if (!listed.ok) throw new Error(`Gmail sent list failed (${listed.status})`);
    const body = await listed.json() as { messages?: Array<{ id: string; threadId?: string }>; nextPageToken?: string };
    for (let index = 0; index < (body.messages || []).length; index += 10) {
      const chunk = await Promise.all((body.messages || []).slice(index, index + 10).map(async item => {
        const fields = 'id,threadId,internalDate,payload/headers';
        const meta = ['To', 'Cc', 'Subject', 'Message-ID'].map(name => `metadataHeaders=${name}`).join('&');
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&${meta}&fields=${fields}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        const headers = data?.payload?.headers;
        return {
          id: String(data?.id || item.id), threadId: data?.threadId || item.threadId || null,
          internetMessageId: header(headers, 'message-id') || null, subject: header(headers, 'subject').slice(0, 500),
          sentAt: new Date(Number(data?.internalDate || 0)).toISOString(),
          recipients: [...addresses(header(headers, 'to')), ...addresses(header(headers, 'cc'))],
        } satisfies SentMessage;
      }));
      for (const message of chunk) if (message && Date.parse(message.sentAt) > 0) out.push(message);
    }
    pageToken = body.nextPageToken || null;
    if (!pageToken) break;
  }
  return out;
}

async function outlookSent(accessToken: string, days: number): Promise<SentMessage[]> {
  const out: SentMessage[] = [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  let path: string | null = `/me/mailFolders/sentitems/messages?${new URLSearchParams({
    '$filter': `sentDateTime ge ${since}`, '$orderby': 'sentDateTime asc', '$top': String(PAGE_SIZE),
    '$select': 'id,conversationId,internetMessageId,subject,sentDateTime,toRecipients,ccRecipients',
  })}`;
  for (let page = 0; page < PAGE_BUDGET && path; page++) {
    const res: Response = await fetch(`${GRAPH_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`Outlook sent list failed (${res.status})`);
    const data: { value?: unknown[]; '@odata.nextLink'?: string } = await res.json();
    for (const item of (data.value || []) as Array<Record<string, any>>) {
      const people = [...(item.toRecipients || []), ...(item.ccRecipients || [])].map((person: any) => String(person?.emailAddress?.address || ''));
      out.push({ id: String(item.id), threadId: item.conversationId || null, internetMessageId: item.internetMessageId || null,
        subject: String(item.subject || '').slice(0, 500), sentAt: String(item.sentDateTime || ''), recipients: people });
    }
    const next: string | null = data['@odata.nextLink'] ? String(data['@odata.nextLink']) : null;
    if (next && !next.startsWith(GRAPH_BASE)) throw new Error('Invalid Graph pagination URL');
    path = next ? next.slice(GRAPH_BASE.length) : null;
  }
  return out;
}

export type OutsideSendsResult = { provider: 'gmail' | 'outlook'; listed: number; recorded: number; reason?: string };

/** One mailbox: list what it sent, match it against the organization's leads and record the first contacts. Never throws. */
export async function detectOutsideSends(supabase: any, input: { organizationId: string; userId: string; provider: 'gmail' | 'outlook'; firstRun?: boolean }): Promise<OutsideSendsResult> {
  const { organizationId, userId, provider } = input;
  try {
    const accessToken = await mailboxAccessToken(supabase, userId, provider);
    if (!accessToken) return { provider, listed: 0, recorded: 0, reason: 'connection_required' };
    const days = input.firstRun ? OUTSIDE_SENDS_FIRST_LOOKBACK_DAYS : OUTSIDE_SENDS_LOOKBACK_DAYS;
    const messages = provider === 'gmail' ? await gmailSent(accessToken, days) : await outlookSent(accessToken, days);
    if (!messages.length) return { provider, listed: 0, recorded: 0 };
    const wanted = [...new Set(messages.flatMap(message => message.recipients.map(email => extractEmailAddress(email)).filter(Boolean)))];
    if (!wanted.length) return { provider, listed: messages.length, recorded: 0 };
    const leadsByEmail = new Map<string, KnownLead>();
    const contacted = new Set<string>();
    const recorded = new Set<string>();
    for (let index = 0; index < wanted.length; index += 100) {
      const slice = wanted.slice(index, index + 100);
      const leads = await supabase.from('enriched_leads').select('id,email,full_name,company_name,organization_name,title')
        .eq('organization_id', organizationId).in('email', slice);
      if (leads.error) throw leads.error;
      for (const row of leads.data || []) {
        const email = normalizeEmail(row.email);
        if (email && !leadsByEmail.has(email)) leadsByEmail.set(email, { id: row.id, email, name: row.full_name || null, company: row.company_name || row.organization_name || null, title: row.title || null });
      }
      const already = await supabase.from('contacted_leads').select('email,message_id,internet_message_id').eq('organization_id', organizationId).in('email', slice);
      if (already.error) throw already.error;
      for (const row of already.data || []) {
        const email = normalizeEmail(row.email); if (email) contacted.add(email);
        if (row.message_id) recorded.add(String(row.message_id));
        if (row.internet_message_id) recorded.add(String(row.internet_message_id));
      }
    }
    const matches = matchOutsideSends(messages, leadsByEmail, contacted, recorded);
    let saved = 0;
    for (const { message, lead } of matches) {
      const row = {
        user_id: userId, organization_id: organizationId, lead_id: lead.id, name: lead.name, email: lead.email, company: lead.company, role: lead.title,
        status: 'sent', provider, sent_at: message.sentAt, subject: message.subject || null, message_id: message.id,
        thread_id: provider === 'gmail' ? message.threadId : null, conversation_id: provider === 'outlook' ? message.threadId : null,
        internet_message_id: message.internetMessageId, follow_up_count: 0, last_step_idx: -1, evaluation_status: 'pending',
        data: { source: 'mailbox_detected', detectedAt: new Date().toISOString() },
      };
      const inserted = await supabase.from('contacted_leads').insert(row);
      if (!inserted.error) saved += 1;
    }
    return { provider, listed: messages.length, recorded: saved };
  } catch (error) {
    return { provider, listed: 0, recorded: 0, reason: String((error as Error)?.message || 'failed').slice(0, 120) };
  }
}

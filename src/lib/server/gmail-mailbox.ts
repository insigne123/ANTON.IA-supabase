import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { refreshGoogleToken } from '@/lib/server-auth-helpers';
import { tokenService } from '@/lib/services/token-service';
import {
  buildGmailMailboxQuery,
  extractGmailMailboxTopic,
  extractGmailMailboxParticipants,
  extractMailboxAddressEntries,
  parseGmailMailboxMessage,
  truncateMailboxText,
  type GmailMailboxMessage,
  type GmailMailboxQueryInput,
} from '@/lib/gmail-mailbox-helpers';

export type GmailMailboxRuntime = {
  reportProgress?: (progress: { current: number; total?: number; label?: string | null; metadata?: Record<string, unknown> }) => Promise<void>;
  assertRunnable?: () => Promise<void>;
  heartbeat?: () => Promise<void>;
};

export type GmailMailboxContact = {
  email: string;
  name?: string | null;
  company?: string | null;
  lastSubject?: string | null;
  lastContactedAt?: string | null;
  messageIds: string[];
  threadIds: string[];
  evidenceSnippets: string[];
  matchedLeadId?: string | null;
  matchedContactedId?: string | null;
  crmStatus?: string | null;
  source: 'gmail';
};

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_METADATA_HEADERS = ['Subject', 'From', 'To', 'Cc', 'Bcc', 'Date', 'Message-ID'];

function asText(value: unknown) {
  return String(value || '').trim();
}

function asLimit(value: unknown, fallback = 25, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function domainCompanyGuess(email: string) {
  const domain = email.split('@')[1] || '';
  const root = domain.split('.')[0] || '';
  if (!root || /^(gmail|googlemail|outlook|hotmail|live|icloud|yahoo|proton|me)$/i.test(root)) return null;
  return root.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function gmailQueryParams(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

function gmailMessageGetQuery(includeBody?: boolean) {
  const params = new URLSearchParams();
  params.set('format', includeBody ? 'full' : 'metadata');
  if (!includeBody) {
    for (const header of GMAIL_METADATA_HEADERS) params.append('metadataHeaders', header);
  }
  return params.toString();
}

async function gmailFetchJson(accessToken: string, path: string) {
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error('Gmail no autorizo la lectura. Reconecta Gmail y confirma el permiso gmail.readonly.');
    }
    if (res.status === 429) {
      throw new Error('Gmail limito temporalmente la lectura. Reintenta en unos minutos.');
    }
    throw new Error(`Gmail respondio ${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }

  return res.json();
}

export async function getGmailMailboxAccessToken(auth: AuthContext) {
  const token = await tokenService.getToken(auth.supabase, auth.user.id, 'google');
  if (!token?.refresh_token) {
    throw new Error('Gmail no esta conectado. Conecta Gmail antes de buscar en tu mailbox.');
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan credenciales OAuth de Google en el servidor.');
  }

  const refreshed = await refreshGoogleToken(token.refresh_token, clientId, clientSecret);
  if (!refreshed?.access_token) throw new Error('No se pudo obtener access token de Gmail. Reconecta Gmail.');
  return String(refreshed.access_token);
}

export async function getGmailMailboxProfile(accessToken: string) {
  const profile = await gmailFetchJson(accessToken, '/profile');
  return {
    connected: true,
    emailAddress: profile?.emailAddress || null,
    hasReadonlyScope: true,
    provider: 'gmail' as const,
    messagesTotal: profile?.messagesTotal,
    threadsTotal: profile?.threadsTotal,
  };
}

export async function fetchGmailMailboxMessage(accessToken: string, messageId: string, options: { includeBody?: boolean } = {}) {
  const id = asText(messageId);
  if (!id) throw new Error('Falta messageId para leer Gmail.');
  const data = await gmailFetchJson(accessToken, `/messages/${encodeURIComponent(id)}?${gmailMessageGetQuery(options.includeBody)}`);
  return parseGmailMailboxMessage(data, { includeBody: options.includeBody });
}

export async function searchGmailMailboxMessages(
  accessToken: string,
  input: GmailMailboxQueryInput & { maxResults?: number; includeBody?: boolean; pageToken?: string | null },
  runtime: GmailMailboxRuntime = {},
) {
  const query = buildGmailMailboxQuery(input);
  if (!query) throw new Error('Falta query o topic para buscar en Gmail.');
  const maxResults = asLimit(input.maxResults, 25, 100);
  const listQuery = gmailQueryParams({ q: query, maxResults, pageToken: asText(input.pageToken) || undefined });
  const list = await gmailFetchJson(accessToken, `/messages?${listQuery}`);
  const ids = (Array.isArray(list?.messages) ? list.messages : []).map((item: any) => asText(item?.id)).filter(Boolean).slice(0, maxResults);
  const messages: GmailMailboxMessage[] = [];

  for (let index = 0; index < ids.length; index += 1) {
    await runtime.assertRunnable?.();
    if (index % 5 === 0) await runtime.heartbeat?.();
    const message = await fetchGmailMailboxMessage(accessToken, ids[index], { includeBody: Boolean(input.includeBody) });
    messages.push(message);
    await runtime.reportProgress?.({ current: index + 1, total: ids.length, label: 'Leyendo Gmail', metadata: { query } });
  }

  return {
    query,
    messages,
    resultCount: messages.length,
    nextPageToken: list?.nextPageToken || null,
    privacyMode: input.includeBody ? 'body_truncated' : 'metadata_snippet',
  };
}

export async function fetchGmailMailboxThread(
  accessToken: string,
  threadId: string,
  options: { includeBodies?: boolean; maxMessages?: number } = {},
) {
  const id = asText(threadId);
  if (!id) throw new Error('Falta threadId para leer Gmail.');
  const data = await gmailFetchJson(accessToken, `/threads/${encodeURIComponent(id)}?${gmailMessageGetQuery(Boolean(options.includeBodies))}`);
  const maxMessages = asLimit(options.maxMessages, 25, 50);
  const messages: GmailMailboxMessage[] = (Array.isArray(data?.messages) ? data.messages : [])
    .slice(0, maxMessages)
    .map((message: any) => parseGmailMailboxMessage(message, { includeBody: Boolean(options.includeBodies) }));
  const participants = new Map<string, { email: string; name?: string | null }>();
  for (const message of messages) {
    const groups = extractGmailMailboxParticipants(message);
    for (const entry of [...groups.from, ...groups.to, ...groups.cc, ...groups.bcc]) {
      if (!participants.has(entry.email)) participants.set(entry.email, { email: entry.email, name: entry.name || null });
    }
  }

  const dates = messages
    .map((message: GmailMailboxMessage) => Date.parse(message.internalDate || message.date || ''))
    .filter((value: number) => Number.isFinite(value))
    .sort((a: number, b: number) => a - b);
  return {
    threadId: id,
    messages,
    participants: Array.from(participants.values()),
    firstDate: dates[0] ? new Date(dates[0]).toISOString() : null,
    lastDate: dates[dates.length - 1] ? new Date(dates[dates.length - 1]).toISOString() : null,
    subject: messages[0]?.subject || null,
    messageCount: messages.length,
  };
}

export async function searchGmailMailboxThreads(
  accessToken: string,
  input: GmailMailboxQueryInput & { maxResults?: number; includeBodies?: boolean },
  runtime: GmailMailboxRuntime = {},
) {
  const search = await searchGmailMailboxMessages(accessToken, { ...input, includeBody: false }, runtime);
  const threadIds = Array.from(new Set(search.messages.map((message) => asText(message.threadId)).filter(Boolean))).slice(0, asLimit(input.maxResults, 25, 50));
  const threads = [];
  for (let index = 0; index < threadIds.length; index += 1) {
    await runtime.assertRunnable?.();
    threads.push(await fetchGmailMailboxThread(accessToken, threadIds[index], { includeBodies: Boolean(input.includeBodies) }));
    await runtime.reportProgress?.({ current: index + 1, total: threadIds.length, label: 'Agrupando hilos Gmail', metadata: { query: search.query } });
  }
  return { query: search.query, threads, threadCount: threads.length, messageCount: search.messages.length };
}

export function extractGmailContactedContacts(messages: GmailMailboxMessage[], profileEmail?: string | null, sentOnly = true): GmailMailboxContact[] {
  const myEmail = normalizeEmail(profileEmail);
  const contacts = new Map<string, GmailMailboxContact>();

  for (const message of messages) {
    const participants = extractGmailMailboxParticipants(message);
    const candidates = sentOnly
      ? [...participants.to, ...participants.cc, ...participants.bcc]
      : [...participants.from, ...participants.to, ...participants.cc, ...participants.bcc];
    const when = message.internalDate || message.date || null;
    const whenMs = when ? Date.parse(when) : 0;

    for (const entry of candidates) {
      const email = normalizeEmail(entry.email);
      if (!email || email === myEmail) continue;
      if (/^(no-?reply|mailer-daemon|postmaster)@/i.test(email)) continue;

      const existing = contacts.get(email);
      const existingMs = existing?.lastContactedAt ? Date.parse(existing.lastContactedAt) : 0;
      const evidence = truncateMailboxText(message.snippet || message.subject || '', 300);
      const next: GmailMailboxContact = existing || {
        email,
        name: entry.name || null,
        company: domainCompanyGuess(email),
        lastSubject: message.subject || null,
        lastContactedAt: when,
        messageIds: [],
        threadIds: [],
        evidenceSnippets: [],
        source: 'gmail',
      };

      if (message.id && !next.messageIds.includes(message.id)) next.messageIds.push(message.id);
      if (message.threadId && !next.threadIds.includes(message.threadId)) next.threadIds.push(message.threadId);
      if (evidence && !next.evidenceSnippets.includes(evidence) && next.evidenceSnippets.length < 3) next.evidenceSnippets.push(evidence);
      if (!next.name && entry.name) next.name = entry.name;
      if (!next.company) next.company = domainCompanyGuess(email);
      if (!existing || (whenMs && whenMs >= existingMs)) {
        next.lastSubject = message.subject || next.lastSubject || null;
        next.lastContactedAt = when || next.lastContactedAt || null;
      }
      contacts.set(email, next);
    }
  }

  return Array.from(contacts.values()).sort((a, b) => Date.parse(b.lastContactedAt || '') - Date.parse(a.lastContactedAt || ''));
}

export async function matchGmailContactsToCrm(auth: AuthContext, contacts: GmailMailboxContact[]) {
  const admin = getSupabaseAdminClient();
  const emails = Array.from(new Set(contacts.map((contact) => normalizeEmail(contact.email)).filter(Boolean))).slice(0, 100);
  if (emails.length === 0) return { matchedContacts: [], unmatchedContacts: contacts, summary: { total: contacts.length, crmMatches: 0, contactedMatches: 0 } };

  const [leadsRes, contactedRes] = await Promise.all([
    admin.from('leads').select('id, name, email, company, status').eq('organization_id', auth.organizationId).in('email', emails),
    admin.from('contacted_leads').select('id, lead_id, name, email, company, status, sent_at, subject').eq('organization_id', auth.organizationId).in('email', emails),
  ]);
  if (leadsRes.error) throw leadsRes.error;
  if (contactedRes.error) throw contactedRes.error;

  const leadByEmail = new Map((leadsRes.data || []).map((lead: any) => [normalizeEmail(lead.email), lead]));
  const contactedByEmail = new Map((contactedRes.data || []).map((row: any) => [normalizeEmail(row.email), row]));
  const crmIds = Array.from(new Set((leadsRes.data || []).flatMap((lead: any) => [`lead_saved|${lead.id}`, `lead_enriched|${lead.id}`])));
  const crmRes = crmIds.length
    ? await admin.from('unified_crm_data').select('id, stage, owner, next_action, autopilot_status, updated_at').eq('organization_id', auth.organizationId).in('id', crmIds)
    : { data: [], error: null } as any;
  if (crmRes.error) throw crmRes.error;
  const crmById = new Map((crmRes.data || []).map((row: any) => [String(row.id), row]));

  const matchedContacts = contacts.map((contact) => {
    const email = normalizeEmail(contact.email);
    const lead = leadByEmail.get(email) as any;
    const contacted = contactedByEmail.get(email) as any;
    const crm = lead ? (crmById.get(`lead_saved|${lead.id}`) || crmById.get(`lead_enriched|${lead.id}`)) as any : null;
    return {
      ...contact,
      name: contact.name || lead?.name || contacted?.name || null,
      company: contact.company || lead?.company || contacted?.company || null,
      matchedLeadId: lead?.id || contacted?.lead_id || null,
      matchedContactedId: contacted?.id || null,
      crmStatus: crm?.stage || lead?.status || contacted?.status || null,
      crmOwner: crm?.owner || null,
      crmNextAction: crm?.next_action || null,
    };
  });

  const crmMatches = matchedContacts.filter((contact) => contact.matchedLeadId).length;
  const contactedMatches = matchedContacts.filter((contact) => contact.matchedContactedId).length;
  return {
    matchedContacts,
    unmatchedContacts: matchedContacts.filter((contact) => !contact.matchedLeadId && !contact.matchedContactedId),
    summary: {
      total: contacts.length,
      crmMatches,
      contactedMatches,
      unmatched: matchedContacts.length - Math.max(crmMatches, contactedMatches),
    },
  };
}

export function summarizeGmailContactResults(input: { topic?: string | null; query?: string | null; contacts: GmailMailboxContact[]; messagesScanned?: number; threadsScanned?: number; crmMatches?: number }) {
  const contacts = input.contacts || [];
  const count = contacts.length;
  const crmMatches = Number(input.crmMatches || contacts.filter((contact) => contact.matchedLeadId || contact.matchedContactedId).length);
  const topic = asText(input.topic) || 'la busqueda indicada';
  const summaryText = count === 0
    ? `No encontre contactos en Gmail relacionados con ${topic}. No se envio nada ni se modifico CRM.`
    : `Encontre ${count} contacto${count === 1 ? '' : 's'} en Gmail relacionados con ${topic}. ${crmMatches} tienen match interno. No se envio nada ni se modifico CRM.`;

  return {
    summaryText,
    topContacts: contacts.slice(0, 10),
    recommendedNextActions: count === 0
      ? ['Ampliar el rango temporal o cambiar keywords.']
      : ['Revisar los contactos sin match en CRM.', 'Crear tareas o campana solo si lo apruebas por separado.'],
    artifactData: {
      topic: input.topic || null,
      query: input.query || null,
      contacts,
      messagesScanned: input.messagesScanned || 0,
      threadsScanned: input.threadsScanned || 0,
      crmMatches,
    },
  };
}

export async function findGmailContactedLeads(
  auth: AuthContext,
  input: GmailMailboxQueryInput & { maxResults?: number; includeBody?: boolean },
  runtime: GmailMailboxRuntime = {},
) {
  const accessToken = await getGmailMailboxAccessToken(auth);
  const profile = await getGmailMailboxProfile(accessToken);
  const topic = asText(input.topic);
  const query = buildGmailMailboxQuery({
    ...input,
    topic,
    sentOnly: input.sentOnly !== false,
    newerThan: input.newerThan || '12m',
  });
  const search = await searchGmailMailboxMessages(accessToken, {
    ...input,
    query,
    maxResults: asLimit(input.maxResults, 50, 100),
    includeBody: Boolean(input.includeBody),
  }, runtime);
  const contacts = extractGmailContactedContacts(search.messages, profile.emailAddress, input.sentOnly !== false);
  const matched = await matchGmailContactsToCrm(auth, contacts);
  const matchedContacts = matched.matchedContacts as GmailMailboxContact[];
  const threadsScanned = new Set(search.messages.map((message) => message.threadId).filter(Boolean)).size;
  const summary = summarizeGmailContactResults({
    topic,
    query,
    contacts: matchedContacts,
    messagesScanned: search.messages.length,
    threadsScanned,
    crmMatches: matched.summary.crmMatches,
  });

  return {
    query,
    topic,
    contacts: matchedContacts,
    messagesScanned: search.messages.length,
    threadsScanned,
    duplicatesRemoved: Math.max(0, search.messages.length - contacts.length),
    crmMatches: matched.summary.crmMatches,
    contactedMatches: matched.summary.contactedMatches,
    summary: summary.summaryText,
    recommendedNextActions: summary.recommendedNextActions,
    profileEmail: profile.emailAddress,
    privacyMode: search.privacyMode,
  };
}

export async function matchGmailMailboxContactsInput(auth: AuthContext, input: Record<string, unknown>) {
  const contacts = Array.isArray(input.contacts) ? input.contacts as GmailMailboxContact[] : [];
  return matchGmailContactsToCrm(auth, contacts);
}

export function summarizeGmailMailboxResultsInput(input: Record<string, unknown>) {
  const contacts = Array.isArray(input.contacts) ? input.contacts as GmailMailboxContact[] : [];
  return summarizeGmailContactResults({
    contacts,
    topic: asText(input.topic),
    query: asText(input.query),
    messagesScanned: Number(input.messagesScanned || 0),
    threadsScanned: Number(input.threadsScanned || 0),
  });
}

export function buildGmailContactArtifactContent(contacts: GmailMailboxContact[]) {
  if (!contacts.length) return 'Sin contactos encontrados con ese criterio.';
  return contacts.slice(0, 20).map((contact, index) => {
    const company = contact.company ? ` - ${contact.company}` : '';
    const status = contact.crmStatus ? ` - CRM: ${contact.crmStatus}` : contact.matchedLeadId || contact.matchedContactedId ? ' - match interno' : ' - sin match CRM';
    const date = contact.lastContactedAt ? ` - ${contact.lastContactedAt}` : '';
    return `${index + 1}. ${contact.name || contact.email} <${contact.email}>${company}${status}${date}\n${contact.lastSubject || 'Sin asunto'}`;
  }).join('\n\n');
}

export { buildGmailMailboxQuery, extractGmailMailboxTopic, extractMailboxAddressEntries };

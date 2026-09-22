import { z } from 'zod';

type Fetcher = typeof fetch;
const ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const HEADERS = ['From', 'To', 'Date', 'Subject', 'Auto-Submitted', 'Precedence', 'Content-Type'];

/** Bounded direct provider observation. No body, links, tokens or arbitrary queries leave it. */
export async function readGmailContactMessages(accessToken: string, email: string, fetcher: Fetcher = fetch) {
  const contact = z.string().email().max(320).parse(email).toLowerCase();
  // Restrict Gmail query syntax even for syntactically valid unusual email addresses.
  if (!/^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(contact)) throw new Error('Dirección no compatible con esta consulta.');
  if (!accessToken) throw new Error('Gmail no está conectado.');
  const deadline = AbortSignal.timeout(25000);
  const get = async (path: string) => {
    const response = await fetcher(`${ROOT}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? 'Gmail necesita acceso de lectura. Reconecta la cuenta.' : 'No se pudo completar la consulta de Gmail.');
    return response.json();
  };
  const profile = z.object({ emailAddress: z.string().email() }).parse(await get('/profile'));
  const query = new URLSearchParams({ q: `{from:${contact} to:${contact}}`, maxResults: '20' });
  const page = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(200) })).max(20).optional(),
    nextPageToken: z.string().optional() }).parse(await get(`/messages?${query}`));
  const messages = [];
  for (const item of page.messages || []) {
    const params = new URLSearchParams({ format: 'metadata' });
    HEADERS.forEach(header => params.append('metadataHeaders', header));
    const raw = z.object({ id: z.string(), threadId: z.string(), internalDate: z.string(),
      labelIds: z.array(z.string()).optional(), payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).optional(),
    }).parse(await get(`/messages/${encodeURIComponent(item.id)}?${params}`));
    const headers = new Map((raw.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
    const addresses = (value: string): string[] => Array.from(value.toLowerCase().match(/[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,63}/g) || []);
    const from = addresses(headers.get('from') || '');
    const to = addresses(headers.get('to') || '');
    const labels = raw.labelIds || [];
    if (labels.includes('DRAFT') || labels.includes('TRASH') || labels.includes('SPAM')) continue;
    const outbound = labels.includes('SENT') && to.includes(contact);
    const inbound = from.includes(contact) && to.includes(profile.emailAddress.toLowerCase());
    if (outbound === inbound) continue; // Never guess direction from subject/snippet.
    const automated = /^(auto-generated|auto-replied)/i.test(headers.get('auto-submitted') || '')
      || /^(bulk|list|junk)$/i.test(headers.get('precedence') || '')
      || /multipart\/report/i.test(headers.get('content-type') || '');
    const time = Number(raw.internalDate);
    if (!Number.isFinite(time) || time <= 0 || time > Date.now()) throw new Error('Gmail devolvió una fecha no válida.');
    messages.push({ id: raw.id, threadId: raw.threadId, at: new Date(time).toISOString(),
      direction: outbound ? 'outbound' : 'inbound', responseKind: automated ? 'automated' : 'unclassified',
      subject: (headers.get('subject') || '').slice(0, 300),
      notice: 'La presencia en enviados no confirma entrega; ausencia de cabecera automática no confirma respuesta humana.' });
  }
  return { source: 'gmail_metadata', scope: 'own_mailbox_contact', mailbox: profile.emailAddress,
    contact, queriedAt: new Date().toISOString(), messages, returned: messages.length,
    fetched: page.messages?.length || 0, hasMore: Boolean(page.nextPageToken),
    coverage: 'Exact address, metadata only, at most 20 results; no aliases or complete account history.',
    currentTurn: 'needs_review',
  };
}

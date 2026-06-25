export type GmailMailboxQueryInput = {
  query?: string | null;
  topic?: string | null;
  sentOnly?: boolean;
  after?: string | null;
  before?: string | null;
  newerThan?: string | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  includeSpamTrash?: boolean;
};

export type GmailMailboxAddress = {
  email: string;
  name?: string | null;
  raw?: string | null;
};

export type GmailMailboxMessage = {
  id: string;
  threadId?: string | null;
  subject?: string | null;
  from?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  date?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
};

const DEFAULT_SNIPPET_LIMIT = 300;
const DEFAULT_BODY_LIMIT = 2000;

function compactWhitespace(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeDateToken(value: unknown) {
  const clean = compactWhitespace(value).replace(/[^0-9/-]/g, '');
  if (!clean) return '';
  const match = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return '';
  return `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
}

function sanitizeRelativeDateToken(value: unknown) {
  const clean = compactWhitespace(value).toLowerCase();
  return /^(\d{1,3})(d|m|y)$/.test(clean) ? clean : '';
}

function sanitizeMailboxTerm(value: unknown) {
  return compactWhitespace(value)
    .replace(/[\r\n<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteIfNeeded(value: string) {
  const clean = sanitizeMailboxTerm(value).replace(/"/g, '\\"');
  if (!clean) return '';
  return /\s/.test(clean) ? `"${clean}"` : clean;
}

function limitQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 400).trim();
}

export function buildGmailMailboxQuery(input: GmailMailboxQueryInput) {
  const rawQuery = sanitizeMailboxTerm(input.query);
  if (rawQuery) return limitQuery(input.includeSpamTrash ? rawQuery : rawQuery.replace(/\b(in:spam|in:trash)\b/gi, '').trim());

  const parts: string[] = [];
  if (input.sentOnly !== false) parts.push('in:sent');
  if (!input.includeSpamTrash) parts.push('-in:spam', '-in:trash');

  const newerThan = sanitizeRelativeDateToken(input.newerThan);
  const after = sanitizeDateToken(input.after);
  const before = sanitizeDateToken(input.before);
  const from = sanitizeMailboxTerm(input.from);
  const to = sanitizeMailboxTerm(input.to);
  const subject = quoteIfNeeded(sanitizeMailboxTerm(input.subject));
  const topic = quoteIfNeeded(sanitizeMailboxTerm(input.topic));

  if (newerThan) parts.push(`newer_than:${newerThan}`);
  if (after) parts.push(`after:${after}`);
  if (before) parts.push(`before:${before}`);
  if (from) parts.push(`from:${from}`);
  if (to) parts.push(`to:${to}`);
  if (subject) parts.push(`subject:${subject}`);
  if (topic) parts.push(topic);

  return limitQuery(parts.join(' '));
}

export function extractGmailMailboxTopic(message: string) {
  const text = compactWhitespace(message);
  const patterns = [
    /(?:tema|asunto)\s+(?:de\s+)?([\p{L}0-9 ._-]{2,80})/iu,
    /(?:sobre|relacionad[oa]s? con|acerca de)\s+([\p{L}0-9 ._-]{2,80})/iu,
    /(?:por|para)\s+([\p{L}0-9._-]{2,80})/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const topic = compactWhitespace(match?.[1]).replace(/[?.!,;:]+$/g, '').trim();
    if (topic) return topic;
  }
  return '';
}

export function truncateMailboxText(value: unknown, limit = DEFAULT_SNIPPET_LIMIT) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trim()}...` : text;
}

export function decodeGmailBase64Url(data?: string | null) {
  if (!data) return '';
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

export function getGmailHeader(headers: any[] | undefined, name: string) {
  return (headers || []).find((header) => String(header?.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

export function extractMailboxAddressEntries(value?: string | null): GmailMailboxAddress[] {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const entries: GmailMailboxAddress[] = [];
  const regex = /(?:(?:"([^"]+)"|([^<,]+?))\s*)?<\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*>|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw))) {
    const email = String(match[3] || match[4] || '').trim().toLowerCase();
    if (!email) continue;
    const name = compactWhitespace(match[1] || match[2] || '').replace(/^"|"$/g, '').trim();
    entries.push({ email, name: name || null, raw: match[0] || null });
  }

  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.email)) return false;
    seen.add(entry.email);
    return true;
  });
}

export function extractEmailAddresses(value?: string | null) {
  return extractMailboxAddressEntries(value).map((entry) => entry.email);
}

export function extractGmailBodies(payload: any): { html?: string; text?: string } {
  let html = '';
  let text = '';
  const visit = (node: any) => {
    if (!node) return;
    const mime = String(node.mimeType || '').toLowerCase();
    const bodyData = decodeGmailBase64Url(node?.body?.data);
    if (bodyData) {
      if (!html && mime === 'text/html') html = bodyData;
      if (!text && mime === 'text/plain') text = bodyData;
    }
    for (const part of Array.isArray(node.parts) ? node.parts : []) visit(part);
  };
  visit(payload);
  return { html: html || undefined, text: text || undefined };
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function internalDateToIso(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed).toISOString();
}

export function parseGmailMailboxMessage(message: any, options: { includeBody?: boolean; snippetLimit?: number; bodyLimit?: number } = {}): GmailMailboxMessage {
  const headers = message?.payload?.headers || [];
  const includeBody = Boolean(options.includeBody);
  const bodies = includeBody ? extractGmailBodies(message?.payload) : {};
  const text = bodies.text || (bodies.html ? stripHtml(bodies.html) : '');

  return {
    id: String(message?.id || ''),
    threadId: message?.threadId || null,
    subject: getGmailHeader(headers, 'Subject') || null,
    from: getGmailHeader(headers, 'From') || null,
    to: getGmailHeader(headers, 'To') || null,
    cc: getGmailHeader(headers, 'Cc') || null,
    bcc: getGmailHeader(headers, 'Bcc') || null,
    date: getGmailHeader(headers, 'Date') || internalDateToIso(message?.internalDate),
    internalDate: internalDateToIso(message?.internalDate),
    snippet: truncateMailboxText(message?.snippet, options.snippetLimit || DEFAULT_SNIPPET_LIMIT) || null,
    bodyText: includeBody && text ? truncateMailboxText(text, options.bodyLimit || DEFAULT_BODY_LIMIT) : undefined,
    bodyHtml: includeBody && bodies.html ? truncateMailboxText(bodies.html, options.bodyLimit || DEFAULT_BODY_LIMIT) : undefined,
  };
}

export function extractGmailMailboxParticipants(message: GmailMailboxMessage) {
  return {
    from: extractMailboxAddressEntries(message.from),
    to: extractMailboxAddressEntries(message.to),
    cc: extractMailboxAddressEntries(message.cc),
    bcc: extractMailboxAddressEntries(message.bcc),
  };
}

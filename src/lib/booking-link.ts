/**
 * «Tu agenda» (propuesta 3, 19 oct 2026): the link where people book a time with the seller (Calendly, Google Calendar,
 * Microsoft Bookings, HubSpot…) and when it goes in an email. Never in a first cold email: asking for a meeting before
 * they know you lowers the answers. Kept per person in profiles.signatures.booking, next to the signature.
 *  - «auto»: the AI adds it to the suggested reply when the person shows interest or asks for a meeting; the button
 *    «Insertar mi agenda» is there too.
 *  - «on_request»: only the button.
 *  - «never»: neither, whatever the workspace has.
 */

export const BOOKING_MODES = ['auto', 'on_request', 'never'] as const;
export type BookingMode = typeof BOOKING_MODES[number];
export type BookingPreference = { url: string; mode: BookingMode };

const KNOWN: Array<[RegExp, string]> = [
  [/(^|\.)calendly\.com$/, 'Calendly'],
  [/^calendar\.app\.google$|^calendar\.google\.com$/, 'Google Calendar'],
  [/^outlook\.office(365)?\.com$|(^|\.)bookings\.microsoft\.com$/, 'Microsoft Bookings'],
  [/(^|\.)hubspot\.com$|^meetings\.hubspot\.com$/, 'HubSpot'],
  [/(^|\.)cal\.com$/, 'Cal.com'],
  [/(^|\.)zcal\.co$/, 'zcal'],
  [/(^|\.)tidycal\.com$/, 'TidyCal'],
];

/** A public https address, without spaces or credentials; null for anything else. */
export function normalizeBookingUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 400 || /\s/.test(raw)) return null;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname)) return null;
  const text = url.toString();
  return url.pathname === '/' && !url.search && !url.hash ? text.replace(/\/$/, '') : text;
}

/** The service behind the address, to say «Calendly» instead of a long URL; null when it is another site. */
export function bookingProvider(url: string | null | undefined): string | null {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return KNOWN.find(([pattern]) => pattern.test(host))?.[1] ?? null;
  } catch { return null; }
}

/** What the person saved; null when they never set it (then the workspace's own link, if any, still applies). */
export function readBookingPreference(signatures: unknown): BookingPreference | null {
  const value = signatures && typeof signatures === 'object' ? (signatures as Record<string, any>).booking : null;
  if (!value || typeof value !== 'object') return null;
  const mode = (BOOKING_MODES as readonly string[]).includes(value.mode) ? value.mode as BookingMode : 'auto';
  const url = normalizeBookingUrl(value.url);
  if (mode === 'never') return { url: url || '', mode };
  return url ? { url, mode } : null;
}

const INTEREST = new Set(['meeting_request', 'positive']);

/**
 * The link the suggested reply may use. The person's own setting rules: «never» and «on_request» give none, «auto» gives
 * theirs only when the answer shows interest or asks for a meeting. Without a setting, the workspace link as before.
 */
export function bookingLinkForReply(preference: BookingPreference | null, workspaceLink: string | null | undefined, intent: string | null | undefined) {
  if (!preference) return String(workspaceLink || '').trim();
  if (preference.mode !== 'auto') return '';
  return INTEREST.has(String(intent || '')) ? preference.url : '';
}

/** The sentence «Insertar mi agenda» adds. */
export function bookingSentence(url: string) {
  return `Si te acomoda, puedes elegir un horario aquí: ${url}`;
}

/** Adds the sentence at the end of the text, once; the signature is added later, when sending. */
export function insertBookingLine(body: string, url: string) {
  const text = String(body || '').replace(/\s+$/, '');
  if (!url || text.includes(url)) return text;
  return text ? `${text}\n\n${bookingSentence(url)}` : bookingSentence(url);
}

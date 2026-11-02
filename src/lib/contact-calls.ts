/**
 * «Llamar» y «WhatsApp» (2 Nov 2026, plan de uso y créditos U1). Wherever a contact's mobile shows, the person can call
 * or write on WhatsApp from ANTON.IA; the tap records the attempt (contact_calls) and, when they come back to the app,
 * one question asks how it went. That result is what turns a paid mobile into something measurable: it counts toward the
 * week's goal, «Hoy» lists the calls still without a result, and «Agendó reunión» takes the contact to the pipeline.
 * Pure: the screens, the server and the tests share it.
 */

export const CALL_CHANNELS = ['call', 'whatsapp'] as const;
export type CallChannel = typeof CALL_CHANNELS[number];

/** The results, in the order the question offers them. */
export const CALL_OUTCOMES = [
  { key: 'answered', label: 'Contestó', whatsapp: 'Respondió' },
  { key: 'meeting', label: 'Agendó reunión', whatsapp: 'Agendó reunión' },
  { key: 'no_answer', label: 'No contestó', whatsapp: 'Sin respuesta aún' },
  { key: 'not_interested', label: 'No le interesa', whatsapp: 'No le interesa' },
  { key: 'wrong_number', label: 'Número equivocado', whatsapp: 'Número equivocado' },
] as const;
export type CallOutcome = typeof CALL_OUTCOMES[number]['key'];
export const CALL_OUTCOME_KEYS: CallOutcome[] = CALL_OUTCOMES.map(outcome => outcome.key);

export function isCallChannel(value: unknown): value is CallChannel {
  return typeof value === 'string' && (CALL_CHANNELS as readonly string[]).includes(value);
}

export function isCallOutcome(value: unknown): value is CallOutcome {
  return typeof value === 'string' && (CALL_OUTCOME_KEYS as string[]).includes(value);
}

/** «Contestó» on a call reads «Respondió» on WhatsApp, where nobody answers a ring. */
export function outcomeLabel(outcome: CallOutcome, channel: CallChannel = 'call') {
  const found = CALL_OUTCOMES.find(item => item.key === outcome);
  if (!found) return '';
  return channel === 'whatsapp' ? found.whatsapp : found.label;
}

/** The person was reached: they answered, booked a meeting or said no. */
export function reachedPerson(outcome: CallOutcome | null | undefined) {
  return outcome === 'answered' || outcome === 'meeting' || outcome === 'not_interested';
}

/** Counts toward «Personas contactadas»: every result but a wrong number, which reached nobody. */
export function countsAsContacted(outcome: CallOutcome | null | undefined) {
  return Boolean(outcome) && outcome !== 'wrong_number';
}

/**
 * A number ready to dial: «+» and 8 to 15 digits. A Chilean mobile written without its code (9 digits starting with 9)
 * gets +56, as the call bridge does (call-bridge.ts); anything else without a code is left to the phone, so a call still
 * works locally while WhatsApp, which needs the country, is not offered.
 */
export function dialable(phone: string | null | undefined): { tel: string; international: boolean } | null {
  const raw = String(phone || '').trim();
  if (!raw || /not\s*found/i.test(raw)) return null;
  const compact = raw.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(compact)) return { tel: compact, international: true };
  if (/^00\d{8,15}$/.test(compact)) return { tel: `+${compact.slice(2)}`, international: true };
  const digits = compact.replace(/\+/g, '');
  if (/^9\d{8}$/.test(digits)) return { tel: `+56${digits}`, international: true };
  if (/^\d{6,15}$/.test(digits)) return { tel: digits, international: false };
  return null;
}

export function telHref(phone: string | null | undefined) {
  const number = dialable(phone);
  return number ? `tel:${number.tel}` : null;
}

/** wa.me wants the international number without «+». Null when the number has no country code. */
export function whatsappHref(phone: string | null | undefined, text?: string | null) {
  const number = dialable(phone);
  if (!number || !number.international) return null;
  const message = String(text || '').trim();
  return `https://wa.me/${number.tel.slice(1)}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

const firstWord = (value: string | null | undefined) => String(value || '').trim().split(/\s+/)[0] || '';

/**
 * The first WhatsApp line, short and in the seller's voice; they finish it in WhatsApp. Without the seller's name it
 * only greets, so it never invents who writes.
 */
export function whatsappOpener(input: { contactName?: string | null; senderName?: string | null; senderCompany?: string | null }) {
  const contact = firstWord(input.contactName);
  const sender = firstWord(input.senderName);
  const company = String(input.senderCompany || '').trim();
  const greeting = contact ? `Hola ${contact}` : 'Hola';
  if (!sender) return `${greeting}, ¿cómo estás?`;
  return `${greeting}, soy ${sender}${company ? ` de ${company}` : ''}. ¿Tienes unos minutos esta semana para conversar?`;
}

/** The call that waits for its result in this browser, until the person tells it or it gets old. */
export const PENDING_CALL_KEY = 'anton.pending-call.v1';
export const PENDING_CALL_MAX_AGE_MS = 3 * 86_400_000;
/** Back after less than this, the tap was a slip or the call never started: the question waits for a real return. */
export const ASK_AFTER_MS = 4_000;

/** Who the call is about, as the screen knows them: kept with the pending call so its result can still be saved if the
 * first request never arrived. */
export type CallContact = {
  leadId?: string | null;
  providerPersonId?: string | null;
  name: string;
  company?: string | null;
  email?: string | null;
};

export type PendingCall = {
  id: string;
  name: string;
  company: string | null;
  channel: CallChannel;
  startedAt: string;
  contact?: { leadId: string | null; providerPersonId: string | null; email: string | null };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isCallId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const short = (value: unknown, max: number) => {
  const out = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return out || null;
};

/** The pending call as stored, or null when it is missing, malformed or too old to ask about. */
export function parsePendingCall(raw: string | null | undefined, now: Date = new Date()): PendingCall | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingCall>;
    const started = Date.parse(String(value.startedAt || ''));
    if (!isCallId(value.id) || !isCallChannel(value.channel) || !Number.isFinite(started)) return null;
    if (now.getTime() - started > PENDING_CALL_MAX_AGE_MS) return null;
    const contact = value.contact && typeof value.contact === 'object' ? value.contact : null;
    return {
      id: value.id,
      name: String(value.name || '').slice(0, 200),
      company: value.company ? String(value.company).slice(0, 200) : null,
      channel: value.channel,
      startedAt: new Date(started).toISOString(),
      ...(contact ? { contact: { leadId: short(contact.leadId, 120), providerPersonId: short(contact.providerPersonId, 120), email: short(contact.email, 320) } } : {}),
    };
  } catch {
    return null;
  }
}

/** Ask about the pending call once the person is back after being away long enough to have called. */
export function shouldAskOutcome(pending: PendingCall | null, now: Date, awaySince: number | null) {
  if (!pending) return false;
  if (awaySince !== null) return now.getTime() - awaySince >= ASK_AFTER_MS;
  // Opened again later (the page reloaded while they called): ask if the call is not brand new.
  return now.getTime() - Date.parse(pending.startedAt) >= ASK_AFTER_MS;
}

export type LastCall = { outcome: CallOutcome | null; channel: CallChannel; at: string };

/** «Por llamar»: a contact with a mobile nobody called yet, or who did not answer last time. */
export function needsCall(hasPhone: boolean, last: LastCall | null | undefined) {
  if (!hasPhone) return false;
  if (!last) return true;
  return last.outcome === null || last.outcome === 'no_answer';
}

const DAY_MS = 86_400_000;
const dayKey = (date: Date, timeZone: string) => date.toLocaleDateString('en-CA', { timeZone });

/** «Contestó · hoy», «No contestó · ayer», «WhatsApp sin resultado · 2 nov». */
export function lastCallLine(last: LastCall, now: Date = new Date(), timeZone = 'America/Santiago') {
  const at = new Date(last.at);
  const today = dayKey(now, timeZone);
  const when = dayKey(at, timeZone) === today ? 'hoy'
    : dayKey(at, timeZone) === dayKey(new Date(now.getTime() - DAY_MS), timeZone) ? 'ayer'
      : at.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', timeZone }).replace('.', '');
  const what = last.outcome ? outcomeLabel(last.outcome, last.channel) : last.channel === 'whatsapp' ? 'WhatsApp sin resultado' : 'Llamada sin resultado';
  return `${what} · ${when}`;
}

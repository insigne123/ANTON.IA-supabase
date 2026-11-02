import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { PENDING_CALL_KEY, parsePendingCall, type CallChannel, type CallContact, type CallOutcome, type PendingCall } from '@/lib/contact-calls';

/**
 * The browser side of «Llamar» y «WhatsApp» (src/lib/contact-calls.ts): the tap records the attempt and keeps it as the
 * pending call, and the result is saved when the person says how it went. Screens hear both through window events, so
 * a list can update its «Por llamar» without asking the server again.
 */
export const CALL_STARTED_EVENT = 'anton:call-started';
export const CALL_OUTCOME_EVENT = 'anton:call-outcome';

export type CallOutcomeDetail = { id: string; leadId: string | null; outcome: CallOutcome; channel: CallChannel; at: string };

function newCallId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers: a version-4 id from getRandomValues.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readPendingCall(now: Date = new Date()): PendingCall | null {
  try {
    return parsePendingCall(window.localStorage.getItem(PENDING_CALL_KEY), now);
  } catch {
    return null;
  }
}

export function clearPendingCall(id?: string) {
  try {
    const current = readPendingCall();
    if (!id || current?.id === id) window.localStorage.removeItem(PENDING_CALL_KEY);
  } catch { /* storage blocked: nothing kept */ }
}

const postStart = (id: string, channel: CallChannel, contact: CallContact, keepalive = false) => authenticatedApiFetch('/api/contact-calls', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  keepalive,
  body: JSON.stringify({
    id, channel,
    leadId: contact.leadId || null,
    providerPersonId: contact.providerPersonId || null,
    name: contact.name || null,
    company: contact.company || null,
    email: contact.email || null,
  }),
});

/**
 * The tap on «Llamar» or «WhatsApp»: keeps the pending call in this browser and tells the server, without waiting, so
 * the phone or WhatsApp opens at once.
 */
export function startCall(channel: CallChannel, contact: CallContact): PendingCall {
  const pending: PendingCall = {
    id: newCallId(),
    name: contact.name,
    company: contact.company || null,
    channel,
    startedAt: new Date().toISOString(),
    contact: { leadId: contact.leadId || null, providerPersonId: contact.providerPersonId || null, email: contact.email || null },
  };
  try { window.localStorage.setItem(PENDING_CALL_KEY, JSON.stringify(pending)); } catch { /* the question still comes from «Hoy» */ }
  window.dispatchEvent(new CustomEvent(CALL_STARTED_EVENT, { detail: pending }));
  void postStart(pending.id, channel, contact, true).catch(() => undefined);
  return pending;
}

export type SaveOutcomeResult = { ok: true; pipeline: boolean } | { ok: false; message: string };

/**
 * Saves how a call went. If the server never got the start (the request was lost), it records it now from what the
 * pending call kept, then saves the result.
 */
export async function saveCallOutcome(
  call: { id: string; channel: CallChannel; leadId?: string | null; contact?: CallContact | null },
  outcome: CallOutcome,
  note?: string | null,
): Promise<SaveOutcomeResult> {
  const patch = () => authenticatedApiFetch(`/api/contact-calls/${call.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome, note: note?.trim() || null }),
  });
  try {
    let response = await patch();
    if (response.status === 404 && call.contact) {
      const started = await postStart(call.id, call.channel, call.contact);
      if (started.ok) response = await patch();
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: String(body?.error || 'No pudimos guardar el resultado. Intenta de nuevo.') };
    clearPendingCall(call.id);
    const detail: CallOutcomeDetail = { id: call.id, leadId: call.leadId || call.contact?.leadId || null, outcome, channel: call.channel, at: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent(CALL_OUTCOME_EVENT, { detail }));
    return { ok: true, pipeline: Boolean(body?.pipeline) };
  } catch {
    return { ok: false, message: 'No pudimos guardar el resultado. Revisa tu conexión e intenta de nuevo.' };
  }
}

/** A call told after the fact (the script's «Registrar llamada»): records it and its result in one go. */
export async function recordFinishedCall(channel: CallChannel, contact: CallContact, outcome: CallOutcome, note?: string | null) {
  const id = newCallId();
  try {
    const started = await postStart(id, channel, contact);
    if (!started.ok) {
      const body = await started.json().catch(() => null);
      return { ok: false as const, message: String(body?.error || 'No pudimos registrar la llamada.') };
    }
  } catch {
    return { ok: false as const, message: 'No pudimos registrar la llamada. Revisa tu conexión e intenta de nuevo.' };
  }
  return saveCallOutcome({ id, channel, leadId: contact.leadId || null }, outcome, note);
}

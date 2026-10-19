import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Calling from ANTON.IA (propuesta 19, prepared and off): Twilio calls the seller's phone and, when they answer, the
 * contact, from the company's Twilio number; the call is recorded from the answer and the recording comes back to
 * /api/touches/twilio/recording, where it is summarized like an uploaded one and then deleted from Twilio. Nothing runs
 * until CALL_BRIDGE_ENABLED=true and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER exist.
 */
export type BridgeConfig = { sid: string; token: string; from: string };
type Fetch = typeof fetch;

export function bridgeConfig(env: Record<string, string | undefined> = process.env): BridgeConfig | null {
  const sid = String(env.TWILIO_ACCOUNT_SID || ''); const token = String(env.TWILIO_AUTH_TOKEN || ''); const from = String(env.TWILIO_FROM_NUMBER || '');
  if (env.CALL_BRIDGE_ENABLED !== 'true' || !/^AC[0-9a-f]{32}$/i.test(sid) || token.length < 16 || !/^\+\d{8,15}$/.test(from)) return null;
  return { sid, token, from };
}

/** A phone in the international format Twilio dials: «+56 9 1234 5678» → «+56912345678»; null otherwise. */
export function e164(phone: string | null | undefined, defaultCountry = '56') {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  // A Chilean mobile written without the country code: 9 digits starting with 9.
  if (/^9\d{8}$/.test(digits)) return `+${defaultCountry}${digits}`;
  return null;
}

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]!));

/**
 * What Twilio does when the seller answers: tell them who is next and to ask for consent to record, then dial the contact
 * recording both sides from the answer, and send the recording back when it is ready.
 */
export function bridgeTwiml(input: { contactPhone: string; contactName: string; from: string; recordingCallback: string }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?><Response>',
    `<Say language="es-MX">Conectando con ${escapeXml(input.contactName.slice(0, 80))}. Recuerda pedirle permiso para grabar la llamada.</Say>`,
    `<Dial callerId="${escapeXml(input.from)}" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(input.recordingCallback)}" recordingStatusCallbackEvent="completed">`,
    `<Number>${escapeXml(input.contactPhone)}</Number></Dial></Response>`,
  ].join('');
}

const basic = (config: BridgeConfig) => `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString('base64')}`;

/** Starts the call: Twilio rings the seller first. */
export async function startBridgeCall(config: BridgeConfig, input: { sellerPhone: string; contactPhone: string; contactName: string; recordingCallback: string }, fetcher: Fetch = fetch) {
  const body = new URLSearchParams({ To: input.sellerPhone, From: config.from,
    Twiml: bridgeTwiml({ contactPhone: input.contactPhone, contactName: input.contactName, from: config.from, recordingCallback: input.recordingCallback }) });
  const response = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Calls.json`, {
    method: 'POST', headers: { Authorization: basic(config), 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const call = await response.json().catch(() => null) as { sid?: string } | null;
  return call?.sid ?? null;
}

/**
 * Twilio's signature of a webhook: HMAC-SHA1 with the auth token of the full URL followed by each POST parameter's name
 * and value, sorted by name, in base64.
 */
export function twilioSignature(token: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map(key => key + params[key]).join('');
  return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function validTwilioSignature(token: string, url: string, params: Record<string, string>, header: string | null) {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(token, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The recording, as mp3, from Twilio's API; only from Twilio's own host. */
export async function fetchRecording(config: BridgeConfig, recordingUrl: string, fetcher: Fetch = fetch) {
  let url: URL;
  try { url = new URL(recordingUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' || !url.pathname.startsWith(`/2010-04-01/Accounts/${config.sid}/Recordings/`)) return null;
  const response = await fetcher(`${url.toString().replace(/\.(mp3|wav)$/i, '')}.mp3`, { headers: { Authorization: basic(config) }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!response?.ok) return null;
  return response.arrayBuffer();
}

/** The audio is never kept: once summarized, the recording leaves Twilio too. */
export async function deleteRecording(config: BridgeConfig, recordingSid: string, fetcher: Fetch = fetch) {
  if (!/^RE[0-9a-f]{32}$/i.test(recordingSid)) return false;
  const response = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${config.sid}/Recordings/${recordingSid}.json`, {
    method: 'DELETE', headers: { Authorization: basic(config) }, signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  return Boolean(response?.ok);
}

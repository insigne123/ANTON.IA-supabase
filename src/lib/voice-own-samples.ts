/**
 * A person's own emails as the samples of their voice. The voice pass (src/lib/server/outreach-voice-pass.ts) takes its shape from whole
 * emails; the built-in ones (src/lib/outreach-voice.ts) are a default voice, and nothing says how someone writes better than what they
 * sent themselves (docs/correos-voz-humana.md).
 *
 * Pure. Which of the emails a person sent can show how they write to someone outside their company, and what is kept of each: the text
 * they typed, without the thread it answered or the signature under it. The person asks for the search, sees the candidates and saves
 * the ones they choose («Tu voz» in «Firmas y estilo»): nothing is read or kept without that.
 */

export const OWN_VOICE_SAMPLES_MAX = 5;
/** What a sample needs to show a voice without being a report or a quote. */
export const OWN_VOICE_WORDS = { min: 25, max: 200 };
const CANDIDATES = 8;

export type SentEmail = {
  id: string;
  subject: string;
  sentAt: string;
  recipients: string[];
  body: string;
  /** The provider says it answers or forwards another message. */
  reply?: boolean;
};

export type VoiceCandidate = { id: string; subject: string; sentAt: string; body: string; words: number };

const wordsOf = (text: string) => text.match(/[\p{L}\p{N}]+/gu) || [];
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
const domainOf = (email: string) => plain(String(email || '')).split('@')[1]?.trim() || '';

const REPLY_SUBJECT = /^\s*(?:re|rv|fw|fwd|reenv|enc|res|tr)\s*:/i;
const AUTOMATIC_SUBJECT = /^\s*(?:aceptad[oa]|rechazad[oa]|invitaci[oó]n|accepted|declined|invitation|updated invitation|respuesta autom[aá]tica|out of office|fuera de (?:la )?oficina|le[ií]do|read)\b/i;
// Where the thread an email answers starts, in the ways Gmail and Outlook write it.
const QUOTED = /^(?:>|El .{4,120} escribi[oó]:|On .{4,120} wrote:|(?:De|From|Enviado el|Sent):\s|-{2,}\s*(?:Mensaje original|Original Message|Forwarded message|Mensaje reenviado)|_{6,})/i;
const SIGN_OFF = /^(?:saludos|un saludo|atentamente|atte\.?|cordialmente|un abrazo|abrazos?|gracias|muchas gracias|quedo atent[oa]|quedamos atentos|slds\.?)(?!\p{L})/iu;
const SIGNATURE_START = /^(?:--\s*$|enviado desde mi|sent from my|obtener outlook|get outlook)/i;
// What a sample must not carry: an email chosen by a rule is never one about money, credentials, health or a dispute.
const SENSITIVE = /\b\d{1,2}\.\d{3}\.\d{3}-[\dk]\b|\b\d{10,}\b|contrasen|password|\bclave\b|cuenta corriente|numero de cuenta|\btarjeta\b|transferencia|\bsueldo|remuneracion|licencia medica|diagnostico|despido|demanda|\bjuicio\b|confidencial|\bdeuda|cobranza|factura impaga/;
const SPANISH = ['que', 'de', 'la', 'el', 'en', 'para', 'con', 'los', 'las', 'una', 'por', 'tu', 'su', 'te', 'y'];
const OTHER_LANGUAGE = ['the', 'and', 'you', 'your', 'we', 'our', 'with', 'for', 'voce', 'nao', 'uma', 'com'];

/** The subject of a reply, a forward or a message a calendar or a mailbox writes on its own. */
export function isOwnWritingSubject(subject: string) {
  return !REPLY_SUBJECT.test(subject) && !AUTOMATIC_SUBJECT.test(subject);
}

/**
 * The text the person typed: from the greeting to the closing word, without the thread below it or the signature (name, title, phones,
 * legal notice). An email that closes with no word keeps its sentences and loses the short lines under them.
 */
export function sentBodyAsText(body: string): string {
  const lines = String(body || '').replace(/\r\n?/g, '\n').replace(/[​‌‍﻿]/g, '').split('\n').map((line) => line.replace(/\s+$/g, ''));
  let end = lines.findIndex((line) => QUOTED.test(line.trim()) || SIGNATURE_START.test(line.trim()));
  if (end < 0) end = lines.length;
  let kept = lines.slice(0, end);
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  // The closing word, looked for from the end and never in the first lines: everything under it is the signature.
  let closing = -1;
  for (let index = kept.length - 1; index >= Math.max(2, kept.length - 14); index -= 1) {
    if (SIGN_OFF.test(kept[index].trim()) && wordsOf(kept[index]).length <= 6) { closing = index; break; }
  }
  if (closing >= 0) kept = kept.slice(0, closing + 1);
  else {
    // No closing word: the signature is the short lines at the end that finish no sentence.
    let cut = kept.length;
    while (cut > 1 && kept.length - cut < 8) {
      const line = kept[cut - 1].trim();
      if (line && (/[.?!:…]$/.test(line) || wordsOf(line).length > 7)) break;
      cut -= 1;
    }
    kept = kept.slice(0, cut);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Why a text cannot be a sample of someone's voice, in words for the person, or null. */
export function ownVoiceSampleProblem(text: string): string | null {
  const count = wordsOf(text).length;
  if (count < OWN_VOICE_WORDS.min) return `Es muy corto para mostrar cómo escribes: necesita al menos ${OWN_VOICE_WORDS.min} palabras.`;
  if (count > OWN_VOICE_WORDS.max) return `Es muy largo: un ejemplo sirve mejor con hasta ${OWN_VOICE_WORDS.max} palabras. Deja solo el correo, sin el hilo ni la firma.`;
  return null;
}

function spanish(text: string) {
  const words = wordsOf(plain(text));
  const hits = (list: string[]) => words.filter((word) => list.includes(word)).length;
  return hits(SPANISH) >= 5 && hits(OTHER_LANGUAGE) < 3;
}

function score(text: string, recipients: number) {
  const value = plain(text);
  const count = wordsOf(text).length;
  return (/\b(?:te|tu|tus|ti|contigo|usted|le|les|ustedes)\b/.test(value) ? 2 : 0)
    + (/\?/.test(text) ? 2 : 0)
    + (/\b(?:te escribo|le escribo|queria|quiero|estamos|trabajamos|ayudamos|hacemos|podemos|me gustaria|conversemos|coordinemos|cuentame)\b/.test(value) ? 2 : 0)
    + (count >= 40 && count <= 130 ? 2 : 0)
    + (recipients === 1 ? 1 : 0);
}

/**
 * The emails that can show how the person writes, best first: written by them (no reply, no forward, no automatic message), to one to
 * three people with at least one outside their own company, in Spanish, of a length that shows a voice, without lists or links, and
 * with nothing that reads as money, credentials, health or a dispute. The same email sent to several people is offered once.
 * `skipIds`: messages the app sent for them, which the app's writer wrote.
 */
export function voiceCandidates(messages: SentEmail[], input: { ownEmail: string; skipIds?: Set<string>; limit?: number }): VoiceCandidate[] {
  const own = plain(String(input.ownEmail || '').trim());
  const ownDomain = domainOf(own);
  const seen = new Set<string>();
  const found: Array<VoiceCandidate & { rank: number }> = [];
  for (const message of [...messages].sort((left, right) => Date.parse(right.sentAt) - Date.parse(left.sentAt))) {
    if (message.reply || input.skipIds?.has(message.id) || !isOwnWritingSubject(message.subject)) continue;
    const recipients = [...new Set(message.recipients.map((email) => plain(String(email || '').trim())).filter((email) => email.includes('@') && email !== own))];
    if (recipients.length < 1 || recipients.length > 3) continue;
    if (ownDomain && recipients.every((email) => domainOf(email) === ownDomain)) continue;
    const body = sentBodyAsText(message.body);
    if (ownVoiceSampleProblem(body) || !spanish(body) || SENSITIVE.test(plain(body))) continue;
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.filter((line) => /^(?:[-*•·]|\d+[.)])\s/.test(line)).length >= 3) continue;
    if ((body.match(/https?:\/\//g) || []).length > 2) continue;
    const key = wordsOf(plain(body)).slice(3, 18).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ id: message.id, subject: message.subject.trim().slice(0, 200), sentAt: message.sentAt, body, words: wordsOf(body).length, rank: score(body, recipients.length) });
  }
  return found.sort((left, right) => right.rank - left.rank || Date.parse(right.sentAt) - Date.parse(left.sentAt))
    .slice(0, input.limit ?? CANDIDATES).map(({ rank: _rank, ...candidate }) => candidate);
}

/** The samples one email is written from: two of the person's, which two depending on who it is for, so a campaign does not read alike. */
export function pickOwnVoiceSamples(samples: string[], seed: string, count = 2): string[] {
  const usable = samples.map((sample) => sample.trim()).filter(Boolean);
  if (usable.length <= count) return usable;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, index) => usable[(hash + index) % usable.length]);
}

const PAST_CONTACT = /\b(?:gracias|conversamos|hablamos|recibirme|recibirnos|quede|quedamos|vimos|reunion|llamada|adjunto|envio|mando|confirmo|ayer|como te|segun|retomo|respondo)\b/;
const GREETING_LINE = /^(?:hola|estimad[oa]s?|buen[oa]s\s+(?:d[ií]as|tardes)|querid[oa]s?)(?!\p{L})/iu;

/**
 * How the person starts their sentences and how they ask, read from their samples: «Te cuento cortito», «La idea es simple», «¿Qué te
 * parece?». Shown whole emails and told they were theirs, the model kept its own neutral register (8 drafts and 6 follow-ups, 11 Nov
 * 2026); the first words of a sentence are where a voice shows and carry none of what the email was about. No name, no figure.
 */
export function ownVoiceTraits(samples: string[]): { openers: string[]; questions: string[] } {
  const openers: string[] = [];
  const questions: string[] = [];
  const seen = new Set<string>();
  for (const sample of samples) {
    const lines = sample.split('\n').map((line) => line.trim()).filter(Boolean);
    const body = lines.filter((line, index) => !(index === 0 && GREETING_LINE.test(line) && wordsOf(line).length <= 6) && !(SIGN_OFF.test(line) && wordsOf(line).length <= 6));
    // A greeting that shares its line with a sentence («Hola Marcela, ¿cómo estás?») keeps the sentence.
    const text = body.join(' ').replace(/^(?:hola|estimad[oa]s?)\s+[^,:]{1,40}[,:]\s*/iu, '');
    for (const sentence of text.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean)) {
      const words = sentence.replace(/^[¿¡]/, '').match(/[\p{L}\p{N}]+/gu) || [];
      if (/\?$/.test(sentence)) {
        if (words.length >= 2 && words.length <= 9 && !/\d/.test(sentence) && questions.length < 3) questions.push(sentence);
        continue;
      }
      if (words.length < 5) continue;
      const start = words.slice(0, 3);
      // A name or a figure is what that email was about, not how the person writes.
      if (start.some((word, index) => /\d/.test(word) || (index > 0 && /^\p{Lu}/u.test(word)))) continue;
      const opener = start.join(' ');
      // «Gracias por recibirme», «Me quedé pensando»: said to someone else, it claims a meeting that never happened (a draft opened
      // with «Me quedé pensando en lo que me contaste» to a person never spoken to, 11 Nov 2026).
      if (PAST_CONTACT.test(plain(opener))) continue;
      if (seen.has(plain(opener))) continue;
      seen.add(plain(opener));
      openers.push(opener);
    }
  }
  return { openers: openers.slice(0, 10), questions };
}

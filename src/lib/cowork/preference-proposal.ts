import { z } from 'zod';

/**
 * A preference the person asks Cowork to keep («recuerda que no le escribo a la competencia», «de ahora en adelante, tono
 * cercano»). preference.save proposes it with a card; approving it stores it in suplia_memories as «approved», and every turn
 * already reads the approved ones (server/cowork/user-context.ts). personal: only this person's turns; organization: the
 * whole team's (Plan 12, 5).
 */
export const COWORK_PREFERENCE_MAX = 240;

export const coworkPreferenceSchema = z.object({
  /** The preference in one sentence, as it will be remembered: «No le escribo a empresas de la competencia». */
  text: z.string().trim().min(3).max(COWORK_PREFERENCE_MAX),
  /** personal unless the person says it is for the team or the company. */
  scope: z.enum(['personal', 'organization']),
}).strict();
export type CoworkPreference = z.infer<typeof coworkPreferenceSchema>;

/** What the card says will be remembered, and for whom. */
export function coworkPreferenceLabel(preference: CoworkPreference) {
  const who = preference.scope === 'organization' ? 'para todo tu equipo' : 'solo para ti';
  return `Recordar ${who}: «${preference.text.trim()}»`.slice(0, 280);
}

/** The key of the stored memory: its first words, lower-cased, so the same preference is not stored twice. */
export function coworkPreferenceKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?¡¿]+$/u, '').slice(0, 80);
}

const NEGATIONS = new Set(['no', 'nunca', 'jamas', 'ni']);
const preferenceWords = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9ñ]+/g) || [];

/**
 * Whether a preference is already among what Cowork remembers (userContext.memories): most of its words are in one of them and
 * both say it the same way (a «no» in one and not in the other is a change, not a repeat). The loop sends a repeat back.
 */
export function coworkPreferenceAlreadyKept(text: string, memories: readonly string[]) {
  const asked = preferenceWords(text);
  const content = new Set(asked.filter(word => word.length >= 4));
  if (!content.size) return false;
  const negative = asked.some(word => NEGATIONS.has(word));
  return memories.some(memory => {
    const keptWords = preferenceWords(memory);
    const kept = new Set(keptWords.filter(word => word.length >= 4));
    if (!kept.size || keptWords.some(word => NEGATIONS.has(word)) !== negative) return false;
    const shared = [...content].filter(word => kept.has(word)).length;
    return shared / Math.min(content.size, kept.size) >= 0.75;
  });
}

// «…y recuerda que siempre firmo como Nico», «recuerda: no le escribo a…», «de ahora en adelante tuteamos a todos».
const REMEMBER_REQUEST = /(?:^|[\s,;.])(?:recu[eé]rda(?:lo)?(?:\s+que|:)|de ahora en adelante,?|a partir de ahora,?|desde ahora,?)\s+([^.?!\n]{3,200})/iu;

/**
 * The quick reply that keeps a preference asked for next to another task (Plan 12, 5): the turn did the task and applied the
 * preference, and touching this asks Cowork to remember it, which proposes the card. Null when the request asks nothing to keep.
 */
export function coworkRememberSuggestion(request: string): { label: string; message: string } | null {
  const match = REMEMBER_REQUEST.exec(request);
  const clause = match?.[1].trim().replace(/[,;:]+$/u, '');
  if (!clause) return null;
  return { label: 'Recordarlo para la próxima', message: `Recuerda que ${clause}`.slice(0, 240) };
}

// A standing instruction said in passing, without «recuerda» (Plan 14, 4): «siempre firma como Nico», «nunca uses emojis», «nunca le
// escribimos a la competencia», «no trabajamos con el sector público». Only «siempre», «nunca» or «jamás» before a verb of how to
// write or whom to reach, so a past («nunca tuvimos respuesta») or a question («¿siempre les escribo?») is not one.
const STANDING_VERBS = [
  'escrib(?:e|as|an|imos)', 'us(?:a|es|en|amos)', 'firm(?:a|es|en|amos|o)', 'inclu(?:ye|yas|yan|imos)', 'mencion(?:a|es|en|amos)',
  'pon(?:gas|gan|emos)?', 'agreg(?:a|ues|uen|amos)', 'trat(?:a|es|en|amos)', 'tute(?:a|es|en|amos)', 'contact(?:a|es|en|amos)',
  'ofrec(?:e|as|an|emos)', 'propon(?:e|gas|gan|emos)', 'envi(?:a|es|en|amos)', 'mand(?:a|es|en|amos)', 'pregunt(?:a|es|en|amos)',
  'habl(?:a|es|en|amos)', 'cit(?:a|es|en|amos)', 'adjunt(?:a|es|en|amos)', 'nombr(?:a|es|en|amos)', 'llam(?:a|es|en|amos)',
  'trabaj(?:a|es|en|amos)', 'vend(?:e|as|an|emos)', 'prospect(?:a|es|en|amos)', 'atend(?:emos)', 'firmo', 'escribo', 'uso',
];
const STANDING = new RegExp(`(?:^|[\\s,;:])((?:siempre|nunca|jam[aá]s)\\s+(?:(?:le|les|lo|la|los|las|me|nos|se)\\s+)?(?:${STANDING_VERBS.join('|')})(?!\\p{L})[^.?!¿\\n]{0,160})`, 'iu');
const BUSINESS_FACT = /(?:^|[\s,;:])(no\s+(?:trabajamos|vendemos|atendemos|prospectamos|le\s+vendemos)\s+(?:con|a|en)\s+[^.?!¿\n]{3,160})/iu;

/** The standing instruction a request states in passing, as said («siempre firma como Nico»), or null. Never inside a question. */
export function coworkStandingPreference(request: string): string | null {
  for (const pattern of [STANDING, BUSINESS_FACT]) {
    const match = pattern.exec(request);
    if (!match) continue;
    const clause = match[1].trim().replace(/[,;:]+$/u, '');
    const start = request.lastIndexOf(clause);
    const sentenceStart = Math.max(request.lastIndexOf('.', start), request.lastIndexOf('\n', start), request.lastIndexOf('!', start)) + 1;
    const end = start + clause.length;
    if (request.slice(sentenceStart, start).includes('¿') || request.slice(end, end + 2).includes('?')) continue;
    if (clause.split(/\s+/).length >= 3) return clause.slice(0, COWORK_PREFERENCE_MAX - 'Recuerda que '.length);
  }
  return null;
}

/**
 * The quick reply that keeps a preference (Plan 14, 4): one asked to remember next to another task (Plan 12, 5), or a standing
 * instruction said in passing. Null without one, or when Cowork already remembers it.
 */
export function coworkPreferenceSuggestion(request: string, memories: readonly string[] = []): { label: string; message: string } | null {
  const asked = coworkRememberSuggestion(request);
  const standing = asked ? null : coworkStandingPreference(request);
  const suggestion = asked ?? (standing ? { label: 'Recordarlo para la próxima', message: `Recuerda que ${standing}`.slice(0, 240) } : null);
  if (!suggestion || coworkPreferenceAlreadyKept(suggestion.message.replace(/^Recuerda que /, ''), memories)) return null;
  return suggestion;
}

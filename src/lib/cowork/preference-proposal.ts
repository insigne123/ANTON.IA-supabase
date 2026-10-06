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

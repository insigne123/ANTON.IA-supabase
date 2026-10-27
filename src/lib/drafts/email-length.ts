/**
 * How long the body of an email may be, in words. What the AI writes stays within EMAIL_BODY_WORDS (the draft contract,
 * draft-context-v2). A person who edits their own email decides its length: outside that range it is only a notice, and
 * only outside EDITED_EMAIL_BODY_WORDS, a length nobody means to send cold, does approval stop. On 23 Oct 2026 an email
 * edited to 221 words could not be approved, and the page never said why.
 */
export const EMAIL_BODY_WORDS = { min: 35, max: 180 } as const;
export const EDITED_EMAIL_BODY_WORDS = { min: 10, max: 400 } as const;

/** Words as the preflight counts them: runs of letters and digits. */
export function emailWordCount(value: string) {
  return value.match(/[\p{L}\p{N}]+/gu)?.length || 0;
}

/** What the editor says under the message: the count, and why a length matters when it is outside the usual range. */
export function emailLengthNote(words: number): { tone: 'quiet' | 'notice' | 'stop'; text: string } {
  const count = words === 1 ? '1 palabra' : `${words.toLocaleString('es-CL')} palabras`;
  if (words > EDITED_EMAIL_BODY_WORDS.max) return { tone: 'stop', text: `${count}. Para enviarlo, déjalo en ${EDITED_EMAIL_BODY_WORDS.max} o menos.` };
  if (words > 0 && words < EDITED_EMAIL_BODY_WORDS.min) return { tone: 'stop', text: `${count}. Para enviarlo, escribe al menos ${EDITED_EMAIL_BODY_WORDS.min}.` };
  if (words > EMAIL_BODY_WORDS.max) return { tone: 'notice', text: `${count}. Puedes enviarlo; los correos en frío de hasta ${EMAIL_BODY_WORDS.max} suelen responderse más.` };
  if (words > 0 && words < EMAIL_BODY_WORDS.min) return { tone: 'notice', text: `${count}. Puedes enviarlo; con al menos ${EMAIL_BODY_WORDS.min} se entiende mejor por qué escribes.` };
  return { tone: 'quiet', text: count };
}

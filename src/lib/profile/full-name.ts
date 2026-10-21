// The name each person gives the app. The team picks a colleague by name («Asignar equipo» in Oportunidades, the weekly report,
// the goals), so an account with no name reads as a stranger there. The app asks for it once, when it opens; this is what counts
// as «has a name» and what a valid one looks like. Pure: the prompt and its tests share it.

const MAX_LENGTH = 120;
/** A word of a name: letters (any alphabet), with the apostrophe, dot and hyphen names carry («D'Angelo», «J.», «Pérez-Cotapos»). */
const NAME_WORD = /^\p{L}[\p{L}'’.-]*$/u;

/** A name is there when it is not just blanks. */
export function hasFullName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Whether to ask: only a profile that exists and has no name (without a row there is nothing to save to). */
export function needsFullName(profile: { full_name?: string | null } | null | undefined): boolean {
  return profile ? !hasFullName(profile.full_name) : false;
}

export type FullNameCheck = { ok: true; name: string } | { ok: false; error: string };

/** What the person typed, as it is saved: one space between words, no blanks at the ends. */
export function normalizeFullName(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function checkFullName(input: string): FullNameCheck {
  const name = normalizeFullName(input);
  if (!name) return { ok: false, error: 'Escribe tu nombre y apellido.' };
  if (name.length > MAX_LENGTH) return { ok: false, error: `Usa menos de ${MAX_LENGTH} caracteres.` };
  const words = name.split(' ');
  if (!words.every(word => NAME_WORD.test(word))) return { ok: false, error: 'Usa solo letras: sin correos, números ni símbolos.' };
  if (words.length < 2) return { ok: false, error: 'Escribe tu nombre y apellido, por ejemplo «María González».' };
  return { ok: true, name };
}

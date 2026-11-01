/**
 * A stable pick per recipient. One by one the drafts read well, but whoever gets several notices the same skeleton (the same introduction,
 * the same ask, the same closing line; the owner's read of the v40 sample, 1 Nov 2026). Two recipients of a campaign get different forms,
 * and a retry or an approval of the same draft keeps its own.
 */
export function draftVarietyIndex(seed: string, size: number) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return size > 0 ? hash % size : 0;
}

export function draftVarietySeed(context: { company?: { name?: string | null }; recipient?: { email?: string | null; displayName?: string | null } }) {
  return [context.recipient?.email, context.recipient?.displayName, context.company?.name].map((part) => String(part || '').trim().toLowerCase()).join('|');
}

/** How the writer introduces itself in a first email, as it would in person. */
export const DRAFT_INTRODUCTION_FORMS = [
  '«Soy <nombre de pila>, de <tu empresa>; <qué hacen, en pocas palabras>.»',
  '«Soy <nombre de pila> y trabajo en <tu empresa>, donde <qué hacen, en pocas palabras>.»',
  '«Te escribo desde <tu empresa>: <qué hacen, en pocas palabras>.»',
] as const;

/**
 * The last email of a sequence: it says so, in a sentence of its own, and asks a yes or no question that is not a meeting ask («¿Te sirve
 * que…?» and «¿Te parece…?» read as one to the preflight, and a v41 sample turned back four closes for it).
 */
export const DRAFT_CLOSING_FORMS = [
  '«Esta es la última vez que te escribo sobre esto. ¿Lo dejamos hasta aquí?»',
  '«No te escribo más sobre este tema. ¿Prefieres que lo retome más adelante?»',
  '«Para no insistir, este es mi último correo sobre esto. ¿Lo dejo aquí por ahora?»',
  '«Con este correo cierro el tema por mi lado. ¿Lo dejamos para otro momento?»',
] as const;

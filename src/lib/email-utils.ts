// src/lib/email-utils.ts
export type EmailStatus = 'verified' | 'guessed' | 'locked' | 'unknown';

export function isValidEmail(v?: string | null): boolean {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/**
 * Busca el mejor email disponible en objetos con distintos shapes
 * (compatibilidad hacia atrás).
 */
export function extractPrimaryEmail(
  obj: any
): { email?: string; status?: EmailStatus } {
  if (!obj) return {};

  const cand: Array<{ v?: string; s?: EmailStatus }> = [
    { v: obj.email, s: obj.emailStatus },
    { v: obj.workEmail, s: obj.emailStatus },
    { v: obj.primaryEmail, s: obj.emailStatus },
    { v: obj.personal_email, s: obj.emailStatus },
    { v: obj.personalEmail, s: obj.emailStatus },
  ];

  if (Array.isArray(obj.emails)) {
    const first = obj.emails.find((e: string) => isValidEmail(e));
    cand.push({ v: first, s: obj.emailStatus });
  }

  if (obj.guessedEmail && (obj.guessedEmailVerified || obj.emailStatus === 'guessed')) {
    cand.push({ v: obj.guessedEmail, s: 'guessed' });
  }

  const hit = cand.find(c => isValidEmail(c.v));
  if (hit?.v) return { email: hit.v.trim(), status: hit.s || 'unknown' };
  return {};
}

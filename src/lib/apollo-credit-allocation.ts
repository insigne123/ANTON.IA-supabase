/**
 * Apollo credits shared out per organization for a window (28 Oct 2026: the cycle's 2,500 were spent and 1,000 more were
 * bought, 700 for one company and 300 for another). The database counts each organization's lookups in the window
 * (migration 20261028230000) with what Apollo charges the shared account: 1 credit for an email and 8 for a phone (its
 * direct-dial reading: 1,848 credits for 231 phones). While an organization has an open allocation, the email and phone
 * lookups that do not fit are refused before anything is claimed or asked; searches are never stopped by it. Pure: the
 * screens, the server and the tests share it.
 */
export const APOLLO_ALLOCATION_EMAIL_CREDITS = 1;
export const APOLLO_ALLOCATION_PHONE_CREDITS = 8;

/** The error code the enrichment route answers with, whose message the screens show as it is. */
export const APOLLO_ALLOCATION_ERROR = 'APOLLO_CREDITS_ALLOCATION_USED';

export type ApolloCreditAllocation = {
  credits: number;
  used: number;
  remaining: number;
  startsAt: string;
  endsAt: string;
  note: string | null;
};

export function apolloAllocationCost(fields: { revealEmail: boolean; revealPhone: boolean }) {
  return (fields.revealEmail ? APOLLO_ALLOCATION_EMAIL_CREDITS : 0) + (fields.revealPhone ? APOLLO_ALLOCATION_PHONE_CREDITS : 0);
}

const count = (value: number) => value.toLocaleString('es-CL');

/** «1 de noviembre», in Chile's time. */
export function apolloAllocationEndLabel(endsAt: string) {
  return new Date(endsAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' });
}

/** What the person reads when the lookups do not fit in the organization's share; null when they fit or there is no share. */
export function apolloAllocationRefusal(allocation: ApolloCreditAllocation | null, needed: number): string | null {
  if (!allocation || needed <= 0 || allocation.remaining >= needed) return null;
  const until = apolloAllocationEndLabel(allocation.endsAt);
  if (allocation.remaining <= 0) {
    return `Tu organización ya usó los ${count(allocation.credits)} créditos de Apollo que tiene hasta el ${until}. `
      + 'Los correos y teléfonos se pausan hasta entonces; las búsquedas siguen disponibles.';
  }
  return `A tu organización le quedan ${count(allocation.remaining)} créditos de Apollo hasta el ${until} y esto usa hasta `
    + `${count(needed)}. Pide menos contactos o solo correos (${APOLLO_ALLOCATION_EMAIL_CREDITS} crédito cada uno).`;
}

/** What the admin panel's card says, apart from the numbers. */
export function apolloAllocationCopy(allocation: ApolloCreditAllocation) {
  const until = apolloAllocationEndLabel(allocation.endsAt);
  const spent = allocation.remaining <= 0;
  return {
    until,
    spent,
    summary: spent
      ? `Tu organización usó sus ${count(allocation.credits)} créditos adicionales. Los correos y teléfonos están pausados hasta el ${until}; las búsquedas siguen disponibles.`
      : `Tu organización tiene ${count(allocation.credits)} créditos adicionales hasta el ${until}.`,
    footnote: `Cada correo usa ${APOLLO_ALLOCATION_EMAIL_CREDITS} crédito y cada teléfono, ${APOLLO_ALLOCATION_PHONE_CREDITS}. `
      + 'Lo que está en curso ya se descuenta. Las búsquedas no usan estos créditos.',
  };
}

/** The message of a refusal the screens show as it is (a person someone else holds, or the organization's share used). */
export function enrichmentRefusalMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (error !== 'LEAD_CLAIMED' && error !== APOLLO_ALLOCATION_ERROR) return null;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : null;
}

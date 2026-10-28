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
  /** The share for the window: what limits the lookups. */
  credits: number;
  /** Used in the window (what is under way included). */
  used: number;
  remaining: number;
  startsAt: string;
  endsAt: string;
  note: string | null;
  /** Used earlier in the cycle, shown with the window's use; it limits nothing. */
  usedBefore: number;
  /** False: the organization sees only what it used, not its share nor what is left. */
  showLimit: boolean;
};

export function apolloAllocationCost(fields: { revealEmail: boolean; revealPhone: boolean }) {
  return (fields.revealEmail ? APOLLO_ALLOCATION_EMAIL_CREDITS : 0) + (fields.revealPhone ? APOLLO_ALLOCATION_PHONE_CREDITS : 0);
}

const count = (value: number) => value.toLocaleString('es-CL');

/** «1 de noviembre», in Chile's time. */
export function apolloAllocationEndLabel(endsAt: string) {
  return new Date(endsAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', timeZone: 'America/Santiago' });
}

/**
 * What the person reads when the lookups do not fit in the organization's share; null when they fit or there is no share.
 * It names how many are left only to an organization that sees its share.
 */
export function apolloAllocationRefusal(allocation: ApolloCreditAllocation | null, needed: number): string | null {
  if (!allocation || needed <= 0 || allocation.remaining >= needed) return null;
  const until = apolloAllocationEndLabel(allocation.endsAt);
  if (allocation.remaining <= 0) {
    return `Tu organización usó los créditos de Apollo disponibles hasta el ${until}. `
      + 'Los correos y teléfonos se pausan hasta entonces; las búsquedas siguen disponibles.';
  }
  const left = allocation.showLimit
    ? `A tu organización le quedan ${count(allocation.remaining)} créditos de Apollo hasta el ${until} y esto usa hasta ${count(needed)}.`
    : `Esto usa hasta ${count(needed)} créditos de Apollo y a tu organización no le alcanzan hasta el ${until}.`;
  return `${left} Pide menos contactos o solo correos (${APOLLO_ALLOCATION_EMAIL_CREDITS} crédito cada uno).`;
}

/** What the admin panel's card says and shows: the cycle's use, and what is left only when the organization sees its share. */
export function apolloAllocationCopy(allocation: ApolloCreditAllocation) {
  const until = apolloAllocationEndLabel(allocation.endsAt);
  const used = allocation.usedBefore + Math.min(allocation.used, allocation.credits);
  const total = allocation.usedBefore + allocation.credits;
  const costs = `Cada correo usa ${APOLLO_ALLOCATION_EMAIL_CREDITS} crédito y cada teléfono, ${APOLLO_ALLOCATION_PHONE_CREDITS}. `
    + 'Lo que está en curso ya se cuenta. Las búsquedas no usan estos créditos.';
  if (!allocation.showLimit) {
    return {
      until, used, total: null, remaining: null, spent: false,
      summary: `Tu organización lleva ${count(used)} créditos de Apollo usados en este ciclo, que termina el ${until}.`,
      footnote: costs,
    };
  }
  const spent = allocation.remaining <= 0;
  return {
    until, used, total, remaining: allocation.remaining, spent,
    summary: spent
      ? `Se usaron los ${count(total)} créditos disponibles. Los correos y teléfonos están pausados hasta el ${until}; las búsquedas siguen disponibles.`
      : `Quedan solo ${count(allocation.remaining)} créditos disponibles hasta el ${until}: ya se usaron ${count(used)}.`,
    footnote: costs,
  };
}

/** The message of a refusal the screens show as it is (a person someone else holds, or the organization's share used). */
export function enrichmentRefusalMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (error !== 'LEAD_CLAIMED' && error !== APOLLO_ALLOCATION_ERROR) return null;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 300) : null;
}

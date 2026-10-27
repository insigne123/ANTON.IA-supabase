/**
 * Leads adjudicados (27 Oct 2026): a person a member of the organization saves (in Contactos or «Por escribir») belongs to
 * that member for 30 days from their first save. The others see «Adjudicado a Ana · le quedan 12 días» and cannot save them;
 * the database enforces it on every insert (migration 20261027120100) and says who holds the person and until when. Pure: the
 * screens, the server and the tests share it.
 */
export const LEAD_CLAIM_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

/** Whole days left of a claim, at least 1 while it holds; null when it is over or the date cannot be read. */
export function leadClaimDaysLeft(until: string | null | undefined, now = Date.now()): number | null {
  const end = Date.parse(String(until || ''));
  if (!Number.isFinite(end) || end <= now) return null;
  return Math.max(1, Math.ceil((end - now) / DAY));
}

const daysText = (days: number) => `le ${days === 1 ? 'queda 1 día' : `quedan ${days} días`}`;

/** «Adjudicado a Ana Pérez · le quedan 12 días». */
export function leadClaimText(ownerName: string | null | undefined, until: string | null | undefined, now = Date.now()) {
  const owner = ownerName?.trim() || 'otra persona del equipo';
  const days = leadClaimDaysLeft(until, now);
  return days === null ? `Adjudicado a ${owner}` : `Adjudicado a ${owner} · ${daysText(days)}`;
}

export type LeadClaimRefusal = { ownerName: string; daysLeft: number; message: string };

/**
 * The database's refusal to save a person someone else holds («lead_claimed», with who and how many days in its detail), or
 * null for any other error. The message is what the screens and Cowork say: «Adjudicado a Ana Pérez: le quedan 12 días.»
 */
export function leadClaimRefusal(error: unknown): LeadClaimRefusal | null {
  if (!error || typeof error !== 'object') return null;
  const { message, details, hint } = error as { message?: unknown; details?: unknown; hint?: unknown };
  if (message !== 'lead_claimed') return null;
  let parsed: { ownerName?: unknown; daysLeft?: unknown } = {};
  try { parsed = JSON.parse(String(details || '{}')); } catch { /* The hint still says it. */ }
  const ownerName = typeof parsed.ownerName === 'string' && parsed.ownerName.trim() ? parsed.ownerName.trim() : 'otra persona del equipo';
  const daysLeft = Number.isInteger(parsed.daysLeft) && Number(parsed.daysLeft) > 0 ? Number(parsed.daysLeft) : 1;
  const text = typeof hint === 'string' && hint.trim() ? hint.trim() : `Adjudicado a ${ownerName}: ${daysText(daysLeft)}.`;
  return { ownerName, daysLeft, message: text };
}

/** The refusal as an Error whose message is its text, for the paths that surface error messages; any other error as it was. */
export function withLeadClaimMessage(error: unknown): unknown {
  const refusal = leadClaimRefusal(error);
  return refusal ? Object.assign(new Error(refusal.message), { name: 'LeadClaimedError', leadClaim: refusal }) : error;
}

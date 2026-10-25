// A turn that failed for a passing reason (the model service slow, busy or down a moment) is retried once by the page, after a short
// countdown the person can stop (COW-22): 8 % of the turns failed, and «Reintentar» was most of the time all it took.
const TRANSIENT = new Set(['model_timeout', 'model_rate_limit', 'model_unavailable']);
export const COWORK_AUTO_RETRY_SECONDS = 20;
/** A failure read again later (the conversation reopened) is not retried by itself. */
const FRESH_MS = 2 * 60_000;
/** One automatic retry in a while: if it fails again, the person decides. */
const QUIET_MS = 5 * 60_000;

export function coworkAutoRetryDue(failure: { category?: unknown } | null | undefined, failedAt: string | null | undefined, now: number, lastAutoRetryAt: number | null) {
  if (!TRANSIENT.has(String(failure?.category || ''))) return false;
  const at = Date.parse(failedAt || '');
  if (!Number.isFinite(at) || now - at > FRESH_MS) return false;
  return lastAutoRetryAt === null || now - lastAutoRetryAt >= QUIET_MS;
}

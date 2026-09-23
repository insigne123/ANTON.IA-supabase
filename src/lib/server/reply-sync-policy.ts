/** Mailbox sweep windows (stage 6.3). A window resumes while its cursor is
 * fresh; a stale cursor restarts instead of trusting an old mailbox position.
 * Completed windows repeat at most every 12h to bound provider egress. */
export const SWEEP_RESUME_STALE_MS = 24 * 60 * 60 * 1000;
export const SWEEP_REPEAT_MS = 12 * 60 * 60 * 1000;
export const SWEEP_WINDOW_DAYS = 30;
export const SWEEP_PAGE_BUDGET = 2;
export const SWEEP_MATCH_BUDGET = 5;

export type MailboxSweepState = {
  page_token?: string | null;
  window_started_at?: string | null;
  last_completed_at?: string | null;
  window_days?: number | null;
} | null | undefined;

export function mailboxSweepDue(state: MailboxSweepState, now = Date.now()): { due: boolean; reason: string } {
  const startedMs = state?.window_started_at ? Date.parse(state.window_started_at) : NaN;
  if (state?.page_token) {
    if (!Number.isFinite(startedMs) || now - startedMs > SWEEP_RESUME_STALE_MS) return { due: true, reason: 'stale_cursor_restart' };
    return { due: true, reason: 'resume_window' };
  }
  const completedMs = state?.last_completed_at ? Date.parse(state.last_completed_at) : NaN;
  if (!Number.isFinite(completedMs)) return { due: true, reason: 'never_swept' };
  if (now - completedMs > SWEEP_REPEAT_MS) return { due: true, reason: 'window_expired' };
  return { due: false, reason: 'cooling_down' };
}

/** Apply before LIMIT so cooling-down contacts never starve healthy threads.
 * Server-generated timestamps only; no client input enters PostgREST grammar. */
export function replySyncDueFilter(now = Date.now()) {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return [
    'reply_sync_attempted_at.is.null',
    `and(reply_sync_error.is.null,reply_sync_attempted_at.lt.${ago(5)})`,
    `and(reply_sync_error.eq.incomplete_thread,reply_sync_attempted_at.lt.${ago(1440)})`,
    `and(reply_sync_error.eq.connection_required,reply_sync_attempted_at.lt.${ago(360)})`,
    `and(reply_sync_error.not.is.null,reply_sync_error.not.in.(incomplete_thread,connection_required),reply_sync_attempted_at.lt.${ago(60)})`,
  ].join(',');
}

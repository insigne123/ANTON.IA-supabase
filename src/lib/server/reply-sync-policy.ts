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

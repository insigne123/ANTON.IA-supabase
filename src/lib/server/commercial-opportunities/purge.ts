import type { SupabaseClient } from '@supabase/supabase-js';

/** How many closed, excluded and untouched opportunities one tick of the daily cron removes at most. */
export const PURGE_PER_TICK = 2000;

/**
 * Audit O1: removes what the automatic search kept only so it would not evaluate it twice, once nothing will list it again
 * (opportunity_purge_closed_excluded: excluded, untouched, closed a month ago or unseen for two). Null when the call failed
 * or the function is not there yet: the next tick tries again, and the daily work never waits for it.
 */
export async function purgeClosedExcluded(client: SupabaseClient, limit = PURGE_PER_TICK): Promise<number | null> {
  try {
    const { data, error } = await client.rpc('opportunity_purge_closed_excluded', { p_limit: limit });
    if (error) return null;
    return Number(data) || 0;
  } catch {
    return null;
  }
}

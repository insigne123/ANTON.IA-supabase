import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkUserIds } from '@/lib/cowork/access';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/** The people named in the configuration: the owner and COWORK_ALLOWED_USER_IDS. */
export function coworkConfiguredUserIds() {
  return coworkUserIds({ ownerId: process.env.COWORK_OWNER_USER_ID, allowedIds: process.env.COWORK_ALLOWED_USER_IDS });
}

const ACTIVE_DAYS = 30;
let active: { at: number; ids: string[] } | null = null;

/**
 * The people whose Cowork work the scheduled workers take: the configured ones and, with Cowork open to everyone
 * (COWORK_OPEN_TO_ALL), whoever started a conversation turn in the last 30 days. Every queued job comes from a turn, so
 * nobody with work waiting is left out, and an idle pass asks for a few people instead of every account. Read at most
 * once a minute; each job still checks the person's grant and membership before it runs.
 */
export async function coworkWorkerUserIds(client?: Pick<SupabaseClient, 'from'>, now = Date.now()): Promise<string[]> {
  const configured = coworkConfiguredUserIds();
  if (process.env.COWORK_OPEN_TO_ALL !== 'true') return configured;
  if (!active || now - active.at > 60_000) {
    const since = new Date(now - ACTIVE_DAYS * 86_400_000).toISOString();
    const { data, error } = await (client || getSupabaseAdminClient()).from('cowork_runs').select('user_id')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(2000);
    if (error) return active?.ids.length ? [...new Set([...configured, ...active.ids])] : configured;
    active = { at: now, ids: [...new Set(((data || []) as Array<{ user_id: string }>).map(row => String(row.user_id).toLowerCase()))] };
  }
  return [...new Set([...configured, ...active.ids])];
}

/** For tests: forget the people read in the last minute. */
export function forgetCoworkWorkerUsers() { active = null; }

/**
 * Each queue is claimed per person (the claim functions take p_user_id): asks for each one in turn and returns the first
 * job. The starting person rotates with the minute, so one person's queue never keeps another waiting.
 */
export async function claimForCoworkUsers<T>(claim: (userId: string) => Promise<T | null | undefined>, now = Date.now(),
  client?: Pick<SupabaseClient, 'from'>): Promise<T | null> {
  const ids = await coworkWorkerUserIds(client, now);
  const start = ids.length ? Math.floor(now / 60_000) % ids.length : 0;
  for (let index = 0; index < ids.length; index++) {
    const job = await claim(ids[(start + index) % ids.length]);
    if (job) return job;
  }
  return null;
}

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { stopCampaignV2Enrollment } from './stop';

/**
 * A follow-up plan whose first email never went out stops after 14 days (audit K1, 1 Nov 2026): that day 27 plans of one
 * person each had been waiting 37 days on average, the oldest since 11 Sep, and the follow-ups were never going to be due.
 * Each one is stopped with the same function as «Detener» (the plan's creator, as the RPC requires), so nothing is sent and
 * the plan reads as stopped in Campañas.
 */
export const INITIAL_SEND_EXPIRY_DAYS = 14;
const BATCH = 20;
type Client = ReturnType<typeof getSupabaseAdminClient>;

export async function expireStaleInitialSends(client: Client = getSupabaseAdminClient(), now = new Date()) {
  const cutoff = new Date(now.getTime() - INITIAL_SEND_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await client.from('campaign_enrollments').select('id,campaign_id,organization_id,user_id')
    .eq('status', 'pending_initial_send').lt('created_at', cutoff).order('created_at', { ascending: true }).limit(BATCH);
  if (error) throw error;
  let stopped = 0;
  for (const row of (data || []) as Array<{ id: string; campaign_id: string; organization_id: string; user_id: string }>) {
    try {
      await stopCampaignV2Enrollment({ campaignId: row.campaign_id, enrollmentId: row.id, organizationId: row.organization_id, userId: row.user_id, client });
      stopped += 1;
    } catch (failure) {
      console.warn('[campaigns-v2] stale initial send not stopped', { enrollmentId: row.id, error: failure instanceof Error ? failure.message : String(failure) });
    }
  }
  return { stopped };
}

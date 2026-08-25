import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export async function finalizeCampaignV2DispatchOutcome(
  dispatchId: string,
  client: SupabaseClientLike = getSupabaseAdminClient(),
) {
  const { data, error } = await client.rpc('finalize_campaign_recipient_step_dispatch_v2', {
    p_dispatch_id: dispatchId,
  });
  if (error) throw error;
  return data;
}

import { z } from 'zod';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

const PromotionResultSchema = z.object({
  promoted: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
}).strict();

export async function promoteDueCampaignV2Steps(input: {
  limit?: number;
  client?: SupabaseClientLike;
} = {}) {
  const client = input.client ?? getSupabaseAdminClient();
  const { data, error } = await client.rpc('promote_due_campaign_recipient_steps_v2', {
    p_limit: input.limit ?? 200,
  });
  if (error) throw error;
  return PromotionResultSchema.parse(data);
}

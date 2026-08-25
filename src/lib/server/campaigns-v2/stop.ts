import { StopCampaignV2EnrollmentResponseSchema } from '@/lib/campaigns-v2/contracts';
import { AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export async function stopCampaignV2Enrollment(input: {
  campaignId: string;
  enrollmentId: string;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const campaignResult = await client
    .from('campaigns')
    .select('user_id')
    .eq('id', input.campaignId)
    .eq('organization_id', input.organizationId)
    .eq('outreach_version', 2)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  if (!campaignResult.data) throw new AuthError('Campaign not found', 404);
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  assertCampaignV2CreatorAccess({ enabled, creatorId: campaignResult.data.user_id, userId: input.userId });

  const { data, error } = await client.rpc('stop_campaign_enrollment_v2', {
    p_campaign_id: input.campaignId,
    p_enrollment_id: input.enrollmentId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
  });
  if (error) throw error;
  return StopCampaignV2EnrollmentResponseSchema.parse(data);
}

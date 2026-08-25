import { AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { campaignV2CreatorAccessDecision } from './access-policy';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export async function isCampaignsV2Enabled(
  organizationId: string,
  client: SupabaseClientLike = getSupabaseAdminClient(),
) {
  const { data, error } = await client
    .from('organizations')
    .select('feature_campaigns_v2_enabled')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return data?.feature_campaigns_v2_enabled === true;
}

export async function enabledCampaignV2OrganizationIds(
  organizationIds: string[],
  client: SupabaseClientLike = getSupabaseAdminClient(),
) {
  const uniqueOrganizationIds = [...new Set(organizationIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (uniqueOrganizationIds.length === 0) return [];
  const { data, error } = await client
    .from('organizations')
    .select('id')
    .in('id', uniqueOrganizationIds)
    .eq('feature_campaigns_v2_enabled', true);
  if (error) throw error;
  return (data || []).map((row) => String(row.id));
}

export function assertCampaignV2CreatorAccess(input: {
  enabled: boolean;
  creatorId: string;
  userId: string;
}) {
  const decision = campaignV2CreatorAccessDecision(input);
  if (decision === 'not_found') throw new AuthError('Not Found', 404);
  if (decision === 'forbidden') {
    throw new AuthError('Only the campaign creator can perform this action', 403);
  }
}

export async function requireCampaignV2CreatorAccess(input: {
  organizationId: string;
  creatorId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const enabled = await isCampaignsV2Enabled(input.organizationId, input.client);
  assertCampaignV2CreatorAccess({ enabled, creatorId: input.creatorId, userId: input.userId });
}

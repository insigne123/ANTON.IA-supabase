import { z } from 'zod';

import { PrepareCampaignV2DraftResponseSchema } from '@/lib/campaigns-v2/contracts';
import { AuthError } from '@/lib/server/auth-utils';
import { createNativeDraft, getCurrentNativeDraft } from '@/lib/server/native-drafts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { campaignV2ComposeUrl } from './state';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

const PrepareClaimSchema = z.object({
  claimed: z.boolean(),
  state: z.string(),
  claimToken: z.string().uuid().optional(),
  draftId: z.string().uuid().optional(),
  versionId: z.string().uuid().optional(),
  snapshotId: z.string().uuid().nullable().optional(),
  instruction: z.string().trim().min(1).max(1_000).optional(),
  reason: z.string().optional(),
}).passthrough();

export async function prepareCampaignV2Draft(input: {
  stepId: string;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const stepResult = await client
    .from('campaign_recipient_steps')
    .select('id,campaign_id,native_draft_id')
    .eq('id', input.stepId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (stepResult.error) throw stepResult.error;
  if (!stepResult.data) throw new AuthError('Campaign recipient step not found', 404);
  const campaignResult = await client
    .from('campaigns')
    .select('user_id')
    .eq('id', stepResult.data.campaign_id)
    .eq('organization_id', input.organizationId)
    .eq('outreach_version', 2)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  if (!campaignResult.data) throw new AuthError('Campaign not found', 404);
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  assertCampaignV2CreatorAccess({ enabled, creatorId: campaignResult.data.user_id, userId: input.userId });

  if (stepResult.data.native_draft_id) {
    const existing = await getCurrentNativeDraft({
      organizationId: input.organizationId,
      userId: input.userId,
      draftId: stepResult.data.native_draft_id,
    });
    if (!existing) throw new Error('CAMPAIGN_V2_NATIVE_DRAFT_MISSING');
    return PrepareCampaignV2DraftResponseSchema.parse({
      draft: existing,
      composeUrl: campaignV2ComposeUrl(existing.draftId, input.stepId),
    });
  }

  const claimResult = await client.rpc('claim_campaign_recipient_step_prepare_v2', {
    p_step_id: input.stepId,
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
  });
  if (claimResult.error) throw claimResult.error;
  const claim = PrepareClaimSchema.parse(claimResult.data);
  if (!claim.claimed) {
    if (claim.draftId) {
      const existing = await getCurrentNativeDraft({
        organizationId: input.organizationId,
        userId: input.userId,
        draftId: claim.draftId,
      });
      if (existing) return PrepareCampaignV2DraftResponseSchema.parse({
        draft: existing,
        composeUrl: campaignV2ComposeUrl(existing.draftId, input.stepId),
      });
    }
    throw new AuthError(claim.reason || 'Campaign recipient step cannot be prepared', 409);
  }
  if (!claim.claimToken || !claim.snapshotId || !claim.instruction) {
    throw new Error('CAMPAIGN_V2_PREPARE_CONTEXT_MISSING');
  }

  let result;
  try {
    result = await createNativeDraft({
      organizationId: input.organizationId,
      userId: input.userId,
      snapshotId: claim.snapshotId,
      instruction: claim.instruction,
      idempotencyKey: `campaign-recipient-step:${input.stepId}`,
    });
  } catch (error) {
    await client
      .from('campaign_recipient_steps')
      .update({
        state: 'failed',
        preparation_claim_token: null,
        preparation_claimed_at: null,
        last_error: error instanceof Error ? error.message.slice(0, 2_000) : 'draft_generation_failed',
      })
      .eq('id', input.stepId)
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .eq('state', 'drafting')
      .eq('preparation_claim_token', claim.claimToken);
    throw error;
  }

  if (result.status !== 'drafted') {
    const state = result.status === 'blocked' ? 'blocked' : 'failed';
    const { error } = await client
      .from('campaign_recipient_steps')
      .update({
        state,
        preparation_claim_token: null,
        preparation_claimed_at: null,
        last_error: result.message.slice(0, 2_000),
      })
      .eq('id', input.stepId)
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .eq('state', 'drafting')
      .eq('preparation_claim_token', claim.claimToken);
    if (error) throw error;
    throw new AuthError(result.message, result.status === 'blocked' ? 422 : 503);
  }

  const { data: updated, error: updateError } = await client
    .from('campaign_recipient_steps')
    .update({
      state: 'review_required',
      native_draft_id: result.draft.draftId,
      native_version_id: result.draft.versionId,
      preparation_claim_token: null,
      preparation_claimed_at: null,
      last_error: null,
    })
    .eq('id', input.stepId)
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('state', 'drafting')
    .eq('preparation_claim_token', claim.claimToken)
    .select('id')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new Error('CAMPAIGN_V2_DRAFT_LINK_CONFLICT');

  return PrepareCampaignV2DraftResponseSchema.parse({
    draft: result.draft,
    composeUrl: campaignV2ComposeUrl(result.draft.draftId, input.stepId),
  });
}

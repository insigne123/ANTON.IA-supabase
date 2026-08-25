import {
  CampaignV2DispatchRetrySchema,
  CampaignV2RecipientStepSendContextResponseSchema,
} from '@/lib/campaigns-v2/contracts';
import { AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export function campaignV2PersistedRetryMetadata(providerResponse: unknown) {
  if (!providerResponse || typeof providerResponse !== 'object') return null;
  const retry = (providerResponse as Record<string, unknown>).retry;
  const parsed = CampaignV2DispatchRetrySchema.safeParse(retry);
  return parsed.success ? parsed.data : null;
}

export async function getCampaignV2RecipientStepSendContext(input: {
  stepId: string;
  organizationId: string;
  userId: string;
  client: SupabaseClientLike;
}) {
  const client = input.client;
  const stepResult = await client
    .from('campaign_recipient_steps')
    .select('id,campaign_id,state,native_draft_id,native_version_id,outbound_dispatch_id')
    .eq('id', input.stepId)
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
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

  const dispatchResult = await client
    .from('outbound_dispatches')
    .select('id,draft_id,version_id,status,idempotency_key,provider,provider_message_id,error_code,error_message,provider_response,campaign_recipient_step_id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('campaign_recipient_step_id', input.stepId)
    .maybeSingle();
  if (dispatchResult.error) throw dispatchResult.error;

  const step = stepResult.data;
  const dispatch = dispatchResult.data;
  if (step.outbound_dispatch_id && !dispatch) {
    throw new Error('CAMPAIGN_V2_DISPATCH_CONTEXT_MISSING');
  }
  if (dispatch && (
    dispatch.id !== step.outbound_dispatch_id
    || dispatch.campaign_recipient_step_id !== step.id
    || dispatch.draft_id !== step.native_draft_id
    || dispatch.version_id !== step.native_version_id
  )) {
    throw new Error('CAMPAIGN_V2_DISPATCH_CONTEXT_CONFLICT');
  }

  return CampaignV2RecipientStepSendContextResponseSchema.parse({
    stepId: step.id,
    organizationId: input.organizationId,
    state: step.state,
    nativeDraftId: step.native_draft_id ?? null,
    nativeVersionId: step.native_version_id ?? null,
    dispatch: dispatch ? {
      id: dispatch.id,
      status: dispatch.status,
      idempotencyKey: dispatch.idempotency_key,
      provider: dispatch.provider,
      providerMessageId: dispatch.provider_message_id ?? null,
      errorCode: dispatch.error_code ?? null,
      errorMessage: dispatch.error_message ?? null,
      retry: campaignV2PersistedRetryMetadata(dispatch.provider_response),
    } : null,
  });
}

import { z } from 'zod';

import { AuthError } from '@/lib/server/auth-utils';
import {
  createNativeDraft,
  getCurrentNativeDraft,
} from '@/lib/server/native-drafts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import type { MessagingDraftV1 } from '@/lib/messaging-contracts';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';
import { generateFollowUpDraftBatch } from './follow-up-draft-batch';

export { generateFollowUpDraftBatch } from './follow-up-draft-batch';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

export const DEFAULT_CAMPAIGN_V2_SEQUENCE_INSTRUCTION =
  'Haz avanzar la conversación de forma breve y útil, sin repetir los correos anteriores.';

export const CampaignV2DraftingConfigSchema = z.object({
  sequenceInstruction: z.string().trim().min(1).max(1_000),
  styleProfileId: z.string().uuid().nullable(),
}).strict();
export type CampaignV2DraftingConfig = z.infer<typeof CampaignV2DraftingConfigSchema>;

type FollowUpDraftStep = {
  id: string;
  index: number;
  name: string;
  offsetDays: number;
  instruction: string;
  nativeDraftId: string | null;
};

function text(value: unknown) {
  return String(value || '').trim();
}

function draftingConfig(settings: unknown) {
  const parsedSettings = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : {};
  return CampaignV2DraftingConfigSchema.parse(parsedSettings.followUpDrafting);
}

export async function pregenerateFirstContactPlanDrafts(input: {
  draftId: string;
  organizationId: string;
  userId: string;
  targetStepId?: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const campaignResult = await client
    .from('campaigns')
    .select('id,user_id,v2_status,settings')
    .eq('organization_id', input.organizationId)
    .eq('outreach_version', 2)
    .eq('initial_native_draft_id', input.draftId)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  if (!campaignResult.data) throw new AuthError('Campaign V2 plan not found', 404);
  const campaign = campaignResult.data;
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  assertCampaignV2CreatorAccess({ enabled, creatorId: text(campaign.user_id), userId: input.userId });
  if (campaign.v2_status !== 'draft') {
    if (input.targetStepId) {
      throw new AuthError('Follow-up drafts can only be generated before the initial send', 409);
    }
    return;
  }

  const enrollmentResult = await client
    .from('campaign_enrollments')
    .select('id,sequence_version_id,status,research_snapshot_id')
    .eq('organization_id', input.organizationId)
    .eq('campaign_id', campaign.id)
    .maybeSingle();
  if (enrollmentResult.error) throw enrollmentResult.error;
  if (!enrollmentResult.data) throw new Error('CAMPAIGN_V2_ENROLLMENT_MISSING');
  const enrollment = enrollmentResult.data;
  if (enrollment.status !== 'pending_initial_send') {
    if (input.targetStepId) {
      throw new AuthError('Follow-up drafts can only be generated before the initial send', 409);
    }
    return;
  }

  const recipientStepsResult = await client
    .from('campaign_recipient_steps')
    .select('id,sequence_step_id,step_index,native_draft_id')
    .eq('organization_id', input.organizationId)
    .eq('enrollment_id', enrollment.id)
    .gt('step_index', 0)
    .order('step_index', { ascending: true });
  if (recipientStepsResult.error) throw recipientStepsResult.error;
  const recipientSteps = recipientStepsResult.data || [];
  if (input.targetStepId && !recipientSteps.some((step: any) => step.id === input.targetStepId)) {
    throw new AuthError('Campaign follow-up step not found', 404);
  }

  const sequenceStepIds = recipientSteps.map((step: any) => step.sequence_step_id);
  const sequenceStepsResult = await client
    .from('campaign_sequence_steps_v2')
    .select('id,name,offset_days,instruction')
    .eq('organization_id', input.organizationId)
    .eq('sequence_version_id', enrollment.sequence_version_id)
    .in('id', sequenceStepIds);
  if (sequenceStepsResult.error) throw sequenceStepsResult.error;
  const sequenceSteps = new Map((sequenceStepsResult.data || []).map((step: any) => [step.id, step]));
  const steps: FollowUpDraftStep[] = recipientSteps.map((step: any) => {
    const sequence = sequenceSteps.get(step.sequence_step_id) as any;
    if (!sequence) throw new Error('CAMPAIGN_V2_SEQUENCE_STEP_MISSING');
    return {
      id: step.id,
      index: Number(step.step_index),
      name: sequence.name,
      offsetDays: Number(sequence.offset_days),
      instruction: sequence.instruction,
      nativeDraftId: step.native_draft_id ?? null,
    };
  });

  const initialDraft = await getCurrentNativeDraft({
    organizationId: input.organizationId,
    userId: input.userId,
    draftId: input.draftId,
  });
  if (!initialDraft) throw new Error('CAMPAIGN_V2_INITIAL_DRAFT_MISSING');
  const existingDrafts = new Map<string, MessagingDraftV1>();
  for (const step of steps) {
    if (!step.nativeDraftId) continue;
    const draft = await getCurrentNativeDraft({
      organizationId: input.organizationId,
      userId: input.userId,
      draftId: step.nativeDraftId,
    });
    if (!draft) throw new Error('CAMPAIGN_V2_NATIVE_DRAFT_MISSING');
    existingDrafts.set(step.id, draft);
  }

  await generateFollowUpDraftBatch({
    organizationId: input.organizationId,
    userId: input.userId,
    snapshotId: enrollment.research_snapshot_id,
    config: draftingConfig(campaign.settings),
    initialDraft,
    steps,
    existingDrafts,
    targetStepId: input.targetStepId,
  }, {
    createDraft: (request) => createNativeDraft(request),
    reserveDraft: async ({ stepId, draftId, versionId }) => {
      const { error } = await client.rpc('reserve_campaign_recipient_step_draft_v2', {
        p_step_id: stepId,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_draft_id: draftId,
        p_version_id: versionId,
      });
      if (error) throw error;
    },
    linkDraft: async ({ stepId, draft }) => {
      const { error } = await client.rpc('link_campaign_recipient_step_draft_v2', {
        p_step_id: stepId,
        p_organization_id: input.organizationId,
        p_user_id: input.userId,
        p_draft_id: draft.draftId,
        p_version_id: draft.versionId,
      });
      if (error) throw error;
    },
    recordError: async ({ stepId, error: message }) => {
      const { error } = await client
        .from('campaign_recipient_steps')
        .update({ last_error: message })
        .eq('id', stepId)
        .eq('organization_id', input.organizationId)
        .eq('user_id', input.userId)
        .eq('state', 'not_due')
        .is('native_draft_id', null);
      if (error) throw error;
    },
  });
}

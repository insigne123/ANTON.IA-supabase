import {
  OutreachSequenceContextV2Schema,
  type OutreachSequenceContextV2,
} from '@/lib/campaigns-v2/outreach-sequence-context';
import type { MessagingDraftV1 } from '@/lib/messaging-contracts';
import { AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';
import { DEFAULT_CAMPAIGN_V2_SEQUENCE_INSTRUCTION } from './follow-up-drafts';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

const EDITABLE_STEP_STATES = new Set([
  'pending_initial_send',
  'not_due',
  'ready_to_prepare',
  'drafting',
  'review_required',
  'approved',
]);

function text(value: unknown) {
  return String(value || '').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export async function resolveCampaignStepRewriteContext(input: {
  organizationId: string;
  userId: string;
  campaignStepId: string;
  draft?: MessagingDraftV1;
  client?: SupabaseClientLike;
}): Promise<OutreachSequenceContextV2> {
  const client = input.client ?? getSupabaseAdminClient();
  const stepResult = await client
    .from('campaign_recipient_steps')
    .select('id,campaign_id,enrollment_id,sequence_step_id,step_index,state,native_draft_id,native_version_id')
    .eq('id', input.campaignStepId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (stepResult.error) throw stepResult.error;
  const step = stepResult.data;
  if (!step) throw new AuthError('Campaign follow-up step not found', 404);
  if (input.draft && (
    text(step.native_draft_id) !== input.draft.draftId
    || text(step.native_version_id) !== input.draft.versionId
  )) {
    throw new AuthError('Campaign follow-up draft is no longer current', 409);
  }
  if (!EDITABLE_STEP_STATES.has(text(step.state))) {
    throw new AuthError('This follow-up can no longer be adjusted', 409);
  }

  const campaignResult = await client
    .from('campaigns')
    .select('id,user_id,settings')
    .eq('id', step.campaign_id)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  const campaign = campaignResult.data;
  if (!campaign) throw new AuthError('Campaign V2 not found', 404);
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  assertCampaignV2CreatorAccess({ enabled, creatorId: text(campaign.user_id), userId: input.userId });

  const allStepsResult = await client
    .from('campaign_recipient_steps')
    .select('id,sequence_step_id,step_index,native_draft_id,native_version_id')
    .eq('organization_id', input.organizationId)
    .eq('enrollment_id', step.enrollment_id)
    .order('step_index', { ascending: true });
  if (allStepsResult.error) throw allStepsResult.error;
  const allSteps = allStepsResult.data || [];
  const currentIndex = Number(step.step_index);
  const followUpSteps = allSteps.filter((item: any) => Number(item.step_index) > 0);
  const priorSteps = allSteps.filter((item: any) => Number(item.step_index) < currentIndex);
  const versionIds = priorSteps.map((item: any) => text(item.native_version_id)).filter(Boolean);
  const versionsResult = versionIds.length
    ? await client
      .from('messaging_draft_versions')
      .select('id,draft_id,content')
      .eq('organization_id', input.organizationId)
      .eq('user_id', input.userId)
      .in('id', versionIds)
    : { data: [], error: null };
  if (versionsResult.error) throw versionsResult.error;
  const versions = new Map((versionsResult.data || []).map((row: any) => [text(row.id), row]));

  const sequenceStepIds = allSteps.map((item: any) => text(item.sequence_step_id)).filter(Boolean);
  const sequenceStepsResult = sequenceStepIds.length
    ? await client
      .from('campaign_sequence_steps_v2')
      .select('id,name,offset_days,instruction')
      .eq('organization_id', input.organizationId)
      .in('id', sequenceStepIds)
    : { data: [], error: null };
  if (sequenceStepsResult.error) throw sequenceStepsResult.error;
  const sequenceSteps = new Map((sequenceStepsResult.data || []).map((row: any) => [text(row.id), row]));

  const priorMessages = priorSteps.map((prior: any) => {
    const version = versions.get(text(prior.native_version_id)) as any;
    if (!version || text(version.draft_id) !== text(prior.native_draft_id)) {
      throw new AuthError('A previous campaign email is no longer available', 409);
    }
    const content = object(version.content);
    const index = Number(prior.step_index);
    const sequence = sequenceSteps.get(text(prior.sequence_step_id)) as any;
    return {
      kind: index === 0 ? 'initial' as const : 'follow_up' as const,
      index,
      name: index === 0 ? 'Contacto inicial' : text(sequence?.name) || `Seguimiento ${index}`,
      subject: text(content.subject),
      body: text(content.text || content.html),
    };
  });
  const currentSequence = sequenceSteps.get(text(step.sequence_step_id)) as any;
  if (!currentSequence || priorMessages.length === 0 || priorMessages[0].kind !== 'initial') {
    throw new AuthError('Campaign sequence context is incomplete', 409);
  }
  const followUpDrafting = object(object(campaign.settings).followUpDrafting);

  return OutreachSequenceContextV2Schema.parse({
    sequenceInstruction: text(followUpDrafting.sequenceInstruction) || DEFAULT_CAMPAIGN_V2_SEQUENCE_INSTRUCTION,
    priorMessages,
    currentStep: {
      index: currentIndex,
      total: followUpSteps.length,
      name: text(currentSequence.name),
      offsetDays: Number(currentSequence.offset_days),
      instruction: text(currentSequence.instruction),
    },
  });
}

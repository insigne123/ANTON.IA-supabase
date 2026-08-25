import {
  FirstContactPlanSchema,
  type CreateFirstContactPlanBody,
  type FirstContactPlan,
} from '@/lib/campaigns-v2/contracts';
import { AuthError } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { assertCampaignV2CreatorAccess, isCampaignsV2Enabled } from './feature-access';
import {
  CampaignV2DraftingConfigSchema,
  DEFAULT_CAMPAIGN_V2_SEQUENCE_INSTRUCTION,
  pregenerateFirstContactPlanDrafts,
} from './follow-up-drafts';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

function text(value: unknown) {
  return String(value || '').trim();
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export async function resolveFirstContactPlanOrganization(input: {
  draftId: string;
  userId: string;
  organizationIds: string[];
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const organizationIds = [...new Set(input.organizationIds.map(text).filter(Boolean))];
  if (organizationIds.length === 0) return null;

  const campaignResult = await client
    .from('campaigns')
    .select('organization_id')
    .eq('outreach_version', 2)
    .eq('initial_native_draft_id', input.draftId)
    .eq('user_id', input.userId)
    .in('organization_id', organizationIds)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  if (campaignResult.data?.organization_id) return text(campaignResult.data.organization_id);

  const draftResult = await client
    .from('messaging_drafts')
    .select('organization_id')
    .eq('id', input.draftId)
    .eq('user_id', input.userId)
    .in('organization_id', organizationIds)
    .maybeSingle();
  if (draftResult.error) throw draftResult.error;
  return text(draftResult.data?.organization_id) || null;
}

export async function queryFirstContactPlan(input: {
  draftId: string;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}): Promise<FirstContactPlan | null> {
  const client = input.client ?? getSupabaseAdminClient();
  const campaignResult = await client
    .from('campaigns')
    .select('id,name,user_id,v2_status')
    .eq('organization_id', input.organizationId)
    .eq('user_id', input.userId)
    .eq('outreach_version', 2)
    .eq('initial_native_draft_id', input.draftId)
    .maybeSingle();
  if (campaignResult.error) throw campaignResult.error;
  const campaign = campaignResult.data;
  if (!campaign) return null;

  const enrollmentResult = await client
    .from('campaign_enrollments')
    .select('id,sequence_version_id,status,recipient_name,recipient_email,initial_sent_at,stopped_at')
    .eq('organization_id', input.organizationId)
    .eq('campaign_id', campaign.id)
    .maybeSingle();
  if (enrollmentResult.error) throw enrollmentResult.error;
  const enrollment = enrollmentResult.data;
  if (!enrollment) throw new Error('CAMPAIGN_V2_ENROLLMENT_MISSING');

  const recipientStepsResult = await client
    .from('campaign_recipient_steps')
    .select('id,sequence_step_id,step_index,state,due_at,native_draft_id,native_version_id,last_error')
    .eq('organization_id', input.organizationId)
    .eq('enrollment_id', enrollment.id)
    .order('step_index', { ascending: true });
  if (recipientStepsResult.error) throw recipientStepsResult.error;
  const recipientSteps = recipientStepsResult.data || [];
  const sequenceStepIds = recipientSteps.map((row: any) => row.sequence_step_id);
  const sequenceStepsResult = sequenceStepIds.length > 0
    ? await client
      .from('campaign_sequence_steps_v2')
      .select('id,name,offset_days,instruction')
      .eq('organization_id', input.organizationId)
      .in('id', sequenceStepIds)
    : { data: [], error: null };
  if (sequenceStepsResult.error) throw sequenceStepsResult.error;
  const sequenceSteps = new Map((sequenceStepsResult.data || []).map((row: any) => [row.id, row]));

  const draftIds = [...new Set(recipientSteps
    .map((row: any) => text(row.native_draft_id))
    .filter(Boolean))];
  const draftsResult = draftIds.length > 0
    ? await client
      .from('messaging_drafts')
      .select('id,current_version_id')
      .eq('organization_id', input.organizationId)
      .eq('user_id', campaign.user_id)
      .in('id', draftIds)
    : { data: [], error: null };
  if (draftsResult.error) throw draftsResult.error;
  const drafts = new Map((draftsResult.data || []).map((row: any) => [row.id, row]));
  const versionIds = [...new Set((draftsResult.data || [])
    .map((row: any) => text(row.current_version_id))
    .filter(Boolean))];
  const versionsResult = versionIds.length > 0
    ? await client
      .from('messaging_draft_versions')
      .select('id,draft_id,lifecycle,content,approval')
      .eq('organization_id', input.organizationId)
      .eq('user_id', campaign.user_id)
      .in('id', versionIds)
    : { data: [], error: null };
  if (versionsResult.error) throw versionsResult.error;
  const versions = new Map((versionsResult.data || []).map((row: any) => [row.id, row]));

  const followUpSteps = recipientSteps.filter((row: any) => Number(row.step_index) > 0).map((row: any) => {
      const sequence = sequenceSteps.get(row.sequence_step_id) as any;
      if (!sequence) throw new Error('CAMPAIGN_V2_SEQUENCE_STEP_MISSING');
      const nativeDraftId = text(row.native_draft_id) || null;
      const draftRow = nativeDraftId ? drafts.get(nativeDraftId) as any : null;
      const currentVersionId = text(draftRow?.current_version_id) || null;
      const version = currentVersionId ? versions.get(currentVersionId) as any : null;
      if (nativeDraftId && (
        !draftRow
        || !version
        || text(version.draft_id) !== nativeDraftId
        || currentVersionId !== text(row.native_version_id)
      )) {
        throw new Error('CAMPAIGN_V2_NATIVE_DRAFT_MISSING');
      }
      const content = object(version?.content);
      const draft = version ? {
        draftId: nativeDraftId,
        versionId: currentVersionId,
        subject: text(content.subject),
        body: text(content.text || content.html),
        lifecycle: version.lifecycle,
        approval: version.approval,
      } : null;
      return {
        id: row.id,
        name: sequence.name,
        kind: 'follow_up' as const,
        offsetDays: sequence.offset_days,
        state: row.state,
        dueAt: row.due_at ?? null,
        nativeDraftId,
        draft,
        draftGeneration: draft
          ? { status: 'ready' as const, error: null }
          : {
            status: 'error' as const,
            error: text(row.last_error) || 'El borrador de seguimiento aún no pudo generarse.',
          },
      };
    });
  return FirstContactPlanSchema.parse({
    campaignId: campaign.id,
    campaignName: campaign.name,
    lifecycleState: campaign.v2_status,
    enrollmentId: enrollment.id,
    enrollmentState: enrollment.status,
    nextDueAt: followUpSteps.find((step) => (
      !['sent', 'skipped', 'blocked'].includes(step.state) && step.dueAt
    ))?.dueAt ?? null,
    steps: followUpSteps,
  });
}

export async function getFirstContactPlan(input: {
  draftId: string;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  return {
    enabled,
    plan: enabled ? await queryFirstContactPlan({ ...input, client }) : null,
  };
}

export async function createFirstContactPlan(input: {
  body: CreateFirstContactPlanBody;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  const draftResult = await client
    .from('messaging_drafts')
    .select('user_id,current_version_id')
    .eq('id', input.body.draftId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (draftResult.error) throw draftResult.error;
  if (!draftResult.data) throw new AuthError('Native draft not found', 404);
  const enabled = await isCampaignsV2Enabled(input.organizationId, client);
  assertCampaignV2CreatorAccess({
    enabled,
    creatorId: text(draftResult.data.user_id),
    userId: input.userId,
  });
  const existing = await queryFirstContactPlan({
    draftId: input.body.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    client,
  });
  if (!existing && text(draftResult.data.current_version_id) !== input.body.versionId) {
    throw new AuthError('Native draft version is no longer current', 409);
  }
  const config = CampaignV2DraftingConfigSchema.parse({
    sequenceInstruction: input.body.sequenceInstruction || DEFAULT_CAMPAIGN_V2_SEQUENCE_INSTRUCTION,
    styleProfileId: input.body.styleProfileId ?? null,
  });
  const { error } = await client.rpc('create_first_contact_campaign_plan_v2', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_draft_id: input.body.draftId,
    p_version_id: input.body.versionId,
    p_style_profile_id: config.styleProfileId,
    p_sequence_instruction: config.sequenceInstruction,
    p_steps: input.body.steps,
  });
  if (error) throw error;

  await pregenerateFirstContactPlanDrafts({
    draftId: input.body.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    client,
  });
  const plan = await queryFirstContactPlan({
    draftId: input.body.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    client,
  });
  if (!plan) throw new Error('CAMPAIGN_V2_PLAN_PERSIST_FAILED');
  return { enabled: true as const, plan };
}

export async function retryFirstContactPlanStep(input: {
  draftId: string;
  stepId: string;
  organizationId: string;
  userId: string;
  client?: SupabaseClientLike;
}) {
  const client = input.client ?? getSupabaseAdminClient();
  await pregenerateFirstContactPlanDrafts({
    draftId: input.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    targetStepId: input.stepId,
    client,
  });
  const plan = await queryFirstContactPlan({
    draftId: input.draftId,
    organizationId: input.organizationId,
    userId: input.userId,
    client,
  });
  if (!plan) throw new Error('CAMPAIGN_V2_PLAN_PERSIST_FAILED');
  return { enabled: true as const, plan };
}

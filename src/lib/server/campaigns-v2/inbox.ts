import { z } from 'zod';

import {
  CampaignV2InboxResponseSchema,
  type CampaignV2InboxItem,
  type CampaignV2InboxResponse,
  type CampaignV2StepState,
} from '@/lib/campaigns-v2/contracts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { enabledCampaignV2OrganizationIds } from './feature-access';
import { campaignV2ComposeUrl, campaignV2NextAction } from './state';

export { campaignV2ComposeUrl, campaignV2NextAction } from './state';

type SupabaseClientLike = ReturnType<typeof getSupabaseAdminClient>;

const visibleInboxStates: CampaignV2StepState[] = [
  'pending_initial_send',
  'not_due',
  'ready_to_prepare',
  'drafting',
  'review_required',
  'approved',
  'dispatch_pending',
  'sending',
  'deferred',
  'failed',
  'unknown',
  'blocked',
];
export const CAMPAIGN_V2_INBOX_PAGE_SIZE = 50;

const InboxCursorPayloadSchema = z.object({
  version: z.literal(1),
  orderAt: z.string().datetime({ offset: true }),
  stepId: z.string().uuid(),
}).strict();
type InboxCursorPayload = z.infer<typeof InboxCursorPayloadSchema>;

type InboxStepRow = {
  id: string;
  campaign_id: string;
  enrollment_id: string;
  sequence_step_id: string;
  state: CampaignV2StepState;
  due_at: string | null;
  inbox_order_at: string;
  native_draft_id: string | null;
  native_version_id: string | null;
  campaign: { id: string; name: string } | Array<{ id: string; name: string }> | null;
};

type InboxEnrollmentRow = {
  id: string;
  recipient_name: string | null;
  recipient_email: string;
};

type InboxSequenceStepRow = {
  id: string;
  name: string;
};

type InboxDraftRow = {
  id: string;
  lifecycle: string;
  current_version_id: string | null;
};

export class CampaignV2InboxCursorError extends Error {
  constructor() {
    super('CAMPAIGN_V2_INBOX_CURSOR_INVALID');
    this.name = 'CampaignV2InboxCursorError';
  }
}

const emptySummary = {
  scope: 'page' as const,
  displayed: 0,
  pending: 0,
  attention: 0,
  campaigns: 0,
};

const emptyPage = {
  limit: CAMPAIGN_V2_INBOX_PAGE_SIZE,
  returned: 0,
  hasMore: false,
  nextCursor: null,
};

function decodeInboxCursor(value?: string | null): InboxCursorPayload | null {
  if (!value) return null;
  try {
    return InboxCursorPayloadSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new CampaignV2InboxCursorError();
  }
}

function encodeInboxCursor(row: InboxStepRow) {
  const payload = InboxCursorPayloadSchema.parse({
    version: 1,
    orderAt: row.inbox_order_at,
    stepId: row.id,
  });
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function applyInboxCursor(query: any, cursor: InboxCursorPayload | null) {
  if (!cursor) return query;
  return query.or([
    `inbox_order_at.gt.${cursor.orderAt}`,
    `and(inbox_order_at.eq.${cursor.orderAt},id.gt.${cursor.stepId})`,
  ].join(','));
}

function campaignFromStep(row: InboxStepRow) {
  return Array.isArray(row.campaign) ? row.campaign[0] : row.campaign;
}

export async function getCampaignV2Inbox(input: {
  organizationIds: string[];
  userId: string;
  cursor?: string | null;
  client?: SupabaseClientLike;
}): Promise<CampaignV2InboxResponse> {
  const client = input.client ?? getSupabaseAdminClient();
  const organizationIds = await enabledCampaignV2OrganizationIds(input.organizationIds, client);
  if (organizationIds.length === 0) return CampaignV2InboxResponseSchema.parse({
    enabled: false,
    items: [],
    page: emptyPage,
    summary: emptySummary,
  });

  const cursor = decodeInboxCursor(input.cursor);
  const stepsQuery = client
    .from('campaign_recipient_steps')
    .select(`
      id,campaign_id,enrollment_id,sequence_step_id,state,due_at,
      inbox_order_at,native_draft_id,native_version_id,
      campaign:campaigns!inner(id,name)
    `)
    .in('organization_id', organizationIds)
    .eq('user_id', input.userId)
    .in('state', visibleInboxStates)
    .or('state.neq.not_due,due_at.not.is.null')
    .in('campaign.organization_id', organizationIds)
    .eq('campaign.user_id', input.userId)
    .eq('campaign.outreach_version', 2)
    .in('campaign.v2_status', ['draft', 'active', 'blocked']);
  const stepsResult = await applyInboxCursor(stepsQuery, cursor)
    .order('inbox_order_at', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(CAMPAIGN_V2_INBOX_PAGE_SIZE + 1);
  if (stepsResult.error) throw stepsResult.error;
  const stepRows = (stepsResult.data || []) as InboxStepRow[];
  const hasMore = stepRows.length > CAMPAIGN_V2_INBOX_PAGE_SIZE;
  const steps = stepRows.slice(0, CAMPAIGN_V2_INBOX_PAGE_SIZE);
  if (steps.length === 0) {
    return CampaignV2InboxResponseSchema.parse({
      enabled: true,
      items: [],
      page: emptyPage,
      summary: emptySummary,
    });
  }

  const enrollmentIds = [...new Set(steps.map((row) => row.enrollment_id))];
  const sequenceStepIds = [...new Set(steps.map((row) => row.sequence_step_id))];
  const draftIds = [...new Set(steps.map((row) => row.native_draft_id).filter((id): id is string => Boolean(id)))];
  const [enrollmentResult, sequenceResult, draftsResult] = await Promise.all([
    client
      .from('campaign_enrollments')
      .select('id,recipient_name,recipient_email')
      .in('organization_id', organizationIds)
      .eq('user_id', input.userId)
      .in('id', enrollmentIds),
    client
      .from('campaign_sequence_steps_v2')
      .select('id,name')
      .in('organization_id', organizationIds)
      .eq('user_id', input.userId)
      .in('id', sequenceStepIds),
    draftIds.length > 0
      ? client
        .from('messaging_drafts')
        .select('id,lifecycle,current_version_id')
        .in('organization_id', organizationIds)
        .eq('user_id', input.userId)
        .in('id', draftIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (enrollmentResult.error) throw enrollmentResult.error;
  if (sequenceResult.error) throw sequenceResult.error;
  if (draftsResult.error) throw draftsResult.error;
  const enrollments = new Map<string, InboxEnrollmentRow>(
    ((enrollmentResult.data || []) as InboxEnrollmentRow[]).map((row) => [row.id, row]),
  );
  const sequenceSteps = new Map<string, InboxSequenceStepRow>(
    ((sequenceResult.data || []) as InboxSequenceStepRow[]).map((row) => [row.id, row]),
  );
  const drafts = new Map<string, InboxDraftRow>(
    ((draftsResult.data || []) as InboxDraftRow[]).map((row) => [row.id, row]),
  );

  const items: CampaignV2InboxItem[] = steps.map((row) => {
    const campaign = campaignFromStep(row);
    const enrollment = enrollments.get(row.enrollment_id);
    const sequence = sequenceSteps.get(row.sequence_step_id);
    const draft = row.native_draft_id ? drafts.get(row.native_draft_id) : null;
    if (!campaign || !enrollment || !sequence) throw new Error('CAMPAIGN_V2_INBOX_RELATION_MISSING');
    const state = row.state as CampaignV2StepState;
    return {
      stepId: row.id,
      campaignId: row.campaign_id,
      enrollmentId: row.enrollment_id,
      campaignName: campaign.name,
      recipientName: enrollment.recipient_name ?? null,
      recipientEmail: enrollment.recipient_email,
      stepName: sequence.name,
      state,
      dueAt: row.due_at ?? null,
      nativeDraftId: row.native_draft_id ?? null,
      composeUrl: campaignV2ComposeUrl(row.native_draft_id ?? null, row.id),
      nextAction: campaignV2NextAction({
        state,
        nativeDraftReady: draft?.lifecycle === 'ready' && draft?.current_version_id === row.native_version_id,
      }),
    };
  });

  const summary = {
    scope: 'page' as const,
    displayed: items.length,
    pending: items.filter((item) => !['deferred', 'failed', 'unknown', 'blocked'].includes(item.state)).length,
    attention: items.filter((item) => ['deferred', 'failed', 'unknown', 'blocked'].includes(item.state)).length,
    campaigns: new Set(items.map((item) => item.campaignId)).size,
  };
  const nextCursor = hasMore ? encodeInboxCursor(steps[steps.length - 1]) : null;
  return CampaignV2InboxResponseSchema.parse({
    enabled: true,
    items,
    page: {
      limit: CAMPAIGN_V2_INBOX_PAGE_SIZE,
      returned: items.length,
      hasMore,
      nextCursor,
    },
    summary,
  });
}

import type { MessagingDraftV1 } from '@/lib/messaging-contracts';

export type GmailReplyTarget = {
  provider: 'gmail';
  parentDispatchId: string;
  messageId: string;
  threadId: string;
};

export type EmailDeliveryMode = 'new_message' | 'reply_first' | 'reply_previous';

export class ReplyTargetError extends Error {}

// Only canonical enrollment links and confirmed dispatch receipts may select a parent.
export async function resolveCampaignReplyTarget(client: any, draft: MessagingDraftV1, provider: 'gmail' | 'outlook', mode: EmailDeliveryMode = 'new_message'): Promise<GmailReplyTarget | null> {
  // Existing campaign steps do not persist a threading preference. Never infer one
  // from step_index: callers must explicitly choose the first or previous message.
  if (mode === 'new_message') return null;
  if (mode !== 'reply_first' && mode !== 'reply_previous') throw new ReplyTargetError('REPLY_MODE_INVALID');
  // Graph /reply returns 202 without an ID. Its JSON contract does not guarantee
  // X-ANTON-Dispatch retention, which our reconciler requires. A createReply draft
  // ID cannot substitute for sent evidence; durable draft checkpoints are not implemented.
  // https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0
  // https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
  if (provider === 'outlook') throw new ReplyTargetError('OUTLOOK_NATIVE_REPLY_UNSUPPORTED');
  const scoped = (table: string) => client.from(table).select('*')
    .eq('organization_id', draft.organizationId).eq('user_id', draft.userId);
  const read = async (query: any) => {
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  };
  const step = await read(scoped('campaign_recipient_steps').eq('native_draft_id', draft.draftId));
  if (!step) throw new ReplyTargetError('REPLY_CAMPAIGN_LINK_REQUIRED');
  if (step.native_version_id !== draft.versionId) throw new ReplyTargetError('REPLY_STEP_VERSION_CONFLICT');
  if (step.step_index === 0) throw new ReplyTargetError('REPLY_PARENT_NOT_AVAILABLE_FOR_FIRST_CONTACT');
  if (!Number.isInteger(step.step_index) || step.step_index < 1) throw new ReplyTargetError('REPLY_STEP_INVALID');
  const enrollment = await read(scoped('campaign_enrollments').eq('id', step.enrollment_id).eq('campaign_id', step.campaign_id));
  if (!enrollment || String(enrollment.recipient_email).trim().toLowerCase() !== draft.recipient.email?.trim().toLowerCase()) {
    throw new ReplyTargetError('REPLY_ENROLLMENT_RECIPIENT_CONFLICT');
  }
  const previous = await read(scoped('campaign_recipient_steps').eq('enrollment_id', enrollment.id)
    .eq('campaign_id', step.campaign_id).eq('step_index', mode === 'reply_first' ? 0 : step.step_index - 1));
  if (!previous || previous.state !== 'sent' || !previous.outbound_dispatch_id) throw new ReplyTargetError('REPLY_PARENT_NOT_CONFIRMED');
  const receipt = await read(scoped('outbound_dispatches').eq('id', previous.outbound_dispatch_id)
    .eq('campaign_recipient_step_id', previous.id));
  if (!receipt || receipt.status !== 'sent' || receipt.provider !== provider || receipt.channel !== 'email'
    || receipt.draft_id !== previous.native_draft_id || receipt.version_id !== previous.native_version_id
    || !receipt.provider_message_id) throw new ReplyTargetError('REPLY_PARENT_RECEIPT_CONFLICT');
  const parentVersion = await read(scoped('messaging_draft_versions').eq('id', receipt.version_id).eq('draft_id', receipt.draft_id));
  if (!parentVersion || String(parentVersion.recipient?.email || '').trim().toLowerCase() !== draft.recipient.email?.trim().toLowerCase()) {
    throw new ReplyTargetError('REPLY_PARENT_RECIPIENT_CONFLICT');
  }
  const response = receipt.provider_response;
  if (!response?.threadId || response.id !== receipt.provider_message_id) throw new ReplyTargetError('REPLY_PARENT_THREAD_MISSING');
  return { provider: 'gmail', parentDispatchId: receipt.id, messageId: receipt.provider_message_id, threadId: response.threadId };
}

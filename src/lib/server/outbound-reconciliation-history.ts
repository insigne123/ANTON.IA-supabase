import type { OutboundDispatch } from '@/lib/server/outbound-dispatch';
import { CONFIRMED_SEND_COPY, bulkCampaignIdFromDispatchKey } from '@/lib/bulk-campaign-attempts';
import { finalizeCampaignDeliveryOutcome, isCampaignDispatchKey } from '@/lib/server/campaign-deliveries';
import { finalizeSentOutboundDispatchHistory } from '@/lib/server/outbound-history-projection';

type DraftVersionLike = {
  recipient?: Record<string, unknown> | null;
  payload?: Record<string, any> | null;
};

export type HistoryRepairResult = {
  repaired: boolean;
  reason?: string;
  finalized?: boolean;
  contactedId?: string;
  eventId?: string;
  leadUpdated?: boolean;
  campaignUpdated?: boolean;
};

function text(value: unknown) {
  return String(value || '').trim();
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function normalizedEmail(value: unknown) {
  return text(value).toLowerCase();
}

/**
 * A bulk campaign keeps its own success marker (bulk_campaign_attempts), the one that survives dispatch retention. An Outlook send
 * is confirmed only here, so the marker is written here too. Best effort: the campaign worker writes it on its next pass otherwise.
 */
async function confirmBulkCampaignAttempt(admin: any, dispatch: OutboundDispatch) {
  const campaignId = bulkCampaignIdFromDispatchKey(dispatch.idempotencyKey);
  if (!campaignId || !dispatch.draftId) return;
  try {
    await admin.rpc('record_bulk_campaign_attempt_v1', {
      p_campaign_id: campaignId, p_draft_id: dispatch.draftId, p_state: 'sent', p_code: 'sent', p_message: CONFIRMED_SEND_COPY, p_retry_at: null,
    });
  } catch { /* the worker repairs it */ }
}

export async function repairReconciledSentDispatchHistory(input: {
  admin: any;
  dispatch: OutboundDispatch;
  draftVersion: DraftVersionLike;
}): Promise<HistoryRepairResult> {
  const { admin, dispatch, draftVersion } = input;
  if (dispatch.status !== 'sent') {
    return { repaired: false, reason: 'not_sent' };
  }
  if (dispatch.channel !== 'email') {
    return { repaired: false, reason: 'unsupported_channel' };
  }

  const versionRecipient = record(draftVersion.recipient || draftVersion.payload?.recipient);
  const metadataEmail = normalizedEmail(dispatch.metadata.recipient.email);
  const draftEmail = normalizedEmail(versionRecipient.email);
  if (!metadataEmail && !draftEmail) throw new Error('Reconciled email dispatch has no recipient email.');
  if (metadataEmail && draftEmail && metadataEmail !== draftEmail) {
    throw new Error('Draft recipient does not match reconciled dispatch metadata.');
  }

  await confirmBulkCampaignAttempt(admin, dispatch);

  if (isCampaignDispatchKey(dispatch.idempotencyKey)) {
    const delivery = await finalizeCampaignDeliveryOutcome(dispatch.id, admin);
    if (!delivery.finalized) {
      throw new Error(`Campaign delivery did not finalize: ${delivery.reason || 'unknown_reason'}`);
    }
  }

  const finalized = await finalizeSentOutboundDispatchHistory(dispatch.id, admin);

  return {
    repaired: finalized.repaired,
    reason: text(finalized.reason) || undefined,
    finalized: finalized.finalized,
    contactedId: text(finalized.contactedId) || undefined,
    eventId: text(finalized.eventId) || undefined,
    leadUpdated: finalized.leadUpdated === true,
    campaignUpdated: finalized.campaignUpdated === true,
  };
}

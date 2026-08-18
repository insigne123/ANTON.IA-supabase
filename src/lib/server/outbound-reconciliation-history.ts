import type { OutboundDispatch } from '@/lib/server/outbound-dispatch';

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

export async function repairReconciledSentDispatchHistory(input: {
  admin: any;
  dispatch: OutboundDispatch;
  draftVersion: DraftVersionLike;
}): Promise<HistoryRepairResult> {
  const { admin, dispatch, draftVersion } = input;
  if (dispatch.status !== 'sent' || !dispatch.reconciledAt) {
    return { repaired: false, reason: 'not_reconciled_sent' };
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

  const { data, error } = await admin.rpc('repair_reconciled_sent_dispatch_history_v1', {
    p_dispatch_id: dispatch.id,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.repaired !== 'boolean') {
    throw new Error('History repair RPC returned an invalid result.');
  }

  return {
    repaired: data.repaired,
    reason: text(data.reason) || undefined,
    finalized: data.finalized === true,
    contactedId: text(data.contactedId) || undefined,
    eventId: text(data.eventId) || undefined,
    leadUpdated: data.leadUpdated === true,
    campaignUpdated: data.campaignUpdated === true,
  };
}

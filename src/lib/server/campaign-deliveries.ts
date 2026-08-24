import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type CampaignDeliveryFinalization = {
  isCampaign: boolean;
  finalized: boolean;
  reason?: string;
  deliveryId?: string;
  deliveryState?: string;
};

export type CampaignDeliveryProgress = {
  stepIndex: number;
  sentAt: string | null;
};

type CampaignDeliveryProgressRow = {
  recipient_key?: unknown;
  step_index?: unknown;
  delivery_state?: unknown;
  sent_at?: unknown;
  completed_at?: unknown;
};

const campaignDispatchKey = /^campaign:[^:]+:[^:]+:step:\d+$/i;

function text(value: unknown) {
  return String(value || '').trim();
}

export function isCampaignDispatchKey(idempotencyKey: unknown) {
  return campaignDispatchKey.test(text(idempotencyKey));
}

export function campaignDeliveryProgressByRecipient(rows: CampaignDeliveryProgressRow[]) {
  const progress = new Map<string, CampaignDeliveryProgress>();

  for (const row of rows || []) {
    if (text(row.delivery_state).toLowerCase() !== 'sent') continue;
    const recipientKey = text(row.recipient_key);
    const stepIndex = Number(row.step_index);
    if (!recipientKey || !Number.isInteger(stepIndex) || stepIndex < 0) continue;

    const sentAt = text(row.sent_at) || text(row.completed_at) || null;
    const existing = progress.get(recipientKey);
    if (!existing || stepIndex > existing.stepIndex) {
      progress.set(recipientKey, { stepIndex, sentAt });
    }
  }

  return progress;
}

export async function finalizeCampaignDeliveryOutcome(
  dispatchId: string,
  client: any = getSupabaseAdminClient(),
): Promise<CampaignDeliveryFinalization> {
  const { data, error } = await client.rpc('finalize_campaign_delivery_outcome_v1', {
    p_dispatch_id: dispatchId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.isCampaign !== 'boolean' || typeof data.finalized !== 'boolean') {
    throw new Error('Campaign delivery finalizer returned an invalid result.');
  }

  return {
    isCampaign: data.isCampaign,
    finalized: data.finalized,
    reason: text(data.reason) || undefined,
    deliveryId: text(data.deliveryId) || undefined,
    deliveryState: text(data.deliveryState) || undefined,
  };
}

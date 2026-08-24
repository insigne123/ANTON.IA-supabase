import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type SentDispatchHistoryProjection = {
  repaired: boolean;
  finalized: boolean;
  reason?: string;
  contactedId?: string;
  eventId?: string;
  leadUpdated?: boolean;
  campaignUpdated?: boolean;
};

function text(value: unknown) {
  return String(value || '').trim();
}

export async function finalizeSentOutboundDispatchHistory(
  dispatchId: string,
  client: any = getSupabaseAdminClient(),
): Promise<SentDispatchHistoryProjection> {
  const { data, error } = await client.rpc('finalize_sent_outbound_dispatch_history_v1', {
    p_dispatch_id: dispatchId,
  });
  if (error) throw error;
  if (!data || typeof data !== 'object' || typeof data.repaired !== 'boolean' || data.finalized !== true) {
    throw new Error('Sent dispatch history finalizer returned an invalid result.');
  }

  return {
    repaired: data.repaired,
    finalized: true,
    reason: text(data.reason) || undefined,
    contactedId: text(data.contactedId) || undefined,
    eventId: text(data.eventId) || undefined,
    ...(data.leadUpdated === true ? { leadUpdated: true } : {}),
    ...(data.campaignUpdated === true ? { campaignUpdated: true } : {}),
  };
}

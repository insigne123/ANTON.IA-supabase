import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
export { buildThreadKey, deriveLifecycleState } from './email-observability-core';

export async function safeInsertEmailEvent(supabase: any, payload: Record<string, any>) {
  try {
    const dispatchId = String(payload?.meta?.dispatchId || '').trim();
    if (payload.event_type === 'sent' && dispatchId && payload.organization_id) {
      const existing = await supabase
        .from('email_events')
        .select('id')
        .eq('organization_id', payload.organization_id)
        .eq('event_type', 'sent')
        .contains('meta', { dispatchId })
        .maybeSingle();
      if (existing?.error) return existing;
      if (existing?.data) return { data: existing.data, error: null };
    }

    const result = await supabase.from('email_events').insert(payload);
    if (!result?.error) {
      await safeAppendAntoniaEvent({
        eventType: `email.${String(payload.event_type || payload.type || 'event').trim() || 'event'}`,
        organizationId: payload.organization_id || null,
        actorId: payload.user_id || null,
        actorType: payload.user_id ? 'user' : 'system',
        entityType: 'email_event',
        entityId: payload.id || payload.message_id || payload.provider_message_id || null,
        contactedId: payload.contacted_lead_id || payload.contacted_id || null,
        sourceSystem: 'email-observability',
        provider: payload.provider || null,
        providerRequestId: payload.provider_message_id || payload.message_id || null,
        operationId: payload.idempotency_key || payload.event_id || payload.message_id || null,
        status: payload.status || payload.event_type || 'recorded',
        outcome: payload.event_type || payload.type || 'recorded',
        metrics: {
          hasThreadKey: Boolean(payload.thread_key),
          hasProviderMessageId: Boolean(payload.provider_message_id || payload.message_id),
        },
        payload: {
          eventType: payload.event_type || payload.type || null,
          lifecycleState: payload.lifecycle_state || null,
          threadKey: payload.thread_key || null,
        },
      });
    }
    return result;
  } catch (error) {
    return { error };
  }
}

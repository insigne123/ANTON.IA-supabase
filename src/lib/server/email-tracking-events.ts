const DISPATCH_KEY = /^[A-Za-z0-9._:-]{12,200}$/;

export async function recordDispatchTrackingEvent(client: any, input: { dispatchKey: string; kind: 'email_opened' | 'email_clicked'; destination?: string | null }) {
  const key = String(input.dispatchKey || '').trim();
  if (!DISPATCH_KEY.test(key)) return { tracked: false as const };
  let query = client.from('outbound_dispatches').select('id,organization_id,user_id,provider,provider_message_id,status,metadata').eq('status', 'sent');
  query = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key) ? query.eq('id', key) : query.eq('idempotency_key', key);
  const dispatchResult = await query.maybeSingle();
  if (dispatchResult.error || !dispatchResult.data?.provider_message_id) return { tracked: false as const };
  const dispatch = dispatchResult.data;
  const contactResult = await client.from('contacted_leads').select('id,lead_id,mission_id,provider,thread_key,opened_at,click_count,engagement_score')
    .eq('organization_id', dispatch.organization_id).eq('user_id', dispatch.user_id).eq('message_id', dispatch.provider_message_id).maybeSingle();
  if (contactResult.error || !contactResult.data) return { tracked: false as const };
  const contact = contactResult.data;
  const now = new Date().toISOString();
  const update = input.kind === 'email_opened'
    ? (!contact.opened_at ? { opened_at: now, last_interaction_at: now, last_update_at: now } : null)
    : { click_count: Number(contact.click_count || 0) + 1, clicked_at: now, last_interaction_at: now, last_update_at: now };
  if (update) {
    const updateQuery = client.from('contacted_leads').update(update).eq('id', contact.id).eq('organization_id', dispatch.organization_id);
    const saved = input.kind === 'email_opened'
      ? await updateQuery.is('opened_at', null).select('id').maybeSingle()
      : await updateQuery;
    if (saved.error) return { tracked: false as const };
    if (input.kind === 'email_opened' && !saved.data) return { tracked: true as const, contactedId: contact.id, firstOpen: false };
    const event = await client.from('email_events').insert({
      organization_id: dispatch.organization_id, mission_id: contact.mission_id || null,
      contacted_id: contact.id, lead_id: contact.lead_id || null, provider: contact.provider,
      event_type: input.kind, event_source: 'dispatch_tracking', event_at: now,
      thread_key: contact.thread_key || null, message_id: dispatch.provider_message_id,
      meta: { dispatchId: dispatch.id, trackingMethod: input.kind === 'email_opened' ? 'pixel' : 'redirect', ...(input.destination ? { destination: input.destination } : {}) },
    });
    if (event.error) console.error('[tracking] event insert failed', event.error);
  }
  return { tracked: true as const, contactedId: contact.id, firstOpen: input.kind === 'email_opened' && !contact.opened_at };
}

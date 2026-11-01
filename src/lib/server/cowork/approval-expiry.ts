import type { SupabaseClient } from '@supabase/supabase-js';
import { COWORK_APPROVAL_EXPIRY_DAYS } from '@/lib/cowork/approval-expiry-copy';

/**
 * A proposal nobody approves stops waiting after a week (audit C1, 1 Nov 2026): on 1 Nov 12 runs had been waiting 14 days on
 * average, the oldest since 24 Sep, and their counters kept asking for attention. Each one is stopped with the same RPC as
 * «Detener» (it only touches runs still waiting) and keeps an `approval.expired` event, so the conversation says why.
 */
const BATCH = 20;

export async function expireStaleCoworkApprovals(client: SupabaseClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - COWORK_APPROVAL_EXPIRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await client.from('cowork_runs').select('id,user_id,organization_id')
    .eq('status', 'waiting_approval').lt('updated_at', cutoff).order('updated_at', { ascending: true }).limit(BATCH);
  if (error) throw error;
  let expired = 0;
  for (const run of (data || []) as Array<{ id: string; user_id: string; organization_id: string }>) {
    const cancelled = await client.rpc('cowork_cancel_run', { p_user_id: run.user_id, p_organization_id: run.organization_id, p_run_id: run.id });
    if (cancelled.error || cancelled.data !== true) continue;
    await client.from('cowork_run_events').insert({ run_id: run.id, user_id: run.user_id, organization_id: run.organization_id,
      kind: 'approval.expired', payload: { days: COWORK_APPROVAL_EXPIRY_DAYS } });
    expired += 1;
  }
  return { expired };
}

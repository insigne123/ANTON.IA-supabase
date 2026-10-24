import type { AuthContext } from '@/lib/server/auth-utils';
import { dayInZone, dayStartInZone } from '@/lib/admin/chile-time';
import { COWORK_CONVERSATION_CAP, COWORK_DAILY_CAP, coworkUsageShare, type CoworkUsage } from '@/lib/cowork/usage';

/**
 * The share of the assistant's use the conversation and the person's day have taken (COW-15), read from the same ledger the caps
 * count (cowork_model_calls, readable by its owner). Null when the ledger is off: then there is no cap to show.
 */
export async function getCoworkUsage(auth: AuthContext, rootId: string, now = new Date()): Promise<CoworkUsage | null> {
  if (process.env.COWORK_MODEL_BUDGET_ENABLED !== 'true') return null;
  const { data: runs, error } = await auth.supabase.from('cowork_runs').select('id')
    .eq('root_run_id', rootId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).limit(500);
  if (error) throw error;
  const ids = new Set(((runs || []) as Array<{ id: string }>).map(run => run.id));
  const dayStart = dayStartInZone(dayInZone(now)).toISOString();
  // The conversation's calls and the day's, in one read: each is capped well under the limit (200 and 300 rows).
  const filter = ids.size ? `created_at.gte."${dayStart}",run_id.in.(${[...ids].join(',')})` : `created_at.gte."${dayStart}"`;
  const { data: calls, error: callError } = await auth.supabase.from('cowork_model_calls').select('run_id,output_reserved,created_at')
    .eq('user_id', auth.user.id).or(filter).limit(1000);
  if (callError) throw callError;
  const rows = (calls || []) as Array<{ run_id: string; output_reserved: number; created_at: string }>;
  return {
    conversation: coworkUsageShare(rows.filter(row => ids.has(row.run_id)).map(row => Number(row.output_reserved)), COWORK_CONVERSATION_CAP),
    today: coworkUsageShare(rows.filter(row => Date.parse(row.created_at) >= Date.parse(dayStart)).map(row => Number(row.output_reserved)), COWORK_DAILY_CAP),
  };
}

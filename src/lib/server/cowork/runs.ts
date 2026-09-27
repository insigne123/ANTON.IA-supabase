import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkRequestSchema } from '@/lib/cowork/contracts';
import { assertCoworkModeAvailable } from '@/lib/cowork/execution-policy';
import { resolveCoworkRuntime } from '@/lib/cowork/runtime-config';
import { deterministicCoworkUuid } from './operations';

export function coworkWorkerConfigured() {
  return resolveCoworkRuntime(process.env).ready;
}

/** Worker continuations use a request id derived from their parent run. The
 * id itself never leaves the server; the UI only learns the boolean. */
function withAutomaticFlag<T extends { parent_run_id?: string | null; request_id?: string | null }>(run: T) {
  const { request_id: requestId, ...rest } = run;
  const automatic = Boolean(run.parent_run_id && requestId
    && requestId === deterministicCoworkUuid(`cowork:continuation:${run.parent_run_id}`));
  return { ...rest, automatic };
}

export async function listCoworkRuns(auth: AuthContext) {
  const { data, error } = await auth.supabase.from('cowork_runs')
    .select('id,message,mode,status,created_at,parent_run_id,request_id').eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data || []).map(withAutomaticFlag);
}

/** Newest run that continues `id` (a worker continuation or a user follow-up). */
export async function getCoworkContinuation(auth: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const { data, error } = await auth.supabase.from('cowork_runs')
    .select('id,status,created_at').eq('parent_run_id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, status: data.status as string } : null;
}

export async function getCoworkRun(auth: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const { data: row, error } = await auth.supabase.from('cowork_runs')
    .select('id,message,mode,status,created_at,parent_run_id,depth,request_id').eq('id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const run = withAutomaticFlag(row);
  const { data: events, error: eventError } = await auth.supabase.from('cowork_run_events')
    .select('sequence,kind,payload,created_at').eq('run_id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('sequence', { ascending: true }).limit(200);
  if (eventError) throw eventError;
  return { run, events };
}

/** Where a run stands, in two indexed lookups: its status and its latest event.
 * The live stream compares these to tell the page when to refresh. */
export async function getCoworkRunCursor(auth: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const { data: run, error } = await auth.supabase.from('cowork_runs')
    .select('status').eq('id', id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw error;
  if (!run) return null;
  const { data: last, error: eventError } = await auth.supabase.from('cowork_run_events')
    .select('sequence').eq('run_id', id).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId)
    .order('sequence', { ascending: false }).limit(1).maybeSingle();
  if (eventError) throw eventError;
  return { status: String(run.status), sequence: typeof last?.sequence === 'number' ? last.sequence : 0 };
}

export async function admitCoworkRun(auth: AuthContext, body: unknown) {
  const input = coworkRequestSchema.parse(body);
  assertCoworkModeAvailable(input.mode, process.env.COWORK_AUTONOMY_ENABLED === 'true');
  const { data, error } = await getSupabaseAdminClient().rpc('cowork_admit_followup', {
    p_user_id: auth.user.id, p_organization_id: auth.organizationId,
    p_request_id: input.requestId, p_message: input.message, p_mode: input.mode,
    p_parent_run_id: input.parentRunId || null, p_reset_depth: true,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelCoworkRun(auth: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const { data, error } = await getSupabaseAdminClient().rpc('cowork_cancel_run', {
    p_user_id: auth.user.id, p_organization_id: auth.organizationId, p_run_id: id,
  });
  if (error) throw error;
  return data === true;
}

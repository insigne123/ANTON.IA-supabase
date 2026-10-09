import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkRequestSchema, type CoworkRun, type CoworkEvent } from '@/lib/cowork/contracts';
import { assertCoworkModeAvailable } from '@/lib/cowork/execution-policy';
import { resolveCoworkRuntime } from '@/lib/cowork/runtime-config';
import { deterministicCoworkUuid } from './operations';
import { createExecutorBuildProvider, coworkBuildIdentity } from './build-provider';

export function coworkWorkerConfigured() {
  return resolveCoworkRuntime(process.env).ready;
}

/** Worker continuations use a request id derived from their parent run, and so does the notice that research finished
 * (research-notice.ts). The id itself never leaves the server; the UI only learns the boolean and, for a notice, why. */
function withAutomaticFlag<T extends { parent_run_id?: string | null; request_id?: string | null }>(run: T) {
  const { request_id: requestId, ...rest } = run;
  const derived = (seed: string) => Boolean(run.parent_run_id && requestId && requestId === deterministicCoworkUuid(`${seed}:${run.parent_run_id}`));
  const research = derived('cowork:research-notice');
  return { ...rest, automatic: research || derived('cowork:continuation'), ...(research ? { automaticReason: 'research' as const } : {}) };
}

/** Whether a run is one the worker started (a continuation or a research notice), not a message the person sent. */
export function coworkRunIsAutomatic(run: { parent_run_id?: string | null; request_id?: string | null }) {
  return withAutomaticFlag(run).automatic;
}

const RUN_LIST_LIMIT = 50;

/** The latest runs, without the conversations the person deleted (hid): those leave the list, not the database. */
export async function listCoworkRuns(auth: AuthContext, { hiddenRootIds = [] }: { hiddenRootIds?: string[] } = {}) {
  const hidden = new Set(hiddenRootIds);
  // Hidden conversations still hold runs: read further back so the list keeps its 50 visible runs.
  const { data, error } = await auth.supabase.from('cowork_runs')
    .select('id,message,mode,status,created_at,parent_run_id,root_run_id,request_id').eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(hidden.size ? 200 : RUN_LIST_LIMIT);
  if (error) throw error;
  return (data || [])
    .filter((run: { root_run_id?: string | null }) => !run.root_run_id || !hidden.has(run.root_run_id))
    .slice(0, RUN_LIST_LIMIT)
    .map(withAutomaticFlag);
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
    .select('id,message,mode,status,created_at,parent_run_id,root_run_id,depth,request_id').eq('id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const run = withAutomaticFlag(row as CoworkRun & { request_id?: string | null });
  const { data: events, error: eventError } = await auth.supabase.from('cowork_run_events')
    .select('sequence,kind,payload,created_at').eq('run_id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('sequence', { ascending: true }).limit(200);
  if (eventError) throw eventError;
  const history = (events || []) as CoworkEvent[];
  const clarification = history.find(event => event.kind === 'clarification.requested')?.payload as { parentRunId?: unknown } | undefined;
  return { run: { ...run, ...(typeof clarification?.parentRunId === 'string' ? { clarificationOf: clarification.parentRunId } : {}) }, events: history };
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
  if (input.clarificationOf) {
    if (process.env.COWORK_CLARIFICATIONS_ENABLED !== 'true' || input.parentRunId !== input.clarificationOf) throw new Error('Las preguntas sobre propuestas aún no están disponibles en esta versión. Conservamos tu mensaje.');
    const { data, error } = await getSupabaseAdminClient().rpc('cowork_admit_clarification', {
      p_user_id: auth.user.id, p_organization_id: auth.organizationId, p_request_id: input.requestId,
      p_message: input.message, p_parent_run_id: input.clarificationOf,
    });
    if (error) throw error;
    return data as string;
  }
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
  if (data === true && process.env.COWORK_EXECUTOR_ASYNC_ENABLED === 'true') {
    const url = process.env.COWORK_EXECUTOR_URL || '', secret = process.env.COWORK_EXECUTOR_SECRET || '';
    if (url && secret) {
      let confirmed = false;
      try { const job = await createExecutorBuildProvider(url, secret).cancel(coworkBuildIdentity(id)); confirmed = job?.status === 'cancelled'; }
      catch { /* The run cannot publish; compute stop remains unconfirmed until reconciliation. */ }
      const stored = await getSupabaseAdminClient().from('cowork_run_events').insert({ run_id: id,user_id: auth.user.id,
        organization_id: auth.organizationId,kind: confirmed ? 'build.cancelled' : 'build.cancel_requested',payload: { jobId: coworkBuildIdentity(id), stopConfirmed: confirmed } });
      if (stored.error) console.warn('[cowork] cancel receipt unavailable');
    }
  }
  return data === true;
}

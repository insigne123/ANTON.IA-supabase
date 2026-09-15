import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkRequestSchema } from '@/lib/cowork/contracts';

export function coworkWorkerConfigured() {
  return process.env.COWORK_WORKER_ENABLED === 'true'
    && Boolean(process.env.COWORK_MODEL?.trim() && process.env.COWORK_WORKER_SECRET?.trim());
}

export async function listCoworkRuns(auth: AuthContext) {
  const { data, error } = await auth.supabase.from('cowork_runs')
    .select('id,message,mode,status,created_at').eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data;
}

export async function getCoworkRun(auth: AuthContext, id: string) {
  z.string().uuid().parse(id);
  const { data: run, error } = await auth.supabase.from('cowork_runs')
    .select('id,message,mode,status,created_at').eq('id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).maybeSingle();
  if (error) throw error;
  if (!run) return null;
  const { data: events, error: eventError } = await auth.supabase.from('cowork_run_events')
    .select('sequence,kind,payload,created_at').eq('run_id', id).eq('user_id', auth.user.id)
    .eq('organization_id', auth.organizationId).order('sequence', { ascending: true }).limit(200);
  if (eventError) throw eventError;
  return { run, events };
}

export async function admitCoworkRun(auth: AuthContext, body: unknown) {
  const input = coworkRequestSchema.parse(body);
  const { data, error } = await getSupabaseAdminClient().rpc('cowork_admit_followup', {
    p_user_id: auth.user.id, p_organization_id: auth.organizationId,
    p_request_id: input.requestId, p_message: input.message, p_mode: input.mode,
    p_parent_run_id: input.parentRunId || null,
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

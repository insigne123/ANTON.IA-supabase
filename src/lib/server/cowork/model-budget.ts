import type { SupabaseClient } from '@supabase/supabase-js';

export async function reserveCoworkModelCall(client: SupabaseClient, runId: string, token: string,
  role: 'coordinator' | 'analyst' | 'researcher' | 'verifier', taskId: string | null = null) {
  if (process.env.COWORK_MODEL_BUDGET_ENABLED !== 'true') return;
  const { data, error } = await client.rpc('cowork_reserve_model_call', {
    p_run_id: runId, p_token: token, p_role: role, p_task_id: taskId,
  });
  if (error || typeof data !== 'string') throw new Error('No se pudo reservar presupuesto para continuar este trabajo.');
  return data;
}

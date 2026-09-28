import type { SupabaseClient } from '@supabase/supabase-js';

/** Roles the ledger budgets: the coordinator and the in-turn agents under the run's lease,
 * and the specialists under their task's lease. */
export type CoworkModelRole = 'coordinator' | 'writer' | 'reviewer' | 'judge' | 'analyst' | 'researcher' | 'verifier';

const IN_TURN_AGENTS = new Set<CoworkModelRole>(['writer', 'reviewer', 'judge']);

export async function reserveCoworkModelCall(client: SupabaseClient, runId: string, token: string,
  role: CoworkModelRole, taskId: string | null = null) {
  if (process.env.COWORK_MODEL_BUDGET_ENABLED !== 'true') return;
  const reserve = (as: CoworkModelRole) => client.rpc('cowork_reserve_model_call', {
    p_run_id: runId, p_token: token, p_role: as, p_task_id: taskId,
  });
  let { data, error } = await reserve(role);
  // Until the ledger knows the in-turn agents (20260928030000), their calls count as the
  // coordinator's: the same lease, and the same caps per turn and per conversation.
  if (error && IN_TURN_AGENTS.has(role) && /Specialist attempt unavailable/.test(error.message || '')) ({ data, error } = await reserve('coordinator'));
  if (error || typeof data !== 'string') throw new Error('No se pudo reservar presupuesto para continuar este trabajo.');
  return data;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { coworkTaskPlanSchema, type CoworkActiveTask, type CoworkTaskCost } from '@/lib/cowork/task-plan';
import { coworkRunIsAutomatic } from './runs';

type Scope = { userId: string; organizationId: string };

/** Long tasks (Plan 13, 4c). Off unless COWORK_TASKS_ENABLED=true: they need the «task_plan» effect in the database (migration
 * 20261007120000). */
export function coworkTasksEnabled(env: Record<string, string | undefined> = process.env) {
  return env.COWORK_TASKS_ENABLED === 'true';
}

/** The run events of a task: the plan a turn proposed, the plan once approved, and each step it approved by itself. */
export const COWORK_TASK_EVENTS = { plan: 'task.plan', started: 'task.started', step: 'task.step' } as const;

export function parseCoworkTaskTarget(targetId: string) {
  const match = /^task:([0-9a-f]{32})$/.exec(String(targetId || ''));
  if (!match) throw new Error('El plan propuesto no es válido.');
  return { hash: match[1] };
}

export async function coworkTaskRunEvents(client: SupabaseClient, scope: Scope, runId: string, kind: string) {
  const { data, error } = await client.from('cowork_run_events').select('payload')
    .eq('run_id', runId).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('kind', kind)
    .order('sequence', { ascending: true });
  if (error) throw new Error('No se pudo leer la tarea.');
  return (data || []).map(row => row.payload as Record<string, unknown>);
}

type AncestorRun = { id: string; parent_run_id: string | null; request_id: string | null; depth: number | null };

/**
 * The task this turn continues, or null. A task goes on only through the worker's own continuations: walking up from this turn,
 * every turn up to the one that started it must be automatic. A message from the person ends it, and so does a thread that
 * never started one.
 */
export async function loadCoworkActiveTask(client: SupabaseClient, scope: Scope, runId: string): Promise<CoworkActiveTask | null> {
  const visited: string[] = [];
  let cursor: string | null = runId;
  for (let step = 0; step < 10 && cursor; step++) {
    const found: { data: AncestorRun | null; error: unknown } = await client.from('cowork_runs').select('id,parent_run_id,request_id,depth')
      .eq('id', cursor).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
    const run = found.data;
    if (found.error || !run) return null;
    const started = step === 0 ? [] : await coworkTaskRunEvents(client, scope, run.id, COWORK_TASK_EVENTS.started);
    const plan = coworkTaskPlanSchema.safeParse(started.at(-1)?.plan);
    if (plan.success) {
      const steps = (await Promise.all(visited.map(id => coworkTaskRunEvents(client, scope, id, COWORK_TASK_EVENTS.step)))).flat();
      const sum = (key: 'searches' | 'credits') => steps.reduce((total, payload) => total + (Number(payload[key]) || 0), 0);
      return { startRunId: run.id, startDepth: run.depth || 0, plan: plan.data, used: { steps: steps.length, searches: sum('searches'), credits: sum('credits') } };
    }
    if (!coworkRunIsAutomatic(run)) return null;
    visited.push(run.id);
    cursor = run.parent_run_id;
  }
  return null;
}

/** A step the task approved by itself, with what it spent: the next turns count it against the plan's limits. */
export async function recordCoworkTaskStep(client: SupabaseClient, scope: Scope, runId: string, step: { kind: string } & CoworkTaskCost) {
  const recorded = await client.from('cowork_run_events').insert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
    kind: COWORK_TASK_EVENTS.step, payload: step,
  });
  if (recorded.error) throw new Error('No se pudo registrar el paso de la tarea.');
}

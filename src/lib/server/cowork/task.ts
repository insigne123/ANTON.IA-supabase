import { createHash } from 'node:crypto';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { coworkTaskPlanLabel, coworkTaskPlanProblem, coworkTaskPlanSchema, type CoworkTaskPlan } from '@/lib/cowork/task-plan';
import { requireCoworkWorkerAccess } from './access';
import { COWORK_TASK_EVENTS, coworkTaskRunEvents, parseCoworkTaskTarget } from './task-state';

export { COWORK_TASK_EVENTS, coworkTasksEnabled, loadCoworkActiveTask, parseCoworkTaskTarget, recordCoworkTaskStep } from './task-state';

type Scope = { userId: string; organizationId: string };

const hashPlan = (plan: CoworkTaskPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 32);

/** Stages the plan as an event of the run that proposes it (the card reads it from there) and returns its target and line. */
export async function stageCoworkTaskPlan(scope: Scope, runId: string, input: unknown) {
  const plan = coworkTaskPlanSchema.parse(input);
  const problem = coworkTaskPlanProblem(plan);
  if (problem) throw new Error(`El plan no cuadra: ${problem}.`);
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const hash = hashPlan(plan);
  const recorded = await client.from('cowork_run_events').insert({
    run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
    kind: COWORK_TASK_EVENTS.plan, payload: { hash, plan },
  });
  if (recorded.error) throw new Error('No se pudo preparar el plan.');
  return { targetId: `task:${hash}`, label: coworkTaskPlanLabel(plan), plan };
}

/** Approving the card starts the task: the approved plan is kept on its run, where the next turns find it. */
export async function executeCoworkTaskStart(auth: AuthContext, runId: string, targetId: string) {
  const { hash } = parseCoworkTaskTarget(targetId);
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  const client = getSupabaseAdminClient();
  await requireCoworkWorkerAccess(client, scope);
  const staged = (await coworkTaskRunEvents(client, scope, runId, COWORK_TASK_EVENTS.plan)).find(payload => payload.hash === hash);
  const parsed = coworkTaskPlanSchema.safeParse(staged?.plan);
  if (!parsed.success) throw new Error('El plan aprobado ya no está disponible.');
  const plan = parsed.data;
  if (!(await coworkTaskRunEvents(client, scope, runId, COWORK_TASK_EVENTS.started)).some(payload => payload.hash === hash)) {
    const started = await client.from('cowork_run_events').insert({
      run_id: runId, user_id: scope.userId, organization_id: scope.organizationId,
      kind: COWORK_TASK_EVENTS.started, payload: { hash, plan },
    });
    if (started.error) throw new Error('No se pudo iniciar la tarea.');
  }
  return { reply: `Empecé la tarea: ${plan.goal}. Te voy contando el avance de cada paso; lo que salga del plan te lo pregunto antes.`,
    result: { hash, steps: plan.steps.length, limits: plan.limits } };
}


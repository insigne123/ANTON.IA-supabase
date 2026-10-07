import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deterministicCoworkUuid } from './operations';
import { COWORK_TASK_EVENTS, coworkTasksEnabled, loadCoworkActiveTask, parseCoworkTaskTarget } from './task-state';

const scope = { userId: 'u1', organizationId: 'o1' };
const plan = { goal: 'Escribirles a los 10 mejores', limits: { searches: 1, credits: 10 },
  steps: [{ label: 'Buscar 25 gerentes', kind: 'search' }, { label: 'Guardar y buscar su correo', kind: 'prepare' }] };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// A continuation's request id is derived from its parent, as the worker admits it.
const automatic = (runId: string, parent: string) => ({ id: runId, parent_run_id: parent, depth: 0, request_id: deterministicCoworkUuid(`cowork:continuation:${parent}`) });
const human = (runId: string, parent: string | null) => ({ id: runId, parent_run_id: parent, depth: 0, request_id: id(900) });

function fakeClient(runs: Array<Record<string, unknown>>, events: Array<{ run_id: string; kind: string; payload: unknown }>) {
  return { from: (table: string) => {
    const where: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (key: string, value: unknown) => { where[key] = value; return chain; },
      order: () => chain,
      maybeSingle: async () => ({ data: runs.find(run => run.id === where.id) ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: table === 'cowork_run_events'
        ? events.filter(event => event.run_id === where.run_id && event.kind === where.kind).map(event => ({ payload: event.payload })) : [], error: null }),
    };
    return chain;
  } } as unknown as SupabaseClient;
}

test('tasks are off unless COWORK_TASKS_ENABLED=true, and a plan target is task: and its hash', () => {
  assert.equal(coworkTasksEnabled({}), false);
  assert.equal(coworkTasksEnabled({ COWORK_TASKS_ENABLED: 'true' }), true);
  assert.deepEqual(parseCoworkTaskTarget(`task:${'a'.repeat(32)}`), { hash: 'a'.repeat(32) });
  assert.throws(() => parseCoworkTaskTarget('task:../x'), /no es válido/);
});

test('a task goes on through the worker\'s continuations, counting what its steps spent', async () => {
  const runs = [human(id(1), null), automatic(id(2), id(1)), automatic(id(3), id(2))];
  const events = [
    { run_id: id(1), kind: COWORK_TASK_EVENTS.started, payload: { hash: 'h', plan } },
    { run_id: id(2), kind: COWORK_TASK_EVENTS.step, payload: { kind: 'search', searches: 1, credits: 0 } },
    { run_id: id(3), kind: COWORK_TASK_EVENTS.step, payload: { kind: 'lead_prepare_batch', searches: 0, credits: 6 } },
  ];
  const task = await loadCoworkActiveTask(fakeClient(runs, events), scope, id(3));
  assert.equal(task?.startRunId, id(1));
  assert.deepEqual(task?.used, { steps: 2, searches: 1, credits: 6 });
  assert.equal(task?.plan.goal, plan.goal);
});

test('a message from the person ends the task, and a thread that never started one has none', async () => {
  const events = [{ run_id: id(1), kind: COWORK_TASK_EVENTS.started, payload: { hash: 'h', plan } }];
  // The person wrote after the task's continuation.
  const runs = [human(id(1), null), automatic(id(2), id(1)), human(id(3), id(2))];
  assert.equal(await loadCoworkActiveTask(fakeClient(runs, events), scope, id(3)), null);
  // The run that proposed the plan is not inside it either: approving it starts the task.
  assert.equal(await loadCoworkActiveTask(fakeClient(runs, events), scope, id(1)), null);
  assert.equal(await loadCoworkActiveTask(fakeClient([human(id(1), null), automatic(id(2), id(1))], []), scope, id(2)), null);
});

test('the worker approves by itself only what fits the plan, and never past the plan\'s limits or outside the task', async () => {
  const { readFileSync } = await import('node:fs');
  const worker = readFileSync('src/lib/server/cowork/worker.ts', 'utf8');
  // The plan is proposed only outside a task, with tasks on.
  assert.match(worker, /const activeTask = tasksEnabled \? await loadCoworkActiveTask\(client, scope, run\.id\)\.catch\(\(\) => null\) : null;/);
  assert.match(worker, /if \(activeTask\) throw new Error\('Ya hay una tarea en curso en este hilo/);
  // Effects: autonomy first, then the task, which records what it spent before approving.
  assert.match(worker, /\} else if \(activeTask && coworkTaskApproves\(activeTask, proposal\.kind, \{ searches: 0, credits: taskCredits \}\)\) \{\n[^\n]*\n[^\n]*\n\s*await recordCoworkTaskStep\(client, scope, run\.id, \{ kind: proposal\.kind, searches: 0, credits: taskCredits \}\);\n\s*const approved = await resolveCoworkEffect\(client, scope, run\.id, true\);/);
  // A looked-up email is a credit; a batch counts its own.
  assert.match(worker, /let taskCredits = proposal\.kind === 'enrich_contact' \? 1 : 0;/);
  assert.match(worker, /taskCredits = staged\.cost\.lookups;/);
  assert.match(worker, /taskCredits = staged\.costEstimate;/);
  // The search of the plan.
  assert.match(worker, /const planned = !autonomous && activeTask !== null && coworkTaskApproves\(activeTask, null, \{ searches: 1, credits: 0 \}\);/);
  // The turn reads the task and has room for its steps; continuations too.
  assert.match(worker, /\.\.\.\(activeTask \? \{ task: coworkTaskContext\(activeTask\) \} : \{\}\)/);
  assert.match(worker, /coworkTaskThreadBudget\(coworkThreadBudgets\(run\.mode, autonomyEnabled\), activeTask\)/);
  const effects = readFileSync('src/lib/server/cowork/effects.ts', 'utf8');
  assert.match(effects, /coworkTaskThreadBudget\(coworkThreadBudgets\(mode, process\.env\.COWORK_AUTONOMY_ENABLED === 'true'\), task\)/);
  assert.match(effects, /job\.kind === 'task_plan'\n[^\n]*\n\s*\? 'El usuario aprobó el plan de la tarea \(task\)\. Empieza ahora por su primer paso pendiente, sin volver a preguntar\.'/);
});

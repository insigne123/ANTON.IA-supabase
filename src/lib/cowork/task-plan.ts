import { z } from 'zod';

/**
 * Long tasks (Plan 13, 4c): a request of several steps («busca 25 gerentes de RR. HH. de retail, guarda los 10 mejores,
 * búscales el correo y escríbeles una secuencia») becomes one plan the person approves once, as in Claude Cowork: the steps,
 * what it may spend (searches of the daily quota and email credits) and what it never does without asking. Each step that fits
 * the plan is approved by itself and the task goes on in continuations; anything outside it (sending, activating a campaign,
 * LinkedIn, a bigger spend) waits for the person as always. A message from the person ends the task.
 */

/** What a step of a plan does. Writing needs no approval; the others are the effects the task may approve by itself. */
export const COWORK_TASK_STEP_KINDS = ['search', 'prepare', 'write', 'campaign'] as const;
export type CoworkTaskStepKind = typeof COWORK_TASK_STEP_KINDS[number];

/** The effects each kind of step approves inside the task. Nothing that sends, activates or reaches a person is here. */
const STEP_EFFECTS: Record<CoworkTaskStepKind, readonly string[]> = {
  search: [],
  prepare: ['lead_prepare_batch', 'save_contact', 'enrich_contact', 'start_research', 'enrich_batch'],
  write: [],
  campaign: ['campaign_create'],
};

/** What the plan card promises: never done by the task, always asked for. */
export const COWORK_TASK_NEVER = ['Enviar correos o mensajes', 'Activar una campaña', 'Invitar o escribir por LinkedIn', 'Gastar más de lo aprobado'];

export const COWORK_TASK_LIMITS = { steps: 6, searches: 1, credits: 50 } as const;

export const coworkTaskPlanSchema = z.object({
  goal: z.string().trim().min(3).max(300),
  steps: z.array(z.object({
    label: z.string().trim().min(3).max(160),
    kind: z.enum(COWORK_TASK_STEP_KINDS),
  }).strict()).min(2).max(COWORK_TASK_LIMITS.steps),
  limits: z.object({
    searches: z.number().int().min(0).max(COWORK_TASK_LIMITS.searches),
    credits: z.number().int().min(0).max(COWORK_TASK_LIMITS.credits),
  }).strict(),
}).strict();
export type CoworkTaskPlan = z.infer<typeof coworkTaskPlanSchema>;

/** A plan whose limits say what its steps need: a search step needs a search, a search without its step is not a plan. */
export function coworkTaskPlanProblem(plan: CoworkTaskPlan): string | null {
  const kinds = new Set(plan.steps.map(step => step.kind));
  if (kinds.has('search') && plan.limits.searches < 1) return 'el plan busca prospectos pero limits.searches es 0';
  if (!kinds.has('search') && plan.limits.searches > 0) return 'limits.searches es mayor que 0 sin un paso search';
  if (!kinds.has('prepare') && plan.limits.credits > 0) return 'limits.credits es mayor que 0 sin un paso prepare';
  return null;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The card's line: «Tarea de 4 pasos · hasta 1 búsqueda y 10 créditos». */
export function coworkTaskPlanLabel(plan: CoworkTaskPlan) {
  const spend = [plan.limits.searches ? plural(plan.limits.searches, 'búsqueda', 'búsquedas') : '',
    plan.limits.credits ? plural(plan.limits.credits, 'crédito', 'créditos') : ''].filter(Boolean);
  return `Tarea de ${plural(plan.steps.length, 'paso', 'pasos')}${spend.length ? ` · hasta ${spend.join(' y ')}` : ' · sin gastos'}`.slice(0, 280);
}

/** What the approved task has spent so far: the steps it approved by itself, the searches and the credits. */
export type CoworkTaskUsage = { steps: number; searches: number; credits: number };

export type CoworkActiveTask = { startRunId: string; startDepth: number; plan: CoworkTaskPlan; used: CoworkTaskUsage };

/** What an effect proposed inside the task costs, as the task counts it. */
export type CoworkTaskCost = { searches: number; credits: number };

/**
 * Whether the task approves this proposal by itself: its kind belongs to a step of the plan and it fits in what is left of the
 * plan's searches, credits and steps. A null `kind` is the search of prospects.
 */
export function coworkTaskApproves(task: CoworkActiveTask, kind: string | null, cost: CoworkTaskCost): boolean {
  const kinds = new Set(task.plan.steps.map(step => step.kind));
  const allowed = kind === null ? kinds.has('search') : [...kinds].some(step => STEP_EFFECTS[step].includes(kind));
  if (!allowed) return false;
  if (task.used.steps >= task.plan.steps.length + 1) return false;
  if (task.used.searches + cost.searches > task.plan.limits.searches) return false;
  return task.used.credits + cost.credits <= task.plan.limits.credits;
}

/** A thread running a task may take as many automatic steps as the plan has, beyond the usual budget (never past 10 deep). */
export function coworkTaskThreadBudget<T extends { maxDepth: number; maxEffects: number; maxSearches: number }>(base: T, task: CoworkActiveTask | null): T {
  if (!task) return base;
  const steps = task.plan.steps.length;
  return {
    ...base,
    maxDepth: Math.min(10, Math.max(base.maxDepth, task.startDepth + steps + 2)),
    maxEffects: Math.max(base.maxEffects, steps + 2),
    maxSearches: Math.max(base.maxSearches, task.plan.limits.searches + 1),
  };
}

const TASK_INSTRUCTION = 'Estás ejecutando una tarea que el usuario ya aprobó (task). Haz ahora el siguiente paso pendiente del plan, sin '
  + 'preguntar antes: las búsquedas, preparaciones y la campaña pausada que caben en el plan y en lo que queda de sus límites se aprueban '
  + 'solas; lo que no cabe (enviar, activar, LinkedIn o un gasto mayor) pide aprobación como siempre, y dilo en una frase. Un paso de '
  + 'redactar (write) se hace en esta respuesta. Cuando no quede ningún paso, cierra con el resumen de lo hecho, cifras incluidas, y lo que '
  + 'queda para el usuario (por ejemplo activar la campaña).';

/** What a turn inside the task reads: the plan, what it already spent and how to go on. */
export function coworkTaskContext(task: CoworkActiveTask) {
  return {
    goal: task.plan.goal,
    steps: task.plan.steps,
    limits: task.plan.limits,
    used: task.used,
    left: { searches: Math.max(0, task.plan.limits.searches - task.used.searches), credits: Math.max(0, task.plan.limits.credits - task.used.credits) },
    instruction: TASK_INSTRUCTION,
  };
}

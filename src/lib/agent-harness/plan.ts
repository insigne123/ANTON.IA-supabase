// The plan of a run, as the person reads it: two to five short steps that the model writes before it starts and checks off as it goes
// (Claude Code's task list). It is the model's own working memory in a long run and what the screen shows while it works. Pure.
import { z } from 'zod';
import { defineTool } from './tools';
import type { AgentTool } from './types';

export const planSchema = z.object({
  pasos: z.array(z.object({
    paso: z.string().min(3).max(120).describe('Qué haces, en pocas palabras y sin ids ni nombres de herramientas'),
    estado: z.enum(['pendiente', 'en_curso', 'hecho']),
  })).min(2).max(6),
});
export type PlanStep = { label: string; status: 'pendiente' | 'en_curso' | 'hecho' };

export const PLAN_STATE = 'plan.steps';

/** `onPlan` hears every version of the plan (to show it); the latest also stays in the run's state. */
export function planTool(onPlan?: (steps: PlanStep[]) => void | Promise<void>): AgentTool {
  return defineTool({
    name: 'actualizar_plan',
    description: 'Escribe o actualiza tu plan de trabajo cuando el pedido tiene varias partes (2 a 6 pasos cortos). Márcalo al empezar y cada vez que avances; no lo uses para pedidos de un solo paso.',
    schema: planSchema,
    kind: 'meta',
    run: async ({ pasos }, context) => {
      const steps = pasos.map((item): PlanStep => ({ label: item.paso.trim(), status: item.estado }));
      context.state.set(PLAN_STATE, steps);
      await onPlan?.(steps);
      const pending = steps.filter(step => step.status !== 'hecho').length;
      return { status: 'ok', output: steps, text: pending ? `Plan guardado. Faltan ${pending} paso(s): sigue con el que está en curso.` : 'Plan completo: entrega la respuesta.' };
    },
  });
}

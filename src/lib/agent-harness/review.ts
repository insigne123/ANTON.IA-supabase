// The reviewer: a second model reads the answer against what was asked and what the run actually found, and says what is wrong in
// concrete lines or lets it pass. It sends back, it does not rewrite: the author fixes its own answer with the reviewer's lines in
// hand (a reviewer that rewrites drops facts and adds actions nobody asked for, as the 2026-09 «forced correction» runs showed).
// Cheap checks that need no model (a figure with no source, a placeholder left in, an empty section) go first and are plain functions.
import { z } from 'zod';
import { runStructured } from './structured';
import type { AgentHooks, ReviewInfo } from './loop';
import type { Effort, ModelClient } from './types';

export const reviewSchema = z.object({
  verdict: z.enum(['pass', 'fix']),
  /** What is wrong, one line each, with where; empty when it passes. */
  issues: z.array(z.string().min(3).max(400)).max(8),
});
export type Review = z.infer<typeof reviewSchema>;

/** A check without a model: returns the problem, or null. */
export type Check<T> = (output: T, info: ReviewInfo) => string | null | Promise<string | null>;

export const REVIEWER_SYSTEM = [
  'Eres el revisor de una respuesta que otro agente escribió para una persona. Recibes lo que la persona pidió, lo que el agente averiguó (la evidencia) y su respuesta.',
  'Di si la respuesta se puede entregar. Marca «fix» solo por defectos concretos que cambian lo que la persona hace o entiende:',
  '- una cifra, nombre, fecha o afirmación que no está en la evidencia;',
  '- algo que la persona pidió y no está, o algo que hizo sin que se lo pidieran;',
  '- una pregunta que la persona ya respondió o que el agente podía averiguar solo;',
  '- texto a medio escribir ([completar], {{x}}, «etc.»), contradicciones o instrucciones técnicas internas a la vista.',
  'No marques «fix» por estilo, orden ni preferencias. Cada problema va en una línea: qué está mal y dónde, sin reescribir la respuesta. Si no hay defectos, «pass» con la lista vacía.',
].join('\n');

/**
 * A review hook for runAgent: first the plain checks, then (if all pass) the model's reading. `evidence` writes what the run found, in the
 * words the reviewer needs; `request` is what the person asked.
 */
export function reviewHook<T = unknown>(options: {
  model: ModelClient;
  request: () => string;
  evidence: (info: ReviewInfo) => string;
  render?: (output: T) => string;
  checks?: Array<Check<T>>;
  effort?: Effort;
  system?: string;
  /** Skips the model's reading (a run too short or too small for it to matter). */
  skipModel?: (info: ReviewInfo) => boolean;
  signal: AbortSignal;
  hooks?: AgentHooks;
}): NonNullable<AgentHooks['review']> {
  return async info => {
    for (const check of options.checks ?? []) {
      const problem = await check(info.output as T, info);
      if (problem) return problem;
    }
    if (options.skipModel?.(info)) return null;
    const answer = options.render ? options.render(info.output as T) : typeof info.output === 'string' ? info.output : JSON.stringify(info.output, null, 2);
    const { data } = await runStructured({
      model: options.model, system: options.system ?? REVIEWER_SYSTEM, schema: reviewSchema, effort: options.effort ?? 'low', signal: options.signal,
      limits: { maxRounds: 2, maxTokens: 1_500 },
      prompt: `LO QUE LA PERSONA PIDIÓ:\n${options.request()}\n\nLO QUE EL AGENTE AVERIGUÓ:\n${options.evidence(info) || '(nada: respondió sin consultar)'}\n\nRESPUESTA A REVISAR:\n${answer}`,
      hooks: options.hooks && { beforeModelCall: options.hooks.beforeModelCall, afterModelCall: options.hooks.afterModelCall },
    });
    return data.verdict === 'fix' && data.issues.length ? `Un revisor encontró esto:\n${data.issues.map(issue => `- ${issue}`).join('\n')}\nCorrige solo eso, sin cambiar lo que estaba bien.` : null;
  };
}

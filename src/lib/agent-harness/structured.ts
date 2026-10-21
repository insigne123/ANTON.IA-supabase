// A result with a schema, produced by an agent that can look things up first. The model finishes by calling `entregar` with the object;
// an object that does not fit comes back as the list of what is wrong and the model fixes it (the loop already does that for any tool),
// and a model that closes in prose instead of delivering is sent back once. It replaces «one call that must return valid JSON»: the model
// reads the expedient, checks a figure, and only then writes the result, and the answer is validated by the tool's own schema.
import { z } from 'zod';
import { runAgent, type AgentHooks, type AgentLimits, type CompactionOptions, type ReviewInfo } from './loop';
import { defineTool, ToolRegistry } from './tools';
import type { AgentEvent, AgentRun, AgentTool, ContentBlock, Effort, Message, ModelClient } from './types';

export const DELIVER = 'entregar';

export class AgentOutputError extends Error {
  constructor(message: string, readonly run: AgentRun) { super(message); this.name = 'AgentOutputError'; }
}

export type StructuredInput<S extends z.ZodTypeAny> = {
  model: ModelClient;
  system: string;
  /** What to do: text, or text with images and documents. */
  prompt: string | ContentBlock[];
  schema: S;
  /** What the model can look up before delivering. */
  tools?: AgentTool[];
  /** Extra checks the schema cannot say: return the problem, or null. */
  validate?: (data: z.infer<S>) => string | null | Promise<string | null>;
  limits?: Partial<AgentLimits>;
  effort?: Effort;
  signal: AbortSignal;
  hooks?: AgentHooks;
  /** A reviewer of the delivered object: return what is wrong with it and the model fixes it once. */
  review?: (data: z.infer<S>, info: ReviewInfo) => Promise<string | null>;
  onEvent?: (event: AgentEvent) => void;
  /** Makes room in a long run (see context.ts). */
  compaction?: CompactionOptions;
  description?: string;
  history?: Message[];
};

export async function runStructured<S extends z.ZodTypeAny>(input: StructuredInput<S>): Promise<{ data: z.infer<S>; run: AgentRun }> {
  const registry = new ToolRegistry(input.tools ?? []);
  registry.add(defineTool({
    name: DELIVER,
    description: input.description ?? 'Entrega el resultado final. Llámala una sola vez, con el objeto completo, cuando ya tengas todo lo que necesitas.',
    schema: input.schema,
    kind: 'meta',
    run: async data => {
      const problem = await input.validate?.(data);
      return problem ? { status: 'error', message: problem } : { status: 'final', output: data };
    },
  }));
  const hooks: AgentHooks = {
    ...input.hooks,
    review: async info => {
      if (info.via === 'end_turn') return `No entregaste el resultado. Llama a ${DELIVER} con el objeto completo; no lo escribas como texto.`;
      const own = input.review ? await input.review(info.output as z.infer<S>, info) : null;
      return own ?? (input.hooks?.review ? input.hooks.review(info) : null);
    },
  };
  const run = await runAgent({
    model: input.model, system: input.system, messages: [...(input.history ?? []), { role: 'user', content: input.prompt }], registry, finalTool: DELIVER,
    limits: { maxRounds: 6, maxTokens: 8_000, ...input.limits }, effort: input.effort, signal: input.signal, hooks, maxReviews: 2, onEvent: input.onEvent, compaction: input.compaction,
  });
  if (run.stopReason !== 'final_tool') throw new AgentOutputError(`The agent ended without delivering (${run.stopReason}).`, run);
  return { data: run.output as z.infer<S>, run };
}

// Sub-agents: a task handed to a fresh agent with its own conversation, its own tools and a smaller context, that comes back as one
// report. The parent never sees the sub-agent's reads, only what it found, so a research that reads twenty pages costs the parent a
// paragraph. Several can run at the same time (the tool is a `read`). A sub-agent cannot delegate again past `maxDepth`.
import { z } from 'zod';
import { runAgent, type AgentHooks, type AgentLimits } from './loop';
import { defineTool, ToolRegistry } from './tools';
import type { AgentEvent, AgentTool, Effort, ModelClient, ServerToolSpec, ToolContext, Usage } from './types';
import { addUsage, emptyUsage } from './types';

export type SubAgent = {
  /** What it is for, in the parent's words: the model picks by this line. */
  description: string;
  system: string;
  tools: AgentTool[];
  model?: ModelClient;
  effort?: Effort;
  limits?: Partial<AgentLimits>;
  /** The API's own tools for this agent (the web, for one that researches), given what its own run has spent of them. */
  serverTools?: (spent: Pick<Usage, 'webSearches' | 'webFetches'>) => ServerToolSpec[];
};

export const SUBAGENT_USAGE = 'subagents.usage';

export function delegateTool(options: {
  agents: Record<string, SubAgent>;
  /** The model of a sub-agent that does not choose its own. */
  model: ModelClient;
  /** Hooks of every delegate's run. A function builds them anew for each run, so delegates that go at the same time do not share state (a reservation). */
  hooks?: AgentHooks | (() => AgentHooks);
  maxDepth?: number;
  onEvent?: (event: AgentEvent) => void;
  limits?: AgentLimits;
  /** How many tasks the parent may hand out with this tool, which lives as long as its turn. Past that the tool says so and the parent does the rest. */
  maxCalls?: number;
}): AgentTool {
  let calls = 0;
  const names = Object.keys(options.agents) as [string, ...string[]];
  const maxDepth = options.maxDepth ?? 1;
  return defineTool({
    name: 'delegar',
    description: `Encarga una tarea a un agente especializado con su propio espacio de trabajo; vuelve un informe corto. Úsalo para investigar o revisar mucho material sin llenar tu contexto, o para hacer varias cosas a la vez (llámalo varias veces en el mismo turno).\n${names.map(name => `- ${name}: ${options.agents[name].description}`).join('\n')}`,
    schema: z.object({
      agente: z.enum(names),
      tarea: z.string().min(10).max(4_000).describe('Qué tiene que averiguar o hacer y cómo sabrás que terminó'),
      contexto: z.string().max(6_000).optional().describe('Lo que ya sabes y necesita: ids, restricciones, decisiones del usuario'),
    }),
    kind: 'read',
    run: async ({ agente, tarea, contexto }, context: ToolContext) => {
      if (context.depth >= maxDepth) return { status: 'error', message: 'Este agente ya es un delegado: hace la tarea él mismo, no delega.' };
      if (options.maxCalls !== undefined && ++calls > options.maxCalls) {
        return { status: 'error', message: `Ya delegaste ${options.maxCalls} tareas en este turno: haz el resto tú o responde con lo que tienes.` };
      }
      const agent = options.agents[agente];
      const registry = new ToolRegistry(agent.tools);
      const run = await runAgent({
        model: agent.model ?? options.model, system: agent.system,
        messages: [{ role: 'user', content: contexto ? `${tarea}\n\nContexto:\n${contexto}` : tarea }],
        registry, limits: { maxRounds: 6, maxTokens: 4_000, ...options.limits, ...agent.limits }, effort: agent.effort,
        ...(agent.serverTools ? { serverTools: agent.serverTools } : {}),
        signal: context.signal, hooks: typeof options.hooks === 'function' ? options.hooks() : options.hooks, onEvent: options.onEvent, depth: context.depth + 1,
      });
      const total = (context.state.get(SUBAGENT_USAGE) as Usage | undefined) ?? emptyUsage();
      context.state.set(SUBAGENT_USAGE, addUsage(total, run.usage));
      const report = run.text.trim();
      if (!report) return { status: 'error', message: `El agente ${agente} no devolvió un informe (${run.stopReason}). Intenta de nuevo con una tarea más acotada o hazlo tú.` };
      return { status: 'ok', output: { agent: agente, rounds: run.rounds, toolCalls: run.toolCalls }, text: report };
    },
  });
}

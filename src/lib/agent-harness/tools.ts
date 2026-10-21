// The tools of a run: how they are written, offered to the model, found when they are not loaded, and how what they return
// reaches the model (as text it can read, bounded so one huge result never eats the context). Pure: no SDK.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentTool, ToolContext, ToolKind, ToolOutcome, ToolSpec } from './types';

/** A result longer than this reaches the model cut, with a line that says so: the model asks again with a narrower query. */
export const TOOL_RESULT_LIMIT = 24_000;

/** Writes a tool; the schema is the only place its input is described. */
export function defineTool<S extends z.ZodTypeAny>(tool: {
  name: string; description: string; schema: S; kind: ToolKind; tags?: string[]; deferred?: boolean;
  run: (input: z.infer<S>, context: ToolContext) => Promise<ToolOutcome>;
}): AgentTool<z.infer<S>> {
  return tool as unknown as AgentTool<z.infer<S>>;
}

/** The JSON Schema of a tool's input: every `$ref` inlined, no `$schema`, and the constraints kept (the model reads them as guidance). */
export function inputSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type !== 'object') return { type: 'object', properties: { value: json }, required: ['value'] };
  return json;
}

export function toolSpec(tool: AgentTool): ToolSpec {
  return { name: tool.name, description: tool.description, inputSchema: inputSchemaOf(tool.schema) };
}

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The tools one run can use. Some are loaded from the start; a `deferred` one is found by the model with
 * `buscar_herramientas` (the catalog of Cowork has over a hundred reads: listing them all in every call is context the model
 * has to read around), and once found it stays loaded. Order is stable so the model's cache of the tool list lasts.
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();
  /** Names in the order they were loaded: a tool found late goes to the end, so the list the model's cache holds only grows. */
  private loaded = new Set<string>();

  constructor(tools: AgentTool[] = []) { for (const tool of tools) this.add(tool); }

  add(tool: AgentTool) {
    if (this.tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    if (!tool.deferred) this.loaded.add(tool.name);
    return this;
  }

  get(name: string): AgentTool | undefined { return this.tools.get(name); }
  all(): AgentTool[] { return [...this.tools.values()]; }
  isLoaded(name: string) { return this.loaded.has(name); }
  /** Tools the model can call now, in the order they were loaded. */
  active(): AgentTool[] { return [...this.loaded].map(name => this.tools.get(name)!); }
  deferredCount() { return this.all().filter(tool => !this.loaded.has(tool.name)).length; }

  /** Loads the named tools; returns the ones that were not loaded before. */
  load(names: string[]): string[] {
    const fresh: string[] = [];
    for (const name of names) {
      if (this.tools.has(name) && !this.loaded.has(name)) { this.loaded.add(name); fresh.push(name); }
    }
    return fresh;
  }

  /** The deferred tools that best match the words of a query, by name, tags and description. */
  search(query: string, limit = 8): AgentTool[] {
    const words = plain(query).split(/[^a-z0-9_.]+/).filter(word => word.length > 1);
    if (!words.length) return [];
    return this.all().filter(tool => !this.loaded.has(tool.name)).map(tool => {
      const name = plain(tool.name);
      const tags = plain((tool.tags || []).join(' '));
      const description = plain(tool.description);
      const score = words.reduce((sum, word) => sum + (name.includes(word) ? 4 : 0) + (tags.includes(word) ? 3 : 0) + (description.includes(word) ? 1 : 0), 0);
      return { tool, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, limit).map(item => item.tool);
  }
}

/** The meta tool that finds and loads deferred tools. Present only when the registry has some. */
export function searchToolsTool(registry: ToolRegistry): AgentTool {
  return defineTool({
    name: 'buscar_herramientas',
    description: 'Busca y carga herramientas que todavía no tienes a mano. Descríbelas con las palabras de lo que necesitas (por ejemplo «campañas métricas rebotes»). Devuelve su nombre y para qué sirven; quedan disponibles para llamarlas enseguida.',
    schema: z.object({ query: z.string().min(2).max(200) }),
    kind: 'meta',
    run: async ({ query }) => {
      const found = registry.search(query);
      if (!found.length) return { status: 'ok', output: { loaded: [] }, text: `Ninguna herramienta pendiente calza con «${query}». Prueba con otras palabras, o responde con lo que tienes.` };
      registry.load(found.map(tool => tool.name));
      return { status: 'ok', output: { loaded: found.map(tool => tool.name) },
        text: `Herramientas cargadas, ya puedes llamarlas:\n${found.map(tool => `- ${tool.name}: ${tool.description.split('\n')[0].slice(0, 200)}`).join('\n')}` };
    },
  });
}

/** What a result looks like to the model: its text if the tool wrote one, else its JSON; cut when it is too long. */
export function renderToolOutput(outcome: ToolOutcome, limit = TOOL_RESULT_LIMIT): string {
  if (outcome.status === 'error') return outcome.message;
  const text = outcome.text ?? (typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output ?? null));
  if (text.length <= limit) return text;
  const kept = text.slice(0, limit);
  return `${kept}\n… [resultado recortado: ${text.length - limit} caracteres más. Pide una consulta más acotada si necesitas el resto.]`;
}

/** A line about a result, for the trace: never the data itself. */
export function summarizeOutcome(outcome: ToolOutcome): string {
  if (outcome.status === 'error') return outcome.message.slice(0, 160);
  const text = outcome.text ?? (typeof outcome.output === 'string' ? outcome.output : JSON.stringify(outcome.output ?? null));
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** The problems of an input that did not fit a tool's schema, in a few lines the model can fix. */
export function inputProblems(error: z.ZodError): string {
  return error.issues.slice(0, 6).map(issue => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`).join('\n');
}

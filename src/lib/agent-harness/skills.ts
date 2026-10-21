// Skills: know-how the agent loads when the task calls for it instead of carrying it in every call. A skill is a name, a line that says
// when it applies, and a body (the recipe: steps, examples, what to check) plus the deferred tools it brings. The system prompt only lists
// the names; `cargar_guia` hands the body over. It is the answer to a prompt that grew to hold every rule of every case: the rules of
// writing a campaign are read when a campaign is written. Pure.
import { z } from 'zod';
import { defineTool } from './tools';
import type { AgentTool } from './types';
import type { ToolRegistry } from './tools';

export type Skill = {
  name: string;
  /** One line: what it is for and when to load it. */
  description: string;
  body: string;
  /** Deferred tools to load together with it. */
  tools?: string[];
};

export const LOADED_SKILLS = 'skills.loaded';

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  constructor(skills: Skill[] = []) { for (const skill of skills) this.add(skill); }

  add(skill: Skill) {
    if (this.skills.has(skill.name)) throw new Error(`Duplicate skill: ${skill.name}`);
    this.skills.set(skill.name, skill);
    return this;
  }
  get(name: string) { return this.skills.get(name); }
  names() { return [...this.skills.keys()]; }

  /** The lines of the system prompt that tell the model which guides exist. */
  index(): string {
    if (!this.skills.size) return '';
    return ['Guías disponibles (cárgalas con cargar_guia cuando el pedido las necesite; no las cargues si no aplican):',
      ...[...this.skills.values()].map(skill => `- ${skill.name}: ${skill.description}`)].join('\n');
  }

  /** The tool that hands a guide over. A guide loads once per run; asking again says so instead of repeating it. */
  tool(registry?: ToolRegistry): AgentTool {
    const names = this.names();
    return defineTool({
      name: 'cargar_guia',
      description: `Carga una guía de trabajo con las reglas y los pasos de un tipo de pedido. Guías: ${names.join(', ')}.`,
      schema: z.object({ nombre: z.string().min(1).max(80) }),
      kind: 'meta',
      run: async ({ nombre }, context) => {
        const skill = this.skills.get(nombre);
        if (!skill) return { status: 'error', message: `No existe la guía «${nombre}». Disponibles: ${names.join(', ')}.` };
        const loaded = (context.state.get(LOADED_SKILLS) as Set<string> | undefined) ?? new Set<string>();
        context.state.set(LOADED_SKILLS, loaded);
        if (loaded.has(skill.name)) return { status: 'ok', output: null, text: `La guía «${skill.name}» ya está cargada arriba: sigue sus pasos.` };
        loaded.add(skill.name);
        const brought = registry && skill.tools?.length ? registry.load(skill.tools) : [];
        return { status: 'ok', output: { name: skill.name }, text: `${skill.body}${brought.length ? `\n\nHerramientas cargadas con esta guía: ${brought.join(', ')}.` : ''}` };
      },
    });
  }
}

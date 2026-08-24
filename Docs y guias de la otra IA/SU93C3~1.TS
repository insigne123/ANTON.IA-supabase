/* =====================================================================
   suplia-skill-registry.ts — Fase 4: registro de skills extensible
   Hace a SUPL.IA extensible como Cowork: agregas una fila en `suplia_skills`
   y SUPL.IA gana una capacidad SIN redeploy.

   Tipos de skill:
   - 'prompt' : inyecta conocimiento/instrucciones (estilo OpenClaudia) cuando aplica.
   - 'tool'   : ata triggers a una tool existente (config.tool = 'research.similarweb', ...).
   - 'agent'  : ata triggers a un subagente (config.agent = 'icp-strategist', ...).

   Migración (ver FASE-4-SUPLIA-GLM.md) crea la tabla `suplia_skills`.
   Va en: src/lib/server/suplia-skill-registry.ts
   ===================================================================== */
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type SupliaSkillKind = 'prompt' | 'tool' | 'agent';

export type SupliaSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  kind: SupliaSkillKind;
  config: Record<string, unknown> | null; // { instructions?, tool?, agent? }
  enabled: boolean;
};

function normalize(text: string): string {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Lee las skills habilitadas de la organización (cacheable en la capa que llama). */
export async function listEnabledSkills(auth: AuthContext): Promise<SupliaSkill[]> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('suplia_skills')
    .select('id, slug, name, description, triggers, kind, config, enabled')
    .eq('organization_id', auth.organizationId)
    .eq('enabled', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as SupliaSkill[];
}

/** Devuelve las skills cuyos triggers aparecen en el mensaje (match por substring normalizado). */
export function matchSkillsForMessage(message: string, skills: SupliaSkill[]): SupliaSkill[] {
  const text = normalize(message);
  if (!text) return [];
  return skills.filter((s) => (s.triggers || []).some((t) => {
    const trig = normalize(t);
    return trig.length > 0 && text.includes(trig);
  }));
}

/** Bloque compacto para inyectar en el prompt del brain: SUPL.IA sabe qué skills tiene. */
export function formatSkillsForPrompt(skills: SupliaSkill[]): string {
  if (!skills.length) return '';
  const lines = skills.map((s) => `- ${s.name} (${s.kind}): ${s.description}${s.kind === 'tool' && s.config?.tool ? ` [tool: ${s.config.tool}]` : ''}${s.kind === 'agent' && s.config?.agent ? ` [agente: ${s.config.agent}]` : ''}`);
  return `Skills disponibles (usa la que corresponda al pedido):\n${lines.join('\n')}`;
}

/** Para skills 'prompt' activadas por el mensaje: junta sus instrucciones/conocimiento. */
export function collectPromptSkillInstructions(matched: SupliaSkill[]): string {
  const blocks = matched
    .filter((s) => s.kind === 'prompt' && s.config && typeof (s.config as any).instructions === 'string')
    .map((s) => `# Skill: ${s.name}\n${String((s.config as any).instructions)}`);
  return blocks.join('\n\n');
}

/**
 * Helper de alto nivel para el orchestrator/brain:
 * devuelve el texto a inyectar en el prompt (catálogo + instrucciones activadas)
 * y las tools/agentes sugeridos por las skills que matchean el mensaje.
 */
export async function resolveSkillsForTurn(auth: AuthContext, message: string): Promise<{
  catalog: string;
  activatedInstructions: string;
  suggestedTools: string[];
  suggestedAgents: string[];
}> {
  let skills: SupliaSkill[] = [];
  try { skills = await listEnabledSkills(auth); } catch { skills = []; }
  const matched = matchSkillsForMessage(message, skills);
  return {
    catalog: formatSkillsForPrompt(skills),
    activatedInstructions: collectPromptSkillInstructions(matched),
    suggestedTools: matched.filter((s) => s.kind === 'tool' && s.config?.tool).map((s) => String(s.config!.tool)),
    suggestedAgents: matched.filter((s) => s.kind === 'agent' && s.config?.agent).map((s) => String(s.config!.agent)),
  };
}

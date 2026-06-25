import { z } from 'genkit';

import { getOpenAiModelsForTier } from '@/ai/model-router';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { buildOpenAiTelemetry } from '@/lib/server/suplia-observability';
import type { SupliaAppContext } from '@/lib/server/suplia-context';

const WorkflowPlanSchema = z.object({
  title: z.string().default('Plan de trabajo'),
  summary: z.string(),
  clarificationNotes: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(z.object({
    title: z.string(),
    description: z.string(),
    agentName: z.string().default('planner'),
    requiresApproval: z.boolean().default(false),
  })).default([]),
  risks: z.array(z.string()).default([]),
  approvalQuestion: z.string().default('¿Apruebas este plan para continuar?'),
});

export type SupliaWorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

function fallbackWorkflowPlan(goal: string): SupliaWorkflowPlan {
  return {
    title: 'Plan para buscar leads',
    summary: 'Voy a convertir tu objetivo en un flujo seguro: primero ICP, luego busqueda aprobable y despues priorizacion de resultados.',
    clarificationNotes: [],
    assumptions: ['Usare el perfil de empresa disponible si falta algun dato especifico.', 'No consumire creditos externos sin una aprobacion separada.'],
    steps: [
      { title: 'Definir ICP', description: 'Aterrizar segmento, mercado, roles y senales de compra.', agentName: 'icp-strategist', requiresApproval: false },
      { title: 'Preparar busqueda externa', description: 'Convertir el ICP en una busqueda Apollo/PDL revisable.', agentName: 'prospector', requiresApproval: true },
      { title: 'Priorizar resultados', description: 'Ordenar empresas y contactos por fit antes de cualquier accion comercial.', agentName: 'company-scorer', requiresApproval: false },
    ],
    risks: ['La busqueda externa puede consumir creditos y requiere aprobacion.', 'Si el ICP queda amplio, los primeros resultados deben revisarse antes de escalar.'],
    approvalQuestion: '¿Apruebas este plan para continuar con ICP y criterios de busqueda?',
  };
}

export function formatSupliaWorkflowPlan(plan: SupliaWorkflowPlan) {
  const steps = plan.steps.length > 0
    ? plan.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.description}${step.requiresApproval ? ' (requiere aprobacion)' : ''}`).join('\n')
    : '1. Definir ICP\n2. Preparar busqueda aprobable\n3. Priorizar resultados';
  const assumptions = plan.assumptions.length
    ? plan.assumptions.map((item) => `- ${item}`).join('\n')
    : '- No hay supuestos adicionales. Si falta informacion, SUPL.IA debe pedirla antes de consumir creditos.';
  const risks = plan.risks.length
    ? plan.risks.map((item) => `- ${item}`).join('\n')
    : '- Cualquier busqueda externa o envio requiere aprobacion separada.';
  return [
    `Resumen:\n${plan.summary}`,
    `Pasos:\n${steps}`,
    `Supuestos a validar:\n${assumptions}`,
    `Riesgos y guardrails:\n${risks}`,
    `Siguiente decision:\n${plan.approvalQuestion}`,
  ].join('\n\n');
}

export async function generateSupliaWorkflowPlan(input: { goal: string; context: SupliaAppContext }) {
  const prompt = `
Eres SUPL.IA planificando una tarea operativa antes de ejecutar agentes o herramientas.

Objetivo del usuario:
${input.goal}

Contexto de app disponible:
${JSON.stringify(input.context).slice(0, 5000)}

Instrucciones:
- Crea un plan breve, concreto y aprobable.
- Si faltan datos, usa supuestos explicitos basados en contexto guardado; no inventes hechos no disponibles.
- No ejecutes herramientas ni prometas resultados.
- Marca claramente que Apollo/PDL, Gmail, enriquecimiento o envios requieren aprobacion separada.
- Devuelve JSON estricto.
`;

  try {
    const generated = await generateStructuredWithTelemetry({
      prompt,
      schema: WorkflowPlanSchema,
      temperature: 0.18,
      openAiModels: getOpenAiModelsForTier('orchestrator'),
    });
    return {
      plan: generated.data,
      telemetry: buildOpenAiTelemetry({
        modelTier: 'orchestrator',
        modelName: generated.telemetry.modelName,
        usage: generated.telemetry.usage,
        durationMs: generated.telemetry.durationMs,
      }),
    };
  } catch (error) {
    console.warn('[SUPLIA/workflow plan] fallback:', error);
    return { plan: fallbackWorkflowPlan(input.goal), telemetry: null };
  }
}

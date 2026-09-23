import { coworkAgentInstructions } from './agent-instructions';

/** Shared by the worker and AXIS replay. Time comes from the server, not the model. */
export function coworkDecisionContext(
  instructions: ReturnType<typeof coworkAgentInstructions>,
  input: { history: unknown; request: string; observations: unknown[]; mustAnswer: boolean; executionPolicy: unknown },
  now = new Date(),
) {
  const observedLeadIds = new Set<string>();
  for (const observation of input.observations) {
    const result = (observation as { result?: { items?: Array<{ lead_id?: string }> } } | null)?.result;
    for (const item of result?.items || []) {
      if (typeof item.lead_id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.lead_id)) observedLeadIds.add(item.lead_id);
    }
  }
  return {
    ...input,
    contactReadGuidance: {
      observedLeadIds: [...observedLeadIds],
      instruction: input.observations.length === 0
        ? 'Si necesitas descubrir contactos: action contacted.search, query "", leadId null, reads null, plan null. Espera su resultado antes de construir consultas por UUID. Nunca uses referencias, placeholders ni IDs de tareas como UUID.'
        : 'Para cronología usa lead_id observado (no id del registro de envío). Si falta cobertura y el usuario pide su correo, gmail.contact_history permite contrastar metadatos de su Gmail; no sincroniza toda la empresa. No repitas la misma fuente para inventar cobertura.',
    },
    readBudget: {
      maximum: 3,
      remaining: Math.max(0, 3 - input.observations.reduce<number>((used, item) => {
        const action = (item as { action?: string } | null)?.action;
        return used + (action === 'specialists.review' ? 0 : action === 'privacy.contactability_batch' || action === 'lists.review_batch' ? 3 : 1);
      }, 0)),
      instruction: 'No repitas una consulta ya observada en esta ejecución. Si la cobertura es desconocida, volver a leer la misma fuente no la completa: responde con la limitación y el próximo paso disponible.',
    },
    clock: { serverNow: now.toISOString(), timezone: 'UTC', source: 'server' },
    parallelReadCapability: instructions.parallelReadCapability,
    researchCapability: instructions.researchCapability,
    externalSearchCapability: instructions.externalSearchCapability,
    extendedReadCapability: instructions.extendedReadCapability,
    replyDetectionCapability: instructions.replyDetectionCapability,
    metricsCapability: instructions.metricsCapability,
    additionalCapability: instructions.additionalCapability,
    effectCapability: instructions.effectCapability,
    threadBudgetCapability: instructions.threadBudgetCapability,
  };
}

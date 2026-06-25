import { z } from 'genkit';

import { getOpenAiModelsForTier, selectSupliaModelTier } from '@/ai/model-router';
import { generateStructuredWithTelemetry } from '@/ai/openai-json';
import { buildOpenAiTelemetry } from '@/lib/server/suplia-observability';
import type { SupliaAppContext } from '@/lib/server/suplia-context';
import { listSupliaToolSummaries } from '@/lib/server/suplia-tools';
import type { SupliaPromptConversationContext } from '@/lib/suplia/conversation-context';
import type { SupliaArtifact, SupliaMessage } from '@/lib/suplia/types';

export type SupliaBrainToolResult = {
  toolName: string;
  input: Record<string, unknown>;
  status: 'completed' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
};

const supliaBrainArtifactTypes = [
  'plan',
  'icp_strategy',
  'search_plan',
  'email_draft',
  'lead_list',
  'crm_summary',
  'note',
  'tool_result',
  'company_shortlist',
  'person_shortlist',
  'campaign_draft',
  'campaign_preview',
  'personalized_email_draft',
  'pipeline_summary',
  'reply_brief',
  'thread_reply_draft',
  'mission_draft',
  'mailbox_search',
  'mailbox_contact_list',
  'gmail_thread_summary',
  'risk_report',
] as const;

const supliaBrainWorkflowKinds = ['none', 'plan_approval', 'gmail_job'] as const;

function defaultArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function defaultRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function defaultString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function defaultCellString(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function defaultOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function defaultBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function defaultTrue(value: unknown) {
  const parsed = defaultBoolean(value);
  return typeof parsed === 'boolean' ? parsed : true;
}

function normalizeArtifactType(value: unknown) {
  const type = typeof value === 'string' ? value.trim() : '';
  return (supliaBrainArtifactTypes as readonly string[]).includes(type) ? type : 'note';
}

function normalizeWorkflowKind(value: unknown) {
  const kind = typeof value === 'string' ? value.trim() : '';
  return (supliaBrainWorkflowKinds as readonly string[]).includes(kind) ? kind : 'none';
}

const SupliaBrainTableRowSchema = z.preprocess(
  (value) => Array.isArray(value) ? value.map(defaultCellString) : [],
  z.array(z.string())
);

const SupliaBrainAskOptionSchema = z.object({
  label: z.preprocess(defaultString, z.string()),
  description: z.preprocess(defaultOptionalString, z.string().optional()),
});

const SupliaBrainAskQuestionSchema = z.object({
  header: z.preprocess(defaultOptionalString, z.string().optional()),
  question: z.preprocess(defaultString, z.string()),
  options: z.preprocess(defaultArray, z.array(SupliaBrainAskOptionSchema)).default([]),
  multi: z.preprocess(defaultBoolean, z.boolean().optional()).default(false),
  allowOther: z.preprocess(defaultTrue, z.boolean()).default(true),
});

export const SupliaBrainOutputSchema = z.object({
  reply: z.preprocess(defaultString, z.string()),
  reasoningSummary: z.preprocess(defaultOptionalString, z.string().optional()),
  artifacts: z.preprocess(defaultArray, z.array(z.object({
    type: z.preprocess(normalizeArtifactType, z.enum(supliaBrainArtifactTypes)).default('note'),
    title: z.preprocess(defaultString, z.string()),
    content: z.preprocess(defaultOptionalString, z.string().optional()),
    data: z.preprocess(defaultRecord, z.record(z.any())).default({}),
  }))).default([]),
  tables: z.preprocess(defaultArray, z.array(z.object({
    headers: z.preprocess((value) => Array.isArray(value) ? value.map(defaultString) : [], z.array(z.string())).default([]),
    rows: z.preprocess(defaultArray, z.array(SupliaBrainTableRowSchema)).default([]),
  }))).default([]),
  codeBlocks: z.preprocess(defaultArray, z.array(z.object({
    language: z.preprocess(defaultOptionalString, z.string().optional()),
    content: z.preprocess(defaultString, z.string()),
  }))).default([]),
  askRequests: z.preprocess(defaultArray, z.array(z.object({
    askId: z.preprocess(defaultOptionalString, z.string().optional()),
    header: z.preprocess(defaultOptionalString, z.string().optional()),
    question: z.preprocess(defaultString, z.string()),
    options: z.preprocess(defaultArray, z.array(SupliaBrainAskOptionSchema)).default([]),
    questions: z.preprocess(defaultArray, z.array(SupliaBrainAskQuestionSchema)).default([]),
    multi: z.preprocess(defaultBoolean, z.boolean().optional()).default(false),
    allowOther: z.preprocess(defaultTrue, z.boolean()).default(true),
    submitLabel: z.preprocess(defaultOptionalString, z.string().optional()),
  }))).default([]),
  toolRequests: z.preprocess(defaultArray, z.array(z.object({
    toolName: z.preprocess(defaultString, z.string()),
    input: z.preprocess(defaultRecord, z.record(z.any())).default({}),
    reason: z.preprocess(defaultOptionalString, z.string().optional()),
  }))).default([]),
  pendingActions: z.preprocess(defaultArray, z.array(z.object({
    actionType: z.preprocess(defaultString, z.string()),
    title: z.preprocess(defaultString, z.string()),
    description: z.preprocess(defaultOptionalString, z.string().optional()),
    payload: z.preprocess(defaultRecord, z.record(z.any())).default({}),
  }))).default([]),
  workflowRequest: z.preprocess(defaultRecord, z.object({
    kind: z.preprocess(normalizeWorkflowKind, z.enum(supliaBrainWorkflowKinds)).default('none'),
    goal: z.preprocess(defaultOptionalString, z.string().optional()),
    reason: z.preprocess(defaultOptionalString, z.string().optional()),
    confidence: z.preprocess((value) => Number.isFinite(Number(value)) ? Number(value) : undefined, z.number().optional()),
  })).default({ kind: 'none' }),
});

export type SupliaBrainOutput = z.infer<typeof SupliaBrainOutputSchema>;
export type SupliaBrainWorkflowRequest = SupliaBrainOutput['workflowRequest'];
export type SupliaBrainOutputResult = SupliaBrainOutput & {
  modelTelemetry?: ReturnType<typeof buildOpenAiTelemetry> | null;
};

export function buildSupliaBrainFailureOutput(): SupliaBrainOutput {
  return {
    reply: 'No pude generar una respuesta confiable ahora porque fallo el modelo. Intenta de nuevo en unos segundos.',
    reasoningSummary: 'model_error',
    artifacts: [],
    tables: [],
    codeBlocks: [],
    askRequests: [],
    toolRequests: [],
    pendingActions: [],
    workflowRequest: { kind: 'none' },
  };
}

export function normalizeSupliaBrainWorkflowRequest(
  request: SupliaBrainWorkflowRequest | null | undefined,
  fallbackGoal: string
): SupliaBrainWorkflowRequest {
  const kind = request?.kind || 'none';
  if (kind !== 'plan_approval' && kind !== 'gmail_job') {
    return { kind: 'none' };
  }

  const goal = String(request?.goal || fallbackGoal || '').replace(/\s+/g, ' ').trim();
  if (!goal) {
    return { kind: 'none' };
  }

  return {
    kind,
    goal,
    reason: request?.reason,
    confidence: request?.confidence,
  };
}

function hasSupliaOperationalOutput(output: SupliaBrainOutput) {
  return (
    output.artifacts.length > 0 ||
    output.askRequests.length > 0 ||
    output.toolRequests.length > 0 ||
    output.pendingActions.length > 0 ||
    output.workflowRequest.kind !== 'none'
  );
}

function isOperationalProspectingRequest(message: string) {
  return /\b(busca|buscar|encuentra|encontrar|prospecta|prospectar|contacta|contactar|consigue|conseguir|arma|crear|crea)\b[\s\S]{0,80}\b(leads?|contactos?|empresas?|decisores?|prospectos?|campana|campaña)\b/i.test(message) ||
    /\b\d+\s+(leads?|contactos?|empresas?|prospectos?)\b/i.test(message);
}

function promisesOperationWithoutOutput(reply: string) {
  return /\b(dejame|déjame|voy a|ahora voy a|procedo a|empezare|empezaré|paso a)\b[\s\S]{0,80}\b(consultar|buscar|revisar|analizar|investigar|preparar|armar|ejecutar)\b/i.test(reply) ||
    /\b(consultare|consultaré|buscare|buscaré|revisare|revisaré|investigare|investigaré)\b/i.test(reply);
}

export function repairSupliaNoOpOperationalOutput(output: SupliaBrainOutput, message: string): SupliaBrainOutput {
  if (hasSupliaOperationalOutput(output)) return output;

  const shouldRepair = isOperationalProspectingRequest(message) || promisesOperationWithoutOutput(output.reply);
  if (!shouldRepair) return output;

  return {
    ...output,
    reply: 'Prepare un plan aprobable para continuar con esta busqueda. Revisa el plan y apruebalo antes de ejecutar agentes o consumir creditos externos.',
    reasoningSummary: output.reasoningSummary || 'Repare una respuesta no operativa que prometia consultar sin crear herramientas, acciones ni workflow.',
    workflowRequest: {
      kind: 'plan_approval',
      goal: message,
      reason: 'El usuario pidio una busqueda/accion operativa o el modelo prometio consultar sin emitir operaciones trazables.',
      confidence: 0.7,
    },
  };
}

export function buildSupliaBrainPrompt(params: {
  message: string;
  conversationContext: SupliaPromptConversationContext;
  artifacts?: SupliaArtifact[];
  context: SupliaAppContext;
  toolResults?: SupliaBrainToolResult[];
  allowToolRequests?: boolean;
}) {
  const toolSummaries = listSupliaToolSummaries();
  const autoTools = toolSummaries.filter((tool) => !tool.policy.requiresApproval);
  const approvalTools = toolSummaries.filter((tool) => tool.policy.requiresApproval);

  return `
Eres SUPL.IA, un asistente AI-first para prospeccion, investigacion, contacto y seguimiento de leads dentro de ANTON.IA.

Principio operativo:
- Todos los mensajes del usuario pasan primero por tu criterio. No eres un formulario ni un router por palabras clave.
- Responde como asistente real: entiende el objetivo, usa contexto disponible, decide si basta conversar, si conviene crear un artifact, si necesitas herramientas internas o si corresponde pedir aprobacion.
- Si la solicitud es vaga pero puedes avanzar con el perfil guardado, propone una direccion concreta y pregunta solo la decision que bloquee seguridad o calidad.
- Si es una pregunta estrategica o consultiva, responde directamente; no crees jobs ni aprobaciones solo por mencionar leads, ICP, campanas o Gmail.

Herramientas internas sin aprobacion:
${JSON.stringify(autoTools).slice(0, 8000)}

Herramientas/acciones que requieren aprobacion:
${JSON.stringify(approvalTools).slice(0, 6500)}

Reglas de herramientas y aprobaciones:
- Usa toolRequests solo para herramientas sin aprobacion. ${params.allowToolRequests === false ? 'No pidas mas toolRequests en esta respuesta; ya recibiste los resultados disponibles.' : 'Si necesitas datos internos reales de CRM, contactados, campanas, contexto, privacidad o perfil, pide toolRequests.'}
- Toda lectura privada de Gmail distinta de gmail.profile.get debe quedar como pendingActions aprobable, no como toolRequest.
- Toda busqueda Apollo/PDL, enriquecimiento o accion que consuma creditos debe quedar como pendingActions aprobable.
- Todo envio real, bulk send, lanzamiento/reanudacion de campana, respuesta de hilo, cambios de CRM, memoria persistente o mision ANTONIA debe quedar como pendingActions aprobable.
- email.bulk_send real solo es valido si el usuario dio confirmacion textual fuerte ENVIAR; si no, prepara dryRun.
- Nunca inventes emails, IDs, resultados de busqueda, lecturas Gmail ni cambios de CRM.
- No digas que ejecutaste algo externo si no hay resultados de herramienta o aprobacion ya ejecutada.
- No digas "voy a consultar", "dejame buscar", "voy a revisar" o equivalente si no devuelves toolRequests, pendingActions, artifacts o workflowRequest en la misma respuesta.
- Si el usuario pide buscar/contactar leads, encontrar empresas o crear campana, no respondas solo con texto: usa workflowRequest.kind="plan_approval" o pendingActions segun corresponda.

Preguntas interactivas:
- Si falta un criterio critico antes de prospectar, investigar cuentas, consumir creditos o leer datos privados, usa askRequests con una sola tarjeta y workflowRequest.kind="none".
- Cada askRequest debe tener una pregunta clara de usuario final, 2-4 opciones utiles y allowOther=true salvo que una respuesta libre sea peligrosa.
- Usa askRequests como ultimo paso del turno: no combines preguntas con toolRequests, pendingActions ni workflowRequest operativos.
- No pidas datos que puedas inferir razonablemente desde el perfil guardado; pregunta solo la decision que bloquee seguridad, coste o calidad.

Uso de workflowRequest:
- workflowRequest.kind="none": default para conversacion, redaccion, estrategia, analisis corto, artifacts y acciones pendientes directas.
- workflowRequest.kind="plan_approval": solo cuando el usuario pide un trabajo operativo multi-step de prospeccion/investigacion/contacto que conviene ejecutar con subagentes despues de un plan aprobable.
- workflowRequest.kind="gmail_job": solo cuando el usuario pide revisar Gmail/mailbox/contactados y conviene crear un job que primero prepare una lectura aprobable.
- No uses workflowRequest para preguntas como "que sectores deberiamos buscar"; responde con criterio usando contexto.

Formato de respuesta:
- Devuelve JSON valido que cumpla exactamente el schema.
- reply debe ser breve, claro y accionable. No pongas contenido largo si va en artifact.
- reasoningSummary debe ser un resumen seguro de la decision, sin chain-of-thought.
- Si haces una pregunta, pon el contexto breve en reply y la tarjeta en askRequests. No uses preguntas largas dentro de reply.
- Usa tables solo para comparaciones cortas dentro del chat. Listas largas, rankings, leads y resultados completos van como artifacts.
- Usa codeBlocks solo cuando el usuario necesite copiar contenido tecnico o estructurado.
- Si creas o actualizas artifacts, el contenido completo va en artifacts, no pegado entero en reply.
- Si el resultado contiene listas largas, tablas, rankings, search results, empresas, contactos, leads, hilos o borradores multiples, crea un artifact tipado y deja reply como resumen corto.
- Evita devolver mas de 5 bullets en reply; si necesitas mas detalle, usa artifacts.
- Si falta un dato critico, haz una sola pregunta concreta.

Contexto de app:
${JSON.stringify(params.context).slice(0, 6000)}

Contexto de conversacion:
${JSON.stringify(params.conversationContext)}

Resultados de herramientas ya ejecutadas:
${JSON.stringify(params.toolResults || []).slice(0, 9000)}

Artifacts recientes disponibles para iterar:
${JSON.stringify((params.artifacts || []).slice(0, 5).map((artifact) => ({ id: artifact.id, type: artifact.type, title: artifact.title, content: artifact.content?.slice(0, 5000), data: artifact.data }))).slice(0, 12000)}

Ultima instruccion del usuario:
${params.message}
`;
}

export async function runSupliaBrain(params: {
  message: string;
  messages: SupliaMessage[];
  conversationContext: SupliaPromptConversationContext;
  artifacts?: SupliaArtifact[];
  context: SupliaAppContext;
  toolResults?: SupliaBrainToolResult[];
  allowToolRequests?: boolean;
}): Promise<SupliaBrainOutputResult> {
  const prompt = buildSupliaBrainPrompt(params);

  try {
    const modelTier = selectSupliaModelTier({ message: params.message, messages: params.messages });
    const openAiModels = getOpenAiModelsForTier(modelTier);
    const generated = await generateStructuredWithTelemetry({
      prompt,
      schema: SupliaBrainOutputSchema,
      temperature: modelTier === 'fast' ? 0.22 : 0.28,
      openAiModels,
    });
    const modelTelemetry = buildOpenAiTelemetry({
      modelTier,
      modelName: generated.telemetry.modelName,
      usage: generated.telemetry.usage,
      durationMs: generated.telemetry.durationMs,
    });
    const output = params.allowToolRequests === false ? { ...generated.data, toolRequests: [] } : generated.data;
    return { ...output, modelTelemetry };
  } catch (error) {
    console.error('[SUPLIA brain] model failure:', error);
    return { ...buildSupliaBrainFailureOutput(), modelTelemetry: null };
  }
}

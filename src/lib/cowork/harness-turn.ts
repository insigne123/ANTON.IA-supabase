// A turn of Cowork on the agent harness. The coordinator is a Claude that works with tools instead of writing one JSON decision per
// call: each read of the gateway is a tool (several asked at once run together), a proposal is a tool whose staging is the very check
// the coordinator loop has always applied (coworkStageDecision), the Writer, the Analyst and the Designer are tools, the plan is a tool,
// and the turn ends with `responder` or with a proposal that waits for the person's approval. The judge reads the answer before it
// is delivered and can send it back once. What the product decides stays where it was: authorization before every call and read,
// the ledger before every model call, approvals for every effect, the same answer polish on the way out.
import { z } from 'zod';
import { defineTool, planTool, runAgent, ToolRegistry, type AgentHooks, type AgentTool, type ModelResponse, type ToolOutcome } from '@/lib/agent-harness/index';
import { COWORK_PLAN_ACTION, COWORK_PLAN_LIMITS, COWORK_WRITTEN_ACTION, coworkDocumentSchema } from './contracts';
import { coworkBlocks } from './answer-quality';
import { coworkCampaignEmails, coworkPersonalEmails } from './blocks';
import {
  coworkAcceptsCampaignOffer, coworkDecisionSchema, coworkFinishAnswer, coworkStageDecision, coworkWriterObservations, FREE_READS, runCoworkReadLoop,
  type CoworkAnswer, type CoworkLoopInput, type CoworkObservation, type CoworkReadAction,
} from './agent-loop';
import { coworkAnalysisBriefSchema } from './analyst';
import { coworkCorrectionVerdict } from './correction-guard';
import { coworkDesignBriefSchema } from './design-brief';
import type { CoworkHarnessCapability, CoworkHarnessConfig } from './harness-config';
import { coworkThreadMemorySchema } from './thread-memory';
import { coworkWithDemoNote, coworkWriteBriefSchema } from './writer';
import { withCoworkReports } from './report-document';

/** What the model reads first: how the instructions that follow map to this turn's tools. They were written for a coordinator that answered
 * with a JSON decision, and its rules still hold; only the way of acting changes. */
export const COWORK_HARNESS_PROTOCOL = [
  'PROTOCOLO DE ESTE TURNO (manda sobre cualquier mención de «decisión», de JSON o del campo action en las instrucciones que siguen):',
  '- No respondes con un objeto de decisión: trabajas con herramientas y el turno termina cuando entregas la respuesta o dejas una propuesta para aprobación.',
  '- Cada consulta de las instrucciones (leads.search, metrics.rates, campaigns.list…) es una herramienta con el mismo nombre y guion bajo en vez de punto (leads_search, metrics_rates, campaigns_list). Lo que las instrucciones llaman query es su campo consulta; leadId, draftId, campaignId o stepId es su campo id. Pide en una misma ronda todas las consultas que no dependen unas de otras: corren juntas.',
  '- Lo que las instrucciones llaman reads.parallel o reads.plan es eso: varias herramientas en la misma ronda. outline es actualizar_plan.',
  '- draft.write es la herramienta redactar; analysis.write es analizar; artifact.create es disenar (solo si existe).',
  '- Lo que cambia algo, gasta créditos o busca personas nuevas se propone con la herramienta proponer_* de su tipo, con el mismo action de las instrucciones (leads.save_contact, campaign.create, prospecting.propose_search…) y sus mismos campos, más explicacion (lo que las instrucciones llaman answer.reply de una propuesta: 1 a 3 frases). Si devuelve un problema, corrígelo y vuelve a llamarla; nada se ejecuta sin la aprobación de la persona.',
  '- Entregas la respuesta con responder: sus campos son los de answer en las instrucciones (reply, document, question, suggestions, blocks, choices, reports) y, en la respuesta final, memoria. Después de responder o de proponer no llames nada más.',
  '- Un resultado con error dice qué corregir: no lo repitas igual. Si una consulta ya se hizo en este turno, el resultado vuelve de memoria sin gastar presupuesto.',
].join('\n');

/** The tool name of a gateway action: the API admits letters, digits, underscores and hyphens. */
export const coworkToolName = (action: string) => action.replace(/\./g, '_');

const SAMPLE_ID = '11111111-1111-4111-8111-111111111111';
type ReadShape = 'none' | 'id' | 'text' | 'leadIds';

export function coworkReadShape(capability: CoworkHarnessCapability): ReadShape {
  if (capability.name === 'privacy.contactability_batch' || capability.name === 'lists.review_batch') return 'leadIds';
  const takesText = capability.input.safeParse('texto').success;
  if (!takesText && capability.input.safeParse('').success) return 'none';
  if (!takesText && capability.input.safeParse(SAMPLE_ID).success) return 'id';
  return 'text';
}

const readSchemas = {
  none: z.object({}),
  id: z.object({ id: z.string().uuid().describe('El id exacto que viste en un resultado de este hilo') }),
  leadIds: z.object({ leadIds: z.array(z.string().uuid()).min(1).max(5).describe('De 1 a 5 ids de contactos que ya viste') }),
  text: z.object({ consulta: z.string().max(500).optional().describe('Lo que buscas, o el JSON que pida esta consulta según las instrucciones; vacío si no hace falta') }),
};

function readValue(shape: ReadShape, args: Record<string, unknown>): string {
  if (shape === 'none') return '';
  if (shape === 'id') return String(args.id ?? '');
  if (shape === 'leadIds') return JSON.stringify(args.leadIds ?? []);
  return typeof args.consulta === 'string' ? args.consulta : '';
}

type Finished = { answer: CoworkAnswer; via: 'answer' | 'proposal' | 'writer' | 'analyst' | 'designer' };
const finished = (answer: CoworkAnswer, via: Finished['via']): ToolOutcome => ({ status: 'final', output: { answer, via } satisfies Finished, text: answer.reply });

/** Which fields of the decision each kind of proposal carries, grouped the way a person would name them. */
const PROPOSAL_FAMILIES = [
  { name: 'proponer_contactos', description: 'Propone guardar, buscar el correo o el teléfono, investigar, importar o preparar contactos para aprobación.',
    actions: ['leads.save_contact', 'research.start', 'draft.request', 'lead.enrich', 'lead.enrich_phone', 'lead.enrich_batch', 'contacts.prepare_batch', 'contacts.import'] as const,
    fields: ['providerId', 'leadId', 'snapshotId', 'leadIds', 'prepareBatch', 'contactsImport'] as const },
  { name: 'proponer_campana', description: 'Propone crear, activar, pausar, detener, reintentar o programar una campaña, un envío o una respuesta en un hilo, para aprobación.',
    actions: ['campaign.create', 'campaign.activate', 'campaign.pause', 'campaign.retry', 'campaign.stop_v2', 'campaign.prepare_draft_v2', 'campaign.schedule_batch', 'email.send', 'email.reply_thread'] as const,
    fields: ['campaign', 'campaignId', 'enrollmentId', 'stepId', 'spacingMinutes', 'draftId', 'replyThread'] as const },
  { name: 'proponer_crm', description: 'Propone cambios del CRM del equipo: una ficha, una asignación, una incidencia o una misión.',
    actions: ['crm.update_record', 'crm.assign_lead', 'exception.resolve', 'mission.control'] as const,
    fields: ['crmRecord', 'crmAssign', 'exceptionResolve', 'missionControl'] as const },
  { name: 'proponer_linkedin', description: 'Propone invitar o escribir por LinkedIn a una persona o a varias, para aprobación.',
    actions: ['linkedin.invite', 'linkedin.message', 'linkedin.invite_batch', 'linkedin.message_batch'] as const,
    fields: ['leadId', 'linkedinMessage', 'linkedinBatch'] as const },
  { name: 'proponer_ajustes', description: 'Propone cambiar el perfil, una búsqueda guardada, el contexto de mensajes o una preferencia; planificar una tarea larga o ejecutar código sobre archivos.',
    actions: ['profile.update', 'saved_search.create', 'saved_search.update', 'saved_search.delete', 'message_context.update', 'preference.save', 'task.plan', 'code.execute'] as const,
    fields: ['profile', 'savedSearch', 'messageContext', 'preference', 'task', 'code'] as const },
  { name: 'proponer_busqueda', description: 'Propone buscar personas o empresas nuevas en el proveedor externo (gasta cuota; la persona revisa los criterios antes).',
    actions: ['prospecting.propose_search'] as const, fields: ['searchCriteria'] as const },
  { name: 'proponer_nota', description: 'Propone guardar una nota en un contacto ya observado.',
    actions: ['crm.propose_note'] as const, fields: ['leadId', 'note'] as const },
];

export function coworkProposalTool(family: (typeof PROPOSAL_FAMILIES)[number], stage: (decision: unknown) => Promise<ToolOutcome>): AgentTool {
  const shape = Object.fromEntries(family.fields.map(field => [field, coworkDecisionSchema.shape[field]]));
  return defineTool({
    name: family.name, description: family.description, kind: 'effect',
    schema: z.object({
      action: z.enum(family.actions as unknown as [string, ...string[]]),
      explicacion: z.string().min(3).max(1500).describe('Qué encontraste, qué propones, qué cuesta y qué pasará al aprobar: 1 a 3 frases, sin pregunta final'),
      ...shape,
    }),
    run: async ({ action, explicacion, ...fields }) => stage({ ...fields, action, query: null, leadId: (fields as { leadId?: unknown }).leadId ?? null, answer: { reply: explicacion, document: null } }),
  });
}

const answerSchema = coworkDocumentSchema.extend({
  memoria: coworkThreadMemorySchema.nullable().optional().describe('Resumen de toda la conversación, solo en la respuesta final'),
});

/**
 * The turn: build the tools from what the worker passed, run the agent, and turn its end (an answer, a proposal, a written email) into
 * what the worker has always received from the coordinator. A turn this runtime does not take goes to the coordinator loop.
 */
export async function runCoworkHarnessTurn(input: CoworkLoopInput): Promise<CoworkAnswer> {
  const config = input.harness;
  // A task resumed from its specialists and a question about a proposal still waiting keep their own road.
  if (!config || input.resumedObservations?.length || input.clarification) return runCoworkReadLoop(input);

  const observations: CoworkObservation[] = [];
  /** The reads of the turn by action and input, as they are made: a read asked twice, even at the same time, is made once. */
  const reads = new Map<string, Promise<CoworkObservation>>();
  let readsUsed = 0;
  let proposed = false;
  let planned = false;
  let written: { emails: ReturnType<typeof coworkCampaignEmails>; personal: ReturnType<typeof coworkPersonalEmails>; answer: CoworkAnswer } | null = null;
  let judged: CoworkAnswer | null = null;
  let reservation: string | undefined;
  let startedAt = 0;
  const rememberMemory = async (memory: z.infer<typeof coworkThreadMemorySchema>) => { if (input.remember) await input.remember(memory).catch(() => undefined); };

  const registry = new ToolRegistry();

  // Reads: one tool per capability of the gateway.
  for (const capability of config.capabilities) {
    if (capability.name === 'opportunities.list' && !input.opportunities) continue;
    const shape = coworkReadShape(capability);
    registry.add(defineTool({
      name: coworkToolName(capability.name), description: `${capability.description} (${capability.name})`, schema: readSchemas[shape], kind: 'read',
      run: async (args, context) => {
        const action = capability.name as CoworkReadAction;
        const value = readValue(shape, args as Record<string, unknown>);
        const key = `${action}\u0000${value}`;
        const known = reads.get(key);
        if (known) {
          const again = await known;
          return { status: 'ok', output: again.result, text: `(Ya lo consultaste en este turno; mismo resultado.)\n${JSON.stringify(again.result)}` };
        }
        if (!FREE_READS.has(action) && readsUsed >= config.maxReads) {
          return { status: 'error', message: `Se acabó el presupuesto de consultas de este turno (${config.maxReads}). Responde con lo que ya tienes y di en una línea qué queda para el siguiente paso.` };
        }
        if (!FREE_READS.has(action)) readsUsed += 1;
        const made = (async (): Promise<CoworkObservation> => {
          await input.authorize();
          context.signal.throwIfAborted();
          const result = await input.execute(action, value);
          context.signal.throwIfAborted();
          const observation: CoworkObservation = { action, input: value, result };
          await input.authorize();
          await input.record(observation);
          observations.push(observation);
          return observation;
        })();
        reads.set(key, made);
        try {
          return { status: 'ok', output: (await made).result };
        } catch (error) {
          // A read that failed can be asked again (it stays counted, as it always was).
          reads.delete(key);
          throw error;
        }
      },
    }));
  }

  // The plan the person sees while the turn works: written once, before the first read.
  registry.add(planTool(async steps => {
    if (planned) return;
    planned = true;
    await input.authorize();
    await input.record({ action: COWORK_PLAN_ACTION, input: '', result: { steps: steps.slice(0, COWORK_PLAN_LIMITS.steps).map(step => ({ label: step.label.slice(0, COWORK_PLAN_LIMITS.label), read: null })) } });
  }));

  // Proposals: staged through the checks of the coordinator loop; what cannot be staged comes back as the problem to fix.
  const stage = async (decision: unknown): Promise<ToolOutcome> => {
    await input.authorize();
    input.signal.throwIfAborted();
    const staged = await coworkStageDecision({ ...input, writtenSeed: written }, decision, observations);
    if (!staged.ok) return { status: 'error', message: staged.problem };
    proposed = true;
    return finished(staged.answer, 'proposal');
  };
  if (input.proposeEffect) for (const family of PROPOSAL_FAMILIES.filter(item => item.name !== 'proponer_busqueda' && item.name !== 'proponer_nota')) registry.add(coworkProposalTool(family, stage));
  if (input.proposeSearch) registry.add(coworkProposalTool(PROPOSAL_FAMILIES.find(item => item.name === 'proponer_busqueda')!, stage));
  if (input.proposeNote) registry.add(coworkProposalTool(PROPOSAL_FAMILIES.find(item => item.name === 'proponer_nota')!, stage));

  // The agents of the turn: the Writer, the Analyst and the Designer write from what was read.
  if (input.write) {
    registry.add(defineTool({
      name: 'redactar', kind: 'meta', schema: coworkWriteBriefSchema,
      description: 'Entrega un encargo a la Redactora para escribir correos, secuencias o mensajes con lo que leíste (draft.write). Vuelve el texto listo; si el encargo incluye una campaña, sigue con proponer_campana.',
      run: async (brief, context) => {
        await input.authorize();
        context.signal.throwIfAborted();
        const lookup = async (name: string): Promise<CoworkObservation | null> => {
          const observation: CoworkObservation = { action: 'leads.search', input: name, result: await input.execute('leads.search', name) };
          await input.record(observation);
          return observation;
        };
        let answer = await input.write!(brief, await coworkWriterObservations(brief, observations, input.history ?? [], lookup));
        const normalized = coworkBlocks(answer.blocks);
        if (answer.blocks?.length && JSON.stringify(normalized) !== JSON.stringify(answer.blocks)) answer = { ...answer, blocks: normalized.length ? normalized : null };
        await input.onWriteDelivery?.(answer);
        const asked = Boolean((brief.campaign || coworkAcceptsCampaignOffer(input.message, input.history)) && !written && input.proposeEffect);
        const emails = asked ? coworkCampaignEmails(answer.blocks) : null;
        const personal = asked && !emails ? coworkPersonalEmails(answer.blocks) : null;
        if (!emails && !personal) return finished(coworkWithDemoNote(answer), 'writer');
        written = { emails, personal, answer };
        observations.push({ action: COWORK_WRITTEN_ACTION, input: '', result: emails ? { scope: 'writer_output', emails } : { scope: 'writer_output', firstEmails: personal } });
        return { status: 'ok', output: { emails: emails?.length ?? 0, personal: personal?.length ?? 0 },
          text: 'La Redactora ya escribió los correos y la persona pidió la campaña: propónla ahora con proponer_campana (action campaign.create); la app copia su texto tal cual. En explicacion di a quiénes va y cuántos correos lleva.' };
      },
    }));
  }
  if (input.analyze) {
    registry.add(defineTool({
      name: 'analizar', kind: 'meta', schema: coworkAnalysisBriefSchema,
      description: 'Entrega a la Analista la pregunta sobre resultados que ya consultaste (analysis.write). Primero consulta los datos; vuelve la respuesta lista.',
      run: async (brief, context) => {
        if (!observations.some(item => item.action !== COWORK_WRITTEN_ACTION)) return { status: 'error', message: 'La Analista escribe con lo que consultaste: primero consulta los datos que responden la pregunta.' };
        await input.authorize();
        context.signal.throwIfAborted();
        return finished(await input.analyze!(brief, observations), 'analyst');
      },
    }));
  }
  if (input.design) {
    registry.add(defineTool({
      name: 'disenar', kind: 'meta', schema: coworkDesignBriefSchema,
      description: 'Entrega a la Diseñadora el encargo de un artefacto a medida para el lienzo (artifact.create). Vuelve la respuesta lista.',
      run: async (brief, context) => {
        await input.authorize();
        context.signal.throwIfAborted();
        return finished(await input.design!(brief, observations), 'designer');
      },
    }));
  }

  // The answer.
  registry.add(defineTool({
    name: 'responder', kind: 'meta', schema: answerSchema,
    description: 'Entrega la respuesta final a la persona. Termina el turno: úsala cuando ya tengas lo que necesitas, sin proponer nada.',
    run: async ({ memoria, ...answer }) => {
      if (memoria) await rememberMemory(memoria);
      return finished(answer, 'answer');
    },
  }));

  // The judge reads the answer before it is delivered and can send it back once.
  const hooks: AgentHooks = {
    beforeModelCall: async () => {
      await input.authorize();
      input.signal.throwIfAborted();
      reservation = await config.reserve?.();
      startedAt = Date.now();
    },
    afterModelCall: async ({ response }: { response: ModelResponse }) => { await config.recordUsage?.(reservation, response, Date.now() - startedAt); },
    review: input.judge ? async info => {
      const out = info.output as Finished;
      if (info.via !== 'final_tool' || out.via !== 'answer') return null;
      const fix = await input.judge!(out.answer, observations, { canRead: info.round + 2 <= config.maxRounds });
      if (fix) judged = out.answer;
      return fix;
    } : undefined,
  };

  const run = await runAgent({
    model: config.model, system: `${COWORK_HARNESS_PROTOCOL}\n\n${config.system}`, messages: [{ role: 'user', content: config.context }],
    registry, finalTool: 'responder', limits: { maxRounds: config.maxRounds, deadlineMs: config.deadlineMs, maxTokens: 6_000 }, effort: config.effort,
    signal: input.signal, hooks, maxReviews: 1, compaction: { clearAt: 60_000, summarizeAt: Number.POSITIVE_INFINITY },
  });

  let out: Finished;
  if (run.stopReason === 'final_tool') out = run.output as Finished;
  else if (run.text.trim()) out = { answer: { reply: run.text.trim(), document: null }, via: 'answer' };
  else throw new Error('Cowork did not produce a final answer');

  let answer = out.answer;
  if (out.via === 'answer') {
    answer = withCoworkReports(answer, observations);
    if (judged) {
      const verdict = coworkCorrectionVerdict(judged, answer, [observations, input.history ?? [], input.userContext ?? null]);
      input.onCorrection?.(verdict);
      if (verdict.keep === 'first') answer = judged;
    }
  }
  return coworkFinishAnswer(input, answer, observations, proposed);
}

/** What a model call cost, in the shape the ledger records (coworkModelUsage reads it). */
export function coworkHarnessTelemetry(response: ModelResponse, durationMs: number) {
  const prompt = response.usage.inputTokens;
  return {
    modelName: response.model, durationMs,
    usage: {
      prompt_tokens: prompt, completion_tokens: response.usage.outputTokens, total_tokens: prompt + response.usage.outputTokens,
      prompt_tokens_details: { cached_tokens: response.usage.cacheReadTokens }, cache_creation_input_tokens: response.usage.cacheWriteTokens,
    },
  };
}

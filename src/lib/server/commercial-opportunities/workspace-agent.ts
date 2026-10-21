// Oportunidades' agents: the chat of one opportunity and the section's assistant look things up before they answer, on the agent harness
// (OPPORTUNITIES_RUNTIME=harness; without it every call stays the single reserved call of workspace-ai.ts). What did not change is the
// money: each round of an agent is one paid step of the same ledger (reserved before the call, settled with what it cost, replayed
// when a job resumes), so an agent can neither spend outside the job's budget nor pay twice for a round it already got.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthError } from '@/lib/server/auth-utils';
import { opportunityModel, opportunityUsageCost, type OpportunityRole } from '@/lib/commercial-opportunities/model-policy';
import { answerSchema, validOpportunityCitation, type DocumentChunk } from '@/lib/commercial-opportunities/expedient';
import { OPPORTUNITY_CHAT_AGENT_RULES, OPPORTUNITY_CHAT_RULES, opportunityChatFacts, type OpportunityChatFacts } from '@/lib/commercial-opportunities/chat-prompt';
import type { WorkScope } from '@/lib/commercial-opportunities/workspace';
import type { StructuredTelemetry } from '@/ai/openai-json';
import {
  AgentOutputError, anthropicModel, anthropicRequest, defineTool, runStructured,
  type AgentRun, type AgentTool, type ContentBlock, type Effort, type ModelClient, type ModelResponse, type Usage,
} from '@/lib/agent-harness/index';
import { opportunityDb } from './workspace-store';
import { PRICING_VERSION, prices, reserveOpportunityStep, settleOpportunityStep, type Category, type OpportunityJob } from './workspace-ai';

/** The agents are on when the product asks for them, the provider is connected and the role's model is Claude (they need tool use). */
export function opportunityAgentEnabled(role: OpportunityRole, env: Record<string, string | undefined> = process.env) {
  if (String(env.OPPORTUNITIES_RUNTIME || '').trim().toLowerCase() !== 'harness') return false;
  if (!String(env.ANTHROPIC_API_KEY || '').trim()) return false;
  try { return opportunityModel(role, env).startsWith('claude-'); } catch { return false; }
}

// ─── The model, through the ledger ────────────────────────────────────────────────────────────────────────────────────────

const HELD_LIMIT = 750_000;

/** The usage of a call as the ledger's cost formula reads it. */
function telemetryOf(usage: Usage, model: string): StructuredTelemetry {
  return { modelName: model, usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens,
    prompt_tokens_details: { cached_tokens: usage.cacheReadTokens }, cache_creation_input_tokens: usage.cacheWriteTokens } } as unknown as StructuredTelemetry;
}

/** The answer Claude gave, with the model name it came back under (a dated snapshot of the same model is the same model). */
const sameModel = (answered: string, asked: string) => answered === asked || answered.startsWith(`${asked}-`);

type Replay = { content: ContentBlock[]; stopReason: ModelResponse['stopReason']; usage: Usage; model: string };
function replayOf(data: unknown): ModelResponse {
  const replay = data as Partial<Replay> | null;
  if (!replay || !Array.isArray(replay.content) || !replay.usage || typeof replay.stopReason !== 'string') throw new AuthError('Una llamada anterior está pendiente de conciliación; conservamos su reserva.', 409);
  return { content: replay.content, stopReason: replay.stopReason, usage: replay.usage, model: String(replay.model || '') };
}

/** A provider answer that is an HTTP error was not billed: its reservation is released instead of kept as uncertain. */
const refused = (error: unknown) => /^CLAUDE_HTTP_(?:4\d\d|5\d\d):/.test(String((error as Error)?.message || ''));

export type LedgeredModelInput = { step: string; role: OpportunityRole; category: Category; /** A model client in place of Claude's (tests). */ base?: ModelClient };

/**
 * A model client whose every call is a step of the job's ledger: `${step}:r${n}` is reserved at the call's own worst case (what it reads, at the
 * price of a cache write, plus everything it may write), then settled with the usage the provider reported. A step the job already paid comes
 * back from its stored answer, so a resumed job walks through its earlier rounds for free and continues where it stopped.
 */
export function ledgeredModel(client: SupabaseClient, job: OpportunityJob, input: LedgeredModelInput): ModelClient {
  const model = opportunityModel(input.role);
  const base = input.base ?? anthropicModel({ model });
  const price = prices(model);
  let round = 0;
  return {
    name: model,
    async complete(request) {
      round += 1;
      const readBytes = Buffer.byteLength(JSON.stringify([request.system, request.messages, request.tools]), 'utf8');
      const writeTokens = anthropicRequest(request, model).max_tokens;
      const reserve = Math.max(1, Math.ceil(readBytes * Math.max(price.input, price.write) + writeTokens * price.output));
      if (reserve > HELD_LIMIT) throw new AuthError('El contexto supera el presupuesto del trabajo; divide los documentos.', 402);
      const admitted = await reserveOpportunityStep(client, job, { step: `${input.step}:r${round}`, category: input.category, reserve });
      if (!admitted.fresh) return replayOf(admitted.data);
      let response: ModelResponse;
      try {
        response = await base.complete(request);
      } catch (error) {
        // Nothing came back: an HTTP error was not billed; a call cut off while it ran may have been, so it stays reserved until reconciled.
        await settleOpportunityStep(client, admitted.id, refused(error) ? 0 : null, { model, price, round, status: refused(error) ? 'provider_error' : 'uncertain' }, null).catch(() => undefined);
        throw error;
      }
      const cost = sameModel(response.model, model) ? opportunityUsageCost(telemetryOf(response.usage, model), price) : null;
      const replay: Replay = { content: response.content, stopReason: response.stopReason, usage: response.usage, model: response.model };
      await settleOpportunityStep(client, admitted.id, cost, { model: response.model, usage: response.usage, price, pricingVersion: PRICING_VERSION, round, stopReason: response.stopReason }, replay);
      return response;
    },
  };
}

// ─── One agent run ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type OpportunityAgentInput<S extends z.ZodTypeAny> = {
  /** The ledger's step prefix: the rounds are `${step}:r1`, `${step}:r2`… */
  step: string;
  role: OpportunityRole;
  category: Category;
  system: string;
  prompt: string;
  schema: S;
  tools: AgentTool[];
  validate?: (data: z.infer<S>) => string | null;
  effort?: Effort;
  maxRounds?: number;
  maxToolCalls?: number;
  /** Where the run gives up: the job's route allows five minutes and the answer is written while the person waits. */
  timeoutMs?: number;
  base?: ModelClient;
};

/** The agent looks things up with its tools and delivers the object of `schema`. Every failure is an AuthError the job writes as its error. */
export async function runOpportunityAgent<S extends z.ZodTypeAny>(client: SupabaseClient, job: OpportunityJob, input: OpportunityAgentInput<S>): Promise<{ data: z.infer<S>; run: AgentRun }> {
  const model = ledgeredModel(client, job, { step: input.step, role: input.role, category: input.category, base: input.base });
  const timeoutMs = input.timeoutMs ?? 150_000;
  try {
    return await runStructured({
      model, system: input.system, prompt: input.prompt, schema: input.schema, tools: input.tools, validate: input.validate,
      effort: input.effort ?? 'medium', signal: AbortSignal.timeout(timeoutMs),
      limits: { maxRounds: input.maxRounds ?? 5, maxToolCalls: input.maxToolCalls ?? 8, deadlineMs: Math.round(timeoutMs * .6), maxTokens: 3500, concurrency: 4 },
      // A long conversation makes room by dropping the results the model already used: the call that made them stays, so it can ask again.
      compaction: { clearAt: 20_000, summarizeAt: Number.MAX_SAFE_INTEGER, keepResults: 4 },
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(error instanceof AgentOutputError ? 'La respuesta no quedó lista. Conservamos los datos y el consumo observado.' : 'La evaluación no terminó. Conservamos los datos y el consumo observado.', 503);
  }
}

// ─── The chat of one opportunity ──────────────────────────────────────────────────────────────────────────────────────────

type ChunkRow = { id: string; document_id: string; locator: string; ordinal: number; content: string };
const SEEN_LIMIT = 400;

/** The fragments the agent has read: what it may cite. */
export class SeenChunks {
  private byId = new Map<string, DocumentChunk>();
  constructor(initial: DocumentChunk[] = []) { this.add(initial); }
  add(rows: DocumentChunk[]) { for (const row of rows) if (this.byId.size < SEEN_LIMIT || this.byId.has(row.id)) this.byId.set(row.id, row); }
  all() { return [...this.byId.values()]; }
}

/** What a fragment looks like to the model: as in the first fragments of the prompt, with its document's name. */
const fragment = (row: ChunkRow, names: Map<string, string>) => ({ id: row.id, document_id: row.document_id, documento: names.get(row.document_id) || 'Documento',
  locator: row.locator, ordinal: row.ordinal, content: row.content });

/** The lookups of the chat: search by words, list the documents, read one in order. Each fragment they return becomes citable. */
export function opportunityChatTools(client: SupabaseClient, scope: WorkScope, opportunityId: string, seen: SeenChunks, counter: { lookups: number }): AgentTool[] {
  const org = scope.organizationId;
  let documents: Promise<Array<{ id: string; name: string; source_kind: string; extraction_status: string; pages_read: number | null; pages_total: number | null }>> | null = null;
  const loadDocuments = () => documents ??= (async () => (opportunityDb(await client.from('opportunity_documents').select('id,name,source_kind,extraction_status,pages_read,pages_total')
    .eq('organization_id', org).eq('opportunity_id', opportunityId).order('id')) || []))();
  const names = async () => new Map((await loadDocuments()).map(doc => [doc.id, doc.name]));
  return [
    defineTool({
      name: 'buscar_en_documentos', kind: 'read', tags: ['documentos', 'bases', 'fragmentos', 'buscar'],
      description: 'Busca en los documentos del expediente los fragmentos que mejor responden a unas palabras (por ejemplo «garantía de seriedad de la oferta» o «plazo de entrega»). Devuelve hasta 8 fragmentos con su id para citarlos. Prueba con sinónimos y con otras palabras si no aparece.',
      schema: z.object({ consulta: z.string().min(2).max(300) }),
      run: async ({ consulta }) => {
        counter.lookups += 1;
        const rows = (opportunityDb(await client.rpc('opportunity_search_chunks', { p_org: org, p_user: scope.userId, p_id: opportunityId, p_query: consulta })) || []) as ChunkRow[];
        const found = rows.slice(0, 8);
        seen.add(found);
        if (!found.length) return { status: 'ok', output: { fragmentos: [] }, text: `Sin fragmentos para «${consulta}». Prueba con otras palabras, o lee un documento completo con leer_documento.` };
        const known = await names();
        return { status: 'ok', output: { fragmentos: found.map(row => fragment(row, known)) } };
      },
    }),
    defineTool({
      name: 'listar_documentos', kind: 'read', tags: ['documentos', 'expediente', 'archivos'],
      description: 'Lista los documentos del expediente con su id, de dónde vienen, si la IA ya los leyó y cuántas páginas.',
      schema: z.object({}),
      run: async () => {
        counter.lookups += 1;
        const docs = await loadDocuments();
        return { status: 'ok', output: { documentos: docs.map(doc => ({ id: doc.id, nombre: doc.name, origen: doc.source_kind, lectura: doc.extraction_status, paginasLeidas: doc.pages_read, paginasTotales: doc.pages_total })) } };
      },
    }),
    defineTool({
      name: 'leer_documento', kind: 'read', tags: ['documentos', 'leer', 'bases', 'anexos'],
      description: 'Lee un documento del expediente en orden, unos fragmentos a la vez. Úsalo cuando la búsqueda no alcance o cuando necesites el contexto completo (una sección, un anexo, una tabla). «desde» es la posición del primer fragmento; la respuesta dice desde dónde seguir.',
      schema: z.object({ documentoId: z.string().min(8).max(80), desde: z.number().int().min(0).max(100_000).default(0), cantidad: z.number().int().min(1).max(6).default(4) }),
      run: async ({ documentoId, desde, cantidad }) => {
        counter.lookups += 1;
        const docs = await loadDocuments();
        if (!docs.some(doc => doc.id === documentoId)) return { status: 'error', message: 'Ese documento no está en este expediente. Usa un id de listar_documentos.' };
        const rows = (opportunityDb(await client.from('opportunity_document_chunks').select('id,document_id,ordinal,locator,content').eq('organization_id', org)
          .eq('opportunity_id', opportunityId).eq('document_id', documentoId).gte('ordinal', desde).order('ordinal').limit(cantidad)) || []) as ChunkRow[];
        if (!rows.length) return { status: 'ok', output: { fragmentos: [], siguiente: null }, text: desde > 0 ? 'No hay más fragmentos: ya leíste el documento hasta el final.' : 'Ese documento no tiene texto leído (puede ser una imagen que la IA aún lee).' };
        seen.add(rows);
        const known = await names();
        return { status: 'ok', output: { documento: known.get(documentoId), fragmentos: rows.map(row => fragment(row, known)), siguiente: rows[rows.length - 1].ordinal + 1 } };
      },
    }),
  ];
}

/**
 * The chat as an agent: the same rules and facts as the single call (including the fragments retrieved for the question), plus the lookups to go
 * further. It cannot cite what it did not read: a citation that matches no fragment it saw (or no word of one) is sent back for it to fix, twice,
 * and what still fails is dropped by the caller as before.
 */
export async function runOpportunityChatAgent(client: SupabaseClient, job: OpportunityJob, input: { scope: WorkScope; opportunityId: string; facts: OpportunityChatFacts; chunks: DocumentChunk[]; base?: ModelClient }) {
  const seen = new SeenChunks(input.chunks);
  const counter = { lookups: 0 };
  let sentBack = 0;
  const { data } = await runOpportunityAgent(client, job, {
    step: 'answer', role: 'chat', category: 'chat', schema: answerSchema, base: input.base,
    system: `${OPPORTUNITY_CHAT_RULES}\n${OPPORTUNITY_CHAT_AGENT_RULES}`,
    prompt: opportunityChatFacts(input.facts),
    tools: opportunityChatTools(client, input.scope, input.opportunityId, seen, counter),
    validate: answer => {
      if (answer.mode === 'conversation' || sentBack >= 2) return null;
      const known = seen.all();
      const bad = answer.citations.filter(citation => !validOpportunityCitation(citation, known));
      if (bad.length) {
        sentBack += 1;
        return `Estas citas no coinciden con ningún fragmento que leíste (el chunkId no existe o el texto no está literal en él): ${bad.map(citation => `${citation.chunkId} «${citation.quote.slice(0, 60)}»`).join('; ')}. Copia la cita tal cual del fragmento o quítala.`;
      }
      if (!answer.citations.length && !counter.lookups) {
        sentBack += 1;
        return 'Respondes sobre el expediente sin citar nada y sin haber consultado los documentos. Busca primero con buscar_en_documentos o leer_documento; si no depende del expediente, usa mode «conversation».';
      }
      return null;
    },
  });
  return { answer: data, known: seen.all() };
}

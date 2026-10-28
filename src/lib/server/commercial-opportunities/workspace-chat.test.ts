import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { call, reply, ScriptedModel, usageOf } from '@/lib/agent-harness/scripted';

// The chat answered while the person waits, and its prompt, with the model and the database in memory.
async function load(entry: string, stubs: Record<string, string>) {
  const bundle = await build({
    stdin: { contents: entry, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    plugins: [{ name: 'stubs', setup(builder) {
      const filter = new RegExp(`(${Object.keys(stubs).map(name => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
      builder.onResolve({ filter }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: stubs[Object.keys(stubs).find(name => args.path.endsWith(name))!] }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  return compiled.exports;
}

const AUTH = 'export class AuthError extends Error {constructor(message,status){super(message);this.status=status}}';

test('a queued chat is taken and answered now; one a worker already took is left to it', async () => {
  const { answerOpportunityChatNow } = await load(`export { answerOpportunityChatNow } from './src/lib/server/commercial-opportunities/workspace-jobs';`, {
    '@/lib/server/auth-utils': AUTH,
    './workspace-access': 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }',
    './workspace-ai': 'export async function opportunityGenerate(){ throw new Error("no model here") }',
    './workspace-agent': 'export function opportunityAgentEnabled(){ return false } export async function runOpportunityAgent(){ throw new Error("no agent here") } export async function runOpportunityChatAgent(){ throw new Error("no agent here") }',
    './workspace-sources': 'export const criteriaSchema={}; export async function captureOpportunityLinkedIn(){} export async function captureOpportunityTenders(){} export async function evaluateOpportunityBatch(){}',
    './workspace-research': 'export async function runOpportunityResearch(){} export async function runOpportunityChat(client, job){ globalThis.__answered = job.id; return { answer: "Hola", citations: [], missing: [] } }',
  });
  const filters: Array<[string, unknown]> = [];
  const finished: unknown[] = [];
  const client = (job: unknown) => ({
    from: (table: string) => {
      const chain: any = {
        update: (values: unknown) => { filters.push(['update', values]); return chain; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
        select: () => chain,
        maybeSingle: async () => ({ data: table === 'opportunity_jobs' ? job : { organization_id: 'org', revision: 1 }, error: null }),
      };
      return chain;
    },
    rpc: async (name: string, args: unknown) => { finished.push([name, args]); return { data: true, error: null }; },
  });
  const job = { id: 'job-1', kind: 'chat', organization_id: 'org', requested_by: 'u1', opportunity_id: 'op1', lease_token: 'lease', payload: { requestId: 'r1' } };
  assert.equal(await answerOpportunityChatNow(client(job) as any, 'org', 'chat:u1:r1'), true);
  assert.equal((globalThis as any).__answered, 'job-1');
  assert.deepEqual(filters.filter(([column]) => ['organization_id', 'dedupe_key', 'kind', 'state'].includes(column)).slice(0, 4),
    [['organization_id', 'org'], ['dedupe_key', 'chat:u1:r1'], ['kind', 'chat'], ['state', 'queued']], 'only this chat, and only while queued');
  assert.equal((finished[0] as any)[0], 'opportunity_finish_job');
  assert.equal((finished[0] as any)[1].p_state, 'ready');
  (globalThis as any).__answered = null;
  assert.equal(await answerOpportunityChatNow(client(null) as any, 'org', 'chat:u1:r2'), false);
  assert.equal((globalThis as any).__answered, null, 'a worker took it: nothing runs twice');
});

test('the chat reads the conversation so far, and a greeting owes no citation', async () => {
  const { runOpportunityChat } = await load(`export { runOpportunityChat } from './src/lib/server/commercial-opportunities/workspace-research';`, {
    '@/lib/server/auth-utils': AUTH,
    './workspace-access': 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }',
    './workspace-ai': 'export const OPPORTUNITY_REPORT_OUTPUT_TOKENS = 32000; export async function opportunityGenerate(client, job, options){ globalThis.__prompt = options.prompt; return globalThis.__reply() } export async function opportunityGenerateReport(){}',
    './workspace-agent': 'export function opportunityAgentEnabled(){ return false } export async function runOpportunityAgent(){ throw new Error("no agent here") } export async function runOpportunityChatAgent(){ throw new Error("no agent here") }',
    './workspace-documents': 'export async function saveOpportunityDocument(){}',
    './workspace-download': 'export async function downloadOpportunitySource(){} export function opportunityAttachmentLinks(){ return [] } export async function createOpportunityPublicSession(){ return null }',
    './tickets': 'export async function resolveTicketForOrganization(){}',
  });
  const rows: Record<string, unknown> = {
    opportunity_chat_messages: { question: 'hola', report_id: null, created_at: '2026-10-16T04:00:00Z' },
    commercial_opportunities: { kind: 'tender', title: 'Servicio de traslado', buyer_name: 'Municipalidad', deadline_at: null, reasons: [] },
    opportunity_company_context: { offer: 'Logística de eventos' },
  };
  const history = [{ question: '¿Cuándo cierra?', answer: { answer: 'Cierra el 16 de octubre a las 10:00.' } }];
  const client = {
    rpc: async () => ({ data: [{ id: 'c1', document_id: 'd1', locator: 'p. 1', ordinal: 0, content: 'Las ofertas cierran el 16 de octubre de 2026 a las 10:00 horas.' }], error: null }),
    from: (table: string) => {
      let many = false;
      const chain: any = {
        select: () => chain, eq: () => chain, not: () => chain, order: () => chain,
        lt: () => { many = true; return chain; }, limit: () => chain,
        single: async () => ({ data: rows[table], error: null }), maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: many ? history : [], error: null }),
      };
      return chain;
    },
  };
  const job = { id: 'j1', organization_id: 'org', requested_by: 'u1', opportunity_id: 'op1', payload: { requestId: 'r1' } };
  (globalThis as any).__reply = () => ({ answer: '¡Hola! Puedo resumirte los requisitos o el plazo.', citations: [], missing: [], mode: 'conversation' });
  const greeting = await runOpportunityChat(client as any, job as any);
  assert.deepEqual(greeting.missing, [], 'a greeting is not flagged for lacking a citation');
  const prompt = (globalThis as any).__prompt as string;
  assert.match(prompt, /Conversación previa: \[\{"pregunta":"¿Cuándo cierra\?","respuesta":"Cierra el 16 de octubre a las 10:00\."\}\]/);
  assert.match(prompt, /mode «conversation»/);
  (globalThis as any).__reply = () => ({ answer: 'El plazo es mañana.', citations: [{ chunkId: 'c1', quote: 'una cita que no está' }], missing: [], mode: 'expedient' });
  const claim = await runOpportunityChat(client as any, job as any);
  assert.deepEqual(claim.citations, [], 'an invented quote is dropped');
  assert.match(claim.missing[0], /No encontré una cita textual/);
});

test('with the agent on, the chat keeps the citations of fragments it read with its tools, and drops the ones it invented', async () => {
  const before = { runtime: process.env.OPPORTUNITIES_RUNTIME, key: process.env.ANTHROPIC_API_KEY, chat: process.env.OPPORTUNITIES_CHAT_MODEL };
  Object.assign(process.env, { OPPORTUNITIES_RUNTIME: 'harness', ANTHROPIC_API_KEY: 'synthetic-not-a-credential' }); delete process.env.OPPORTUNITIES_CHAT_MODEL;
  try {
    const { runOpportunityChat } = await load(`export { runOpportunityChat } from './src/lib/server/commercial-opportunities/workspace-research';`, {
      '@/lib/server/auth-utils': AUTH,
      './workspace-access': 'export async function assertOpportunityRead(){} export function assertOpportunityAdmin(){} export async function readableOpportunityIds(){ return null }',
      './workspace-ai': 'export const OPPORTUNITY_REPORT_OUTPUT_TOKENS = 32000; export async function opportunityGenerate(){ throw new Error("the single call must not run") } export async function opportunityGenerateReport(){}'
        + ' export const PRICING_VERSION = "t"; export function prices(){ return { input: .1, output: .5, cache: .01, write: .2 } }'
        + ' export async function reserveOpportunityStep(client, job, input){ (globalThis.__steps ||= []).push(input.step); return { fresh: true, id: "res-" + globalThis.__steps.length } }'
        + ' export async function settleOpportunityStep(){}',
      './workspace-documents': 'export async function saveOpportunityDocument(){}',
      './workspace-download': 'export async function downloadOpportunitySource(){} export function opportunityAttachmentLinks(){ return [] } export async function createOpportunityPublicSession(){ return null }',
      './tickets': 'export async function resolveTicketForOrganization(){}',
    });
    (globalThis as any).__steps = [];
    const rows: Record<string, unknown> = {
      opportunity_chat_messages: { question: '¿Qué garantía piden?', report_id: null, created_at: '2026-10-16T04:00:00Z' },
      commercial_opportunities: { kind: 'tender', title: 'Servicio de traslado', buyer_name: 'Municipalidad', deadline_at: null, reasons: [] },
      opportunity_company_context: { offer: 'Logística de eventos' },
    };
    const first = { id: 'c1', document_id: 'd1', locator: 'p. 1', ordinal: 0, content: 'Las ofertas cierran el 16 de octubre de 2026 a las 10:00 horas.' };
    const found = { id: 'c2', document_id: 'd1', locator: 'p. 4', ordinal: 3, content: 'La garantía de seriedad de la oferta será de 5% del monto.' };
    const client = {
      rpc: async (_name: string, args: { p_query: string }) => ({ data: args.p_query === 'garantía de seriedad' ? [found] : [first], error: null }),
      from: (table: string) => {
        const chain: any = { select: () => chain, eq: () => chain, not: () => chain, order: () => chain, lt: () => chain, limit: () => chain,
          single: async () => ({ data: rows[table], error: null }), maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
          then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) };
        return chain;
      },
    };
    const says = (content: any) => ({ ...reply(content, undefined, usageOf(2000, 400)), model: 'claude-haiku-5-5' });
    const model = new ScriptedModel([
      says([call('buscar_en_documentos', { consulta: 'garantía de seriedad' }, 'a')]),
      says([call('entregar', { answer: 'Piden una garantía de seriedad del 5%. El plazo cierra el 16 de octubre.', mode: 'expedient', missing: [], citations: [
        { chunkId: 'c2', quote: 'garantía de seriedad de la oferta será de 5% del monto' }, { chunkId: 'c1', quote: 'cierran el 16 de octubre de 2026' } ] }, 'b')]),
    ]);
    const job = { id: 'j1', organization_id: 'org', requested_by: 'u1', opportunity_id: 'op1', payload: { requestId: 'r1' } };
    const answer = await runOpportunityChat(client as any, job as any, model);
    assert.deepEqual(answer.citations.map((citation: any) => citation.chunkId), ['c2', 'c1'], 'a fragment read with a tool is citable; so are the first ones');
    assert.deepEqual(answer.missing, []);
    assert.deepEqual((globalThis as any).__steps, ['answer:r1', 'answer:r2']);
    assert.match(String(model.requests[0].messages[0].content), /Fragmentos: \[\{"id":"c1"/, 'the first fragments are in the prompt, as in the single call');
  } finally {
    for (const [name, value] of Object.entries({ OPPORTUNITIES_RUNTIME: before.runtime, ANTHROPIC_API_KEY: before.key, OPPORTUNITIES_CHAT_MODEL: before.chat })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

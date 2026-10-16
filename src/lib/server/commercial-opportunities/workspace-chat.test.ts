import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

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
    './workspace-ai': 'export async function opportunityGenerate(client, job, options){ globalThis.__prompt = options.prompt; return globalThis.__reply() } export async function opportunityGenerateReport(){}',
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

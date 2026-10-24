import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { call, reply, ScriptedModel, usageOf } from '@/lib/agent-harness/scripted';

// The agents of Oportunidades with the database, the ledger and the model in memory: every round is a paid step, and what the agent
// may cite is what it read.
const entry = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-agent';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-agent-services', setup(builder) {
    builder.onResolve({ filter: /auth-utils|workspace-store|ai\/openai-json/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
      args.path.includes('auth-utils') ? `export class AuthError extends Error {constructor(message,status){super(message);this.status=status;this.name='AuthError'}}` :
      args.path.includes('openai-json') ? `export async function generateStructuredWithTelemetry(){throw Error('External providers forbidden in this test')}` :
      `export function opportunityDb(result){if(result.error)throw Error('Fixture DB rejected');return result.data}`,
    }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { opportunityAgentEnabled, ledgeredModel, runOpportunityAgent, runOpportunityChatAgent, opportunityChatTools, SeenChunks } = compiled.exports;

const saved = { key: process.env.ANTHROPIC_API_KEY, chat: process.env.OPPORTUNITIES_CHAT_MODEL };
before(() => { delete process.env.OPPORTUNITIES_CHAT_MODEL; });
after(() => { for (const [name, value] of Object.entries({ ANTHROPIC_API_KEY: saved.key, OPPORTUNITIES_CHAT_MODEL: saved.chat })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });

const HAIKU = 'claude-haiku-5-5';
/** A scripted answer that says it came from Haiku, as the provider reports. */
const says = (content: any, model = HAIKU, usage = usageOf(2000, 400)) => ({ ...reply(content, undefined, usage), model });

const chunk = (id: string, document: string, ordinal: number, content: string) => ({ id, document_id: document, locator: `p. ${ordinal + 1}`, ordinal, content });
const CHUNKS = [
  chunk('c1', 'doc-bases', 0, 'Las ofertas cierran el 16 de octubre de 2026 a las 10:00 horas.'),
  chunk('c2', 'doc-bases', 1, 'La garantía de seriedad de la oferta será de 5% del monto y debe presentarse con la oferta.'),
  chunk('c3', 'doc-bases', 2, 'El plazo de entrega es de 30 días corridos desde la orden de compra.'),
  chunk('c4', 'doc-anexo', 0, 'Anexo 1: declaración jurada simple de inhabilidades.'),
];
const DOCS = [
  { id: 'doc-bases', name: 'Bases administrativas.pdf', source_kind: 'upload', extraction_status: 'read', pages_read: 12, pages_total: 12 },
  { id: 'doc-anexo', name: 'Anexos.docx', source_kind: 'upload', extraction_status: 'read', pages_read: 3, pages_total: 3 },
];

/** Enough of supabase-js for the ledger, the documents and the search; every reserved step is kept so a second run replays. */
function fixture(options: { budget?: boolean; found?: any[] } = {}) {
  const steps = new Map<string, { id: string; state: string; cost: number | null; data: any; receipt: any; held: number }>();
  const reservations: any[] = [], settlements: any[] = [], searches: string[] = [];
  const state = { budget: options.budget ?? true };
  const client = {
    from(table: string) {
      const filters: Record<string, any> = {};
      let from = 0, max = Infinity;
      const rows = () => {
        if (table === 'opportunity_documents') return DOCS;
        if (table === 'opportunity_document_chunks') return CHUNKS.filter(row => (!filters.document_id || row.document_id === filters.document_id) && row.ordinal >= from).slice(0, max);
        return [];
      };
      const query: any = {
        update() { return query; }, select() { return query; }, gt() { return query; }, order() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; }, gte(_key: string, value: number) { from = value; return query; }, limit(value: number) { max = value; return query; },
        async maybeSingle() {
          if (table === 'opportunity_jobs') return { data: { id: 'job' }, error: null };
          if (table === 'opportunity_ai_results') { const found = [...steps.values()].find(step => step.id === filters.reservation_id); return { data: found?.data ? { data: found.data } : null, error: null }; }
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => void) { resolve({ data: rows(), error: null }); },
      };
      return query;
    },
    async rpc(name: string, args: any) {
      if (name === 'opportunity_budget_reserve') {
        reservations.push(args);
        const existing = steps.get(args.p_step);
        if (existing) return { data: { admitted: true, fresh: false, id: existing.id, state: existing.state }, error: null };
        if (!state.budget) return { data: { admitted: false }, error: null };
        const id = `res-${steps.size + 1}`;
        steps.set(args.p_step, { id, state: 'reserved', cost: null, data: null, receipt: null, held: args.p_micro });
        return { data: { admitted: true, fresh: true, id, state: 'reserved' }, error: null };
      }
      if (name === 'opportunity_budget_settle') {
        settlements.push(args);
        const step = [...steps.values()].find(item => item.id === args.p_id)!;
        Object.assign(step, { state: args.p_cost === null ? 'uncertain' : 'settled', cost: args.p_cost, receipt: args.p_receipt, data: args.p_data });
        return { data: true, error: null };
      }
      if (name === 'opportunity_search_chunks') { searches.push(args.p_query); return { data: options.found ?? [CHUNKS[1]], error: null }; }
      throw Error(`Unexpected RPC ${name}`);
    },
  } as any;
  const job = { id: 'job', organization_id: 'org', opportunity_id: 'op1', requested_by: 'u1', lease_token: 'lease', kind: 'chat', payload: {} };
  return { client, job, steps, reservations, settlements, searches, state };
}

const scope = { organizationId: 'org', userId: 'u1', role: 'member' };
const facts = { item: { kind: 'tender', title: 'Servicio de traslado', buyer_name: 'Municipalidad', deadline_at: null, reasons: [] }, offer: 'Logística de eventos', ficha: null,
  summary: null, conversation: [], question: '¿Qué garantía piden?', chunks: [CHUNKS[0]] };
const answer = (extra: Record<string, unknown> = {}) => ({ answer: 'Piden una garantía de seriedad del 5%.', citations: [{ chunkId: 'c2', quote: 'garantía de seriedad de la oferta será de 5% del monto' }], missing: [], mode: 'expedient', ...extra });

test('the agents are on only when the product asks, the provider is connected and the role runs on Claude', () => {
  const on = { OPPORTUNITIES_RUNTIME: 'harness', ANTHROPIC_API_KEY: 'key' };
  assert.equal(opportunityAgentEnabled('chat', on), true);
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_RUNTIME: 'HARNESS ' }), true);
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_RUNTIME: undefined }), false, 'off unless asked for');
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_RUNTIME: 'single' }), false);
  assert.equal(opportunityAgentEnabled('chat', { ...on, ANTHROPIC_API_KEY: ' ' }), false, 'no provider, no agent: the single call reports it');
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_CHAT_MODEL: 'gpt-6-luna' }), false, 'tool use is Claude\'s');
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_CHAT_MODEL: 'claude-haiku-5-5' }), true);
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_CHAT_MODEL: 'claude-sonnet-5-5' }), false, 'Sonnet is out of the app');
  assert.equal(opportunityAgentEnabled('chat', { ...on, OPPORTUNITIES_CHAT_MODEL: 'something-else' }), false, 'a model the policy does not allow is not guessed');
});

test('every round is a step of the ledger, reserved at its worst case and settled with its cost; a resumed job replays them for free', async () => {
  const f = fixture();
  const model = () => new ScriptedModel([
    says([call('buscar_en_documentos', { consulta: 'garantía de seriedad' }, 'u1')]),
    says([call('entregar', answer(), 'u2')]),
  ]);
  const first = model();
  const run = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [CHUNKS[0]], base: first });
  assert.equal(run.answer.answer, 'Piden una garantía de seriedad del 5%.');
  assert.deepEqual(f.reservations.map(r => [r.p_step, r.p_category, r.p_lease]), [['answer:r1', 'chat', 'lease'], ['answer:r2', 'chat', 'lease']]);
  assert.ok(f.reservations.every(r => r.p_micro >= 1 && r.p_micro <= 750_000));
  // 2000 input tokens at 0.1 + 400 output at 0.5 = 400 micro-USD, per round.
  assert.deepEqual(f.settlements.map(s => s.p_cost), [400, 400]);
  assert.equal(f.settlements[0].p_receipt.model, HAIKU);
  assert.equal(f.settlements[0].p_receipt.round, 1);
  assert.equal(f.settlements[0].p_data.stopReason, 'tool_use', 'what the round produced is stored for a replay');

  const again = model();
  const resumed = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [CHUNKS[0]], base: again });
  assert.equal(again.calls, 0, 'the provider is not called for a round the job already paid');
  assert.equal(f.settlements.length, 2, 'and nothing is settled twice');
  assert.deepEqual(resumed.answer, run.answer);
});

test('the cost is known when the provider answers under a dated snapshot of the model, and unknown when it is another model', async () => {
  const f = fixture();
  const done = (model: string) => new ScriptedModel([says([call('entregar', answer({ citations: [] , mode: 'conversation' }), 'u1')], model)]);
  await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [], base: done(`${HAIKU}-20261001`) });
  assert.equal(f.settlements[0].p_cost, 400);
  const g = fixture();
  await runOpportunityChatAgent(g.client, g.job, { scope, opportunityId: 'op1', facts, chunks: [], base: done('claude-haiku-4-5') });
  assert.equal(g.settlements[0].p_cost, null, 'another model than the one reserved: its price is not assumed');
});

test('a provider error is released at no cost; a call cut off while it ran stays reserved; the person never reads the provider\'s words', async () => {
  const failing = (error: Error) => ({ name: HAIKU, async complete() { throw error; } });
  const f = fixture();
  await assert.rejects(runOpportunityAgent(f.client, f.job, { step: 'answer', role: 'chat', category: 'chat', system: 's', prompt: 'p', schema: (await import('zod')).z.object({ ok: (await import('zod')).z.boolean() }), tools: [],
    base: failing(new Error('CLAUDE_HTTP_529:Overloaded sk-secret')) }),
  (error: any) => error.status === 503 && !/sk-secret|529|Overloaded/.test(error.message));
  assert.equal(f.settlements[0].p_cost, 0);
  assert.equal(f.settlements[0].p_receipt.status, 'provider_error');
  const g = fixture();
  await assert.rejects(runOpportunityAgent(g.client, g.job, { step: 'answer', role: 'chat', category: 'chat', system: 's', prompt: 'p', schema: (await import('zod')).z.object({ ok: (await import('zod')).z.boolean() }), tools: [],
    base: failing(new Error('socket hang up')) }), (error: any) => error.status === 503);
  assert.equal(g.settlements[0].p_cost, null, 'unknown: the reservation stays until it is reconciled');
  assert.equal(g.settlements[0].p_receipt.status, 'uncertain');
});

test('a budget that is gone stops the agent before it calls the provider, and a context beyond the cap is refused', async () => {
  const f = fixture({ budget: false });
  const base = new ScriptedModel([says([call('entregar', answer(), 'u1')])]);
  await assert.rejects(runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [], base }), (error: any) => error.status === 402);
  assert.equal(base.calls, 0);
  const g = fixture();
  const huge = new ScriptedModel([says('hola')]);
  const model = ledgeredModel(g.client, g.job, { step: 'x', role: 'chat', category: 'chat', base: huge });
  await assert.rejects(model.complete({ system: 's', messages: [{ role: 'user', content: 'a'.repeat(4_500_000) }], tools: [] }), (error: any) => error.status === 402 && /pregunta más acotada/.test(error.message));
  assert.equal(g.reservations.length, 0, 'nothing is reserved for a call that cannot be afforded');
});

test('the chat can cite what it read with its tools, not only the first fragments', async () => {
  const f = fixture();
  const base = new ScriptedModel([
    says([call('buscar_en_documentos', { consulta: 'garantía' }, 'u1'), call('listar_documentos', {}, 'u2')]),
    says([call('entregar', answer(), 'u3')]),
  ]);
  const { answer: result, known } = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [CHUNKS[0]], base });
  assert.deepEqual(known.map((row: any) => row.id).sort(), ['c1', 'c2'], 'the fragment it found joins the ones it was given');
  assert.equal(result.citations.length, 1);
  assert.deepEqual(f.searches, ['garantía']);
  const seenByModel = JSON.stringify(base.requests[1].messages);
  assert.match(seenByModel, /garantía de seriedad de la oferta/, 'the found fragment reached the model');
  assert.match(seenByModel, /Bases administrativas\.pdf/, 'with its document\'s name');
  assert.match(base.requests[0].system, /analista que revisa el expediente/, 'the agent rules follow the chat\'s own rules');
  assert.match(base.requests[0].system, /Eres el asistente de ANTON\.IA/);
});

test('a citation that matches nothing it read goes back to the agent, twice at most', async () => {
  const f = fixture();
  const invented = { chunkId: 'c9', quote: 'La garantía será del 10% del contrato' };
  const base = new ScriptedModel([
    says([call('entregar', answer({ citations: [invented] }), 'u1')]),
    says([call('entregar', answer({ citations: [{ chunkId: 'c1', quote: 'cierran el 16 de octubre de 2026' }, { chunkId: 'c1', quote: 'texto que no está en el fragmento' }] }), 'u2')]),
    says([call('entregar', answer(), 'u3')]),
  ]);
  const { answer: result } = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [CHUNKS[0], CHUNKS[1]], base });
  assert.equal(base.calls, 3);
  assert.match(JSON.stringify(base.requests[1].messages), /no coinciden con ningún fragmento que leíste[\s\S]*c9/);
  assert.match(JSON.stringify(base.requests[2].messages), /texto que no está en el fragmento/);
  assert.equal(result.citations[0].chunkId, 'c2');
  // A third bad answer is accepted as it stands: the caller drops the citations that do not match, as it always did.
  const g = fixture();
  const stubborn = new ScriptedModel([says([call('entregar', answer({ citations: [invented] }), 'a')]), says([call('entregar', answer({ citations: [invented] }), 'b')]), says([call('entregar', answer({ citations: [invented] }), 'c')])]);
  const last = await runOpportunityChatAgent(g.client, g.job, { scope, opportunityId: 'op1', facts, chunks: [CHUNKS[1]], base: stubborn });
  assert.equal(stubborn.calls, 3);
  assert.equal(last.answer.citations[0].chunkId, 'c9');
});

test('an answer about the expedient with no citation and no lookup is sent to look first; a greeting is not', async () => {
  const f = fixture();
  const base = new ScriptedModel([
    says([call('entregar', answer({ answer: 'No aparece.', citations: [] }), 'u1')]),
    says([call('buscar_en_documentos', { consulta: 'garantía de seriedad' }, 'u2')]),
    says([call('entregar', answer(), 'u3')]),
  ]);
  const { answer: result } = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: [], base });
  assert.match(JSON.stringify(base.requests[1].messages), /sin haber consultado los documentos/);
  assert.equal(result.citations.length, 1);
  const g = fixture();
  const greeting = new ScriptedModel([says([call('entregar', answer({ answer: '¡Hola!', citations: [], mode: 'conversation' }), 'u1')])]);
  await runOpportunityChatAgent(g.client, g.job, { scope, opportunityId: 'op1', facts, chunks: [], base: greeting });
  assert.equal(greeting.calls, 1);
  // Having looked and found nothing is an honest «no está»: no citation is owed.
  const h = fixture({ found: [] });
  const honest = new ScriptedModel([says([call('buscar_en_documentos', { consulta: 'multas' }, 'u1')]), says([call('entregar', answer({ answer: 'No encontré multas.', citations: [], missing: ['Confirmarlo en las bases'] }), 'u2')])]);
  const done = await runOpportunityChatAgent(h.client, h.job, { scope, opportunityId: 'op1', facts, chunks: [], base: honest });
  assert.equal(honest.calls, 2);
  assert.deepEqual(done.answer.citations, []);
});

test('the documents are read in order, only the ones of this expedient, and each page says where to go on', async () => {
  const f = fixture();
  const seen = new SeenChunks([]);
  const tools = opportunityChatTools(f.client, scope, 'op1', seen, { lookups: 0 });
  const run = (name: string, input: unknown) => tools.find((tool: any) => tool.name === name).run(tool(name).schema.parse(input), {});
  const tool = (name: string) => tools.find((item: any) => item.name === name);
  const listing = await run('listar_documentos', {});
  assert.deepEqual(listing.output.documentos.map((doc: any) => [doc.id, doc.nombre, doc.lectura]), [['doc-bases', 'Bases administrativas.pdf', 'read'], ['doc-anexo', 'Anexos.docx', 'read']]);
  const first = await run('leer_documento', { documentoId: 'doc-bases', cantidad: 2 });
  assert.deepEqual(first.output.fragmentos.map((row: any) => row.id), ['c1', 'c2']);
  assert.equal(first.output.siguiente, 2);
  const next = await run('leer_documento', { documentoId: 'doc-bases', desde: first.output.siguiente, cantidad: 2 });
  assert.deepEqual(next.output.fragmentos.map((row: any) => row.id), ['c3']);
  const end = await run('leer_documento', { documentoId: 'doc-bases', desde: 3 });
  assert.match(end.text, /ya leíste el documento hasta el final/);
  const stranger = await run('leer_documento', { documentoId: 'doc-de-otro-expediente' });
  assert.equal(stranger.status, 'error');
  assert.deepEqual(seen.all().map((row: any) => row.id).sort(), ['c1', 'c2', 'c3'], 'only what was really read can be cited');
  assert.equal(tool('leer_documento').schema.safeParse({ documentoId: 'doc-bases', cantidad: 50 }).success, false, 'a page has a size');
});

test('an agent that never delivers fails with a plain message, after the rounds it paid for were settled', async () => {
  const f = fixture();
  const { z } = await import('zod');
  const base = new ScriptedModel(Array.from({ length: 6 }, () => () => says('Mmm, déjame pensar.')));
  await assert.rejects(runOpportunityAgent(f.client, f.job, { step: 'answer', role: 'chat', category: 'chat', system: 's', prompt: 'p', schema: z.object({ ok: z.boolean() }), tools: [], base, maxRounds: 3 }),
    (error: any) => error.status === 503 && /no quedó lista/.test(error.message));
  assert.ok(f.settlements.length >= 1 && f.settlements.every(item => item.p_cost === 400), 'what was paid is on the ledger');
});

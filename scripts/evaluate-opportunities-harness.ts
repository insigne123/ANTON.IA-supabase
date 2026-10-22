// Real Claude, the chat agent of Oportunidades (OPPORTUNITIES_RUNTIME=harness), against the same question answered in one call with the first
// fragments only (what the chat did before). The database and the ledger are in memory; the questions and the expedient are
// scripts/fixtures/opportunities-expedient.ts. Explicit opt-in only. Never loads env files, touches the database or calls any provider but Anthropic's.
//
//   ANTHROPIC_API_KEY=... [OPPORTUNITIES_CHAT_MODEL=claude-sonnet-5-5] \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-opportunities-harness.ts --live --max-calls=120 [--repeat=2] [--output=file.json]
//
// Each answer is checked for what it must say, for what it must not say (a fragment of the expedient tells the model to ignore its rules),
// and for its citations: one that does not match a fragment the model read is a citation the product would drop.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { OPPORTUNITY_CHAT_RULES, opportunityChatFacts } from '../src/lib/commercial-opportunities/chat-prompt';
import { answerSchema, validOpportunityCitation } from '../src/lib/commercial-opportunities/expedient';
import { opportunityModel } from '../src/lib/commercial-opportunities/model-policy';
import { EVAL_FACTS, EVAL_QUESTIONS, EXPEDIENT_CHUNKS, EXPEDIENT_DOCUMENTS, type ExpedientChunk } from './fixtures/opportunities-expedient';

const entry = await build({
  stdin: { contents: `export * from './src/lib/server/commercial-opportunities/workspace-agent';`, loader: 'ts', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'isolated-agent-services', setup(builder) {
    builder.onResolve({ filter: /auth-utils|workspace-store|ai\/openai-json/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents:
      args.path.includes('auth-utils') ? `export class AuthError extends Error {constructor(message,status){super(message);this.status=status;this.name='AuthError'}}` :
      args.path.includes('openai-json') ? `export async function generateStructuredWithTelemetry(){throw Error('External providers forbidden in this evaluation')}` :
      `export function opportunityDb(result){if(result.error)throw Error('Fixture DB rejected');return result.data}`,
    }));
  } }],
});
const compiled: { exports: any } = { exports: {} };
new Function('require', 'module', 'exports', entry.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { runOpportunityChatAgent, runOpportunityAgent } = compiled.exports;

const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'un', 'una', 'que', 'en', 'y', 'o', 'a', 'por', 'con', 'se', 'si', 'es', 'del', 'al', 'para', 'hay', 'son', 'como', 'cuanto', 'cuantos', 'cuando', 'cual', 'nos', 'les', 'lo', 'me']);
const words = (text: string) => plain(text).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP.has(word)).map(word => word.slice(0, 5));

/** The ledger and the documents of the job, in memory, with a keyword search standing in for `opportunity_search_chunks`. */
function fixture() {
  const steps = new Map<string, { id: string; state: string; cost: number | null; data: any; receipt: any }>();
  const reservations: any[] = [], settlements: any[] = [], searches: string[] = [];
  const search = (query: string): ExpedientChunk[] => {
    const wanted = new Set(words(query));
    return EXPEDIENT_CHUNKS.map(row => ({ row, score: words(row.content).filter(word => wanted.has(word)).length })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.row.ordinal - b.row.ordinal).slice(0, 8).map(item => item.row);
  };
  const client = {
    from(table: string) {
      const filters: Record<string, any> = {};
      let from = 0, max = Infinity;
      const rows = () => {
        if (table === 'opportunity_documents') return EXPEDIENT_DOCUMENTS;
        if (table === 'opportunity_document_chunks') return EXPEDIENT_CHUNKS.filter(row => (!filters.document_id || row.document_id === filters.document_id) && row.ordinal >= from).slice(0, max);
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
        const id = `res-${steps.size + 1}`;
        steps.set(args.p_step, { id, state: 'reserved', cost: null, data: null, receipt: null });
        return { data: { admitted: true, fresh: true, id, state: 'reserved' }, error: null };
      }
      if (name === 'opportunity_budget_settle') {
        settlements.push(args);
        const step = [...steps.values()].find(item => item.id === args.p_id)!;
        Object.assign(step, { state: args.p_cost === null ? 'uncertain' : 'settled', cost: args.p_cost, receipt: args.p_receipt, data: args.p_data });
        return { data: true, error: null };
      }
      if (name === 'opportunity_search_chunks') { searches.push(args.p_query); return { data: search(args.p_query), error: null }; }
      throw Error(`Unexpected RPC ${name}`);
    },
  } as any;
  const job = { id: 'job', organization_id: 'org', opportunity_id: 'op1', requested_by: 'u1', lease_token: 'lease', kind: 'chat', payload: {} };
  return { client, job, reservations, settlements, searches, search };
}

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  if (!process.argv.includes('--live') || !String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    throw new Error('Requires --live and an explicit ANTHROPIC_API_KEY. The offline check is workspace-agent.test.ts.');
  }
  const maxCalls = Number(arg('max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000) throw new Error('Explicit --max-calls=1..1000 required');
  const repeat = Math.max(1, Math.min(5, Number(arg('repeat') || 1)));
  const only = arg('cases')?.split(',');
  const questions = EVAL_QUESTIONS.filter(item => !only || only.includes(item.id));
  const model = opportunityModel('chat');
  const scope = { organizationId: 'org', userId: 'u1', role: 'member' };

  const rows: Array<Record<string, any>> = [];
  let calls = 0;
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const item of questions) {
      for (const arm of ['single', 'agent'] as const) {
        if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted');
        const f = fixture();
        const first = f.search(item.question).slice(0, 4);
        const facts = { ...EVAL_FACTS, ficha: null, summary: null, conversation: [], question: item.question, chunks: first };
        const started = Date.now();
        let answer: any, known: ExpedientChunk[] = first, error: string | null = null;
        try {
          if (arm === 'agent') {
            const run = await runOpportunityChatAgent(f.client, f.job, { scope, opportunityId: 'op1', facts, chunks: first });
            answer = run.answer; known = run.known;
          } else {
            // What the chat did before: the rules, the facts and the first fragments, one call, no lookups.
            const run = await runOpportunityAgent(f.client, f.job, { step: 'answer', role: 'chat', category: 'chat', schema: answerSchema, system: OPPORTUNITY_CHAT_RULES, prompt: opportunityChatFacts(facts), tools: [], maxRounds: 2 });
            answer = run.data;
          }
        } catch (failure) { error = failure instanceof Error ? failure.message.slice(0, 160) : String(failure); }
        calls += f.reservations.length;
        const seconds = Math.round((Date.now() - started) / 100) / 10;
        const text = plain(`${answer?.answer || ''} ${(answer?.missing || []).join(' ')}`);
        const failed: string[] = [];
        if (error) failed.push(`error: ${error}`);
        else {
          const loose = (pattern: RegExp) => new RegExp(pattern.source, 'i');
          for (const pattern of item.expect) if (!loose(pattern).test(text)) failed.push(`falta ${pattern}`);
          for (const pattern of item.forbid || []) if (loose(pattern).test(text)) failed.push(`no debía decir ${pattern}`);
          const lost = (answer.citations || []).filter((citation: any) => !validOpportunityCitation(citation, known));
          if (lost.length) failed.push(`${lost.length} cita(s) que el producto descartaría`);
          if (item.kind === 'conversation' && (answer.citations || []).length) failed.push('cita algo en un saludo');
          if ((item.kind === 'fact' || item.kind === 'synonym' || item.kind === 'calculation') && !(answer.citations || []).length) failed.push('sin cita');
        }
        const usage = f.settlements.reduce((sum, step) => {
          const used = step.p_receipt?.usage;
          return { input: sum.input + (used?.inputTokens || 0), output: sum.output + (used?.outputTokens || 0), micro: sum.micro + (typeof step.p_cost === 'number' ? step.p_cost : 0) };
        }, { input: 0, output: 0, micro: 0 });
        rows.push({ id: item.id, kind: item.kind, arm, attempt, passed: failed.length === 0, failed, rounds: f.reservations.length, lookups: f.searches.length, seconds,
          citations: (answer?.citations || []).length, answer: String(answer?.answer || '').slice(0, 500), input: usage.input, output: usage.output, costUsd: usage.micro / 1_000_000 });
        console.log(`${failed.length ? 'FAIL' : 'PASS'} ${item.id}#${attempt} ${arm} ${f.reservations.length} rondas ${seconds}s${failed.length ? ` — ${failed.join('; ').slice(0, 200)}` : ''}`);
      }
    }
  }
  const summary = (arm: string) => {
    const mine = rows.filter(row => row.arm === arm);
    const passed = mine.filter(row => row.passed).length;
    return { arm, passed, total: mine.length, passRate: mine.length ? Math.round((passed / mine.length) * 1000) / 10 : null, rounds: mine.reduce((sum, row) => sum + row.rounds, 0),
      seconds: Math.round(mine.reduce((sum, row) => sum + row.seconds, 0) * 10) / 10, costUsd: Math.round(mine.reduce((sum, row) => sum + row.costUsd, 0) * 10_000) / 10_000 };
  };
  const report = { model, repeat, questions: questions.map(item => item.id), summary: [summary('single'), summary('agent')], rows };
  for (const line of report.summary) console.log(`\n${line.arm}: ${line.passed}/${line.total} (${line.passRate}%), ${line.rounds} rondas, ${line.seconds}s, US$${line.costUsd}`);
  const output = arg('output');
  if (output) { mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); writeFileSync(path.resolve(output), JSON.stringify(report, null, 2)); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

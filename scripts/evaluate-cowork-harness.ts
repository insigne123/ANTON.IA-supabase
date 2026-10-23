// Real Claude, the harness runtime (COWORK_RUNTIME=harness), the same corpus and the same checks as evaluate-cowork-conversations.ts:
// the way to measure the coordinator that has run until now against the one that works with tools, case by case.
// Explicit opt-in only. Never loads env files, touches the database or calls any provider but Anthropic's.
//
//   ANTHROPIC_API_KEY=... COWORK_HARNESS_MODEL=claude-sonnet-5-5 \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=120 [--cases=a,b|axis-*] [--repeat=2] [--output=file.json] [--writer]
//
// --writer hands writing to the Writer and the Reviewer (writer.ts), as COWORK_WRITER_ENABLED does in production and as --writer does in
// evaluate-cowork-conversations.ts: COWORK_WRITER_MODEL / COWORK_REVIEWER_MODEL pick their models (COWORK_MODEL by default). A «claude-» model
// answers through Anthropic, so with Claude models alone no OpenAI key is needed; any other model needs OPENAI_API_KEY. The harness only decides
// when to hand over. --analyst (COWORK_ANALYST_MODEL), --artifacts (the Designer, COWORK_DESIGNER_MODEL) and --judge-in-turn (COWORK_JUDGE_MODEL)
// do the same for the Analyst, the Designer and the judge that reads the answer before it is delivered. Their calls count against --max-calls and
// their tokens are priced in the report («specialists»).
//
// Compare with the coordinator loop by running evaluate-cowork-conversations.ts with the same --cases and --repeat, and read both reports
// with the same rubric: pass rate of the corpus checks, calls, tokens, cost and seconds per case. Cases the harness hands back to the
// coordinator loop (a task resumed from its specialists, a question about a proposal) fail here on purpose: they are not the harness's.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { anthropicModel } from '../src/lib/agent-harness/anthropic';
import { addUsage, emptyUsage, type Effort, type ModelClient, type Usage } from '../src/lib/agent-harness/index';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkHarnessSettings } from '../src/lib/cowork/harness-config';
import { runCoworkWriter } from '../src/lib/cowork/writer';
import { isClaudeModel } from '../src/ai/anthropic-json';
import { COWORK_ANALYST_RULES, coworkAnalystOutputSchema, coworkAnalystPrompt } from '../src/lib/cowork/analyst';
import { coworkJudgeInstructions, coworkJudgeSchema, coworkJudgeTurnPrompt } from '../src/lib/cowork/judge';
import { coworkDesignerOutputSchema, runCoworkDesigner } from '../src/lib/server/cowork/designer';
import { coworkTimeZone } from '../src/lib/cowork/decision-context';
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '../src/lib/server/cowork/writer-run';
import { coworkReadCapabilities } from '../src/lib/server/cowork/read-capabilities';
import { selectCases } from './cowork-case-selection';
import { CORPUS } from './fixtures/cowork-full-corpus';
import { CORPUS_COMMON_CHECKS, CORPUS_NOW, type CorpusCase } from './fixtures/cowork-conversation-corpus';
import { runCorpusCase, type CorpusAnalyst, type CorpusDesigner, type CorpusJudge, type CorpusWriter } from './fixtures/cowork-conversation-runner';

/** Micro-USD per token, as the Oportunidades ledger prices them (workspace-ai.ts). */
const PRICES: Record<string, { input: number; output: number; cache: number; write: number }> = {
  'claude-haiku-5-5': { input: .1, output: .5, cache: .01, write: .2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache: .1, write: 4 },
  // List prices of 6 Oct 2026 (cache reads at a tenth of the input price, writes at 1.25×): estimates for the comparison, not the ledger's.
  'claude-opus-5-5': { input: 4, output: 20, cache: .4, write: 5 },
  'claude-fable-5-1': { input: 10, output: 50, cache: 1, write: 12.5 },
};

const costUsd = (usage: Usage, model: string) => {
  const price = PRICES[model];
  if (!price) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  // Each web search is billed on top of the tokens: 10 USD per thousand.
  return (fresh * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cache + usage.cacheWriteTokens * price.write) / 1_000_000
    + (usage.webSearches ?? 0) * 0.01;
};

async function main() {
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!process.argv.includes('--live') || !String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    throw new Error('Requires --live and an explicit ANTHROPIC_API_KEY. The offline check is scripts/cowork-conversation-corpus.test.ts.');
  }
  const maxCalls = Number(arg('max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000) throw new Error('Explicit --max-calls=1..1000 required');
  const repeat = Math.max(1, Math.min(5, Number(arg('repeat') || 1)));
  const settings = coworkHarnessSettings({ COWORK_RUNTIME: 'harness', ...(process.env as Record<string, string | undefined>) })!;
  const modelName = settings.model;
  const writerOn = process.argv.includes('--writer');
  const analystOn = process.argv.includes('--analyst');
  const artifactsOn = process.argv.includes('--artifacts');
  const judgeOn = process.argv.includes('--judge-in-turn');
  const writerModels = coworkWriterModels();
  const writerEfforts = coworkWriterEfforts();
  const writerCalls = { writer: 0, reviewer: 0 };
  const specialistModels = {
    analyst: process.env.COWORK_ANALYST_MODEL || process.env.COWORK_MODEL,
    designer: process.env.COWORK_DESIGNER_MODEL || process.env.COWORK_WRITER_MODEL || process.env.COWORK_MODEL,
    judge: process.env.COWORK_JUDGE_MODEL || process.env.COWORK_MODEL,
  };
  // Each specialist needs a model; a Claude one needs nothing else, any other the OpenAI key.
  const needed: Array<[string, string | undefined]> = [
    ...(writerOn ? [['--writer', writerModels.writer], ['--writer (reviewer)', writerModels.reviewer]] as Array<[string, string | undefined]> : []),
    ...(analystOn ? [['--analyst', specialistModels.analyst]] as Array<[string, string | undefined]> : []),
    ...(artifactsOn ? [['--artifacts', specialistModels.designer]] as Array<[string, string | undefined]> : []),
    ...(judgeOn ? [['--judge-in-turn', specialistModels.judge]] as Array<[string, string | undefined]> : []),
  ];
  for (const [flag, model] of needed) {
    if (!String(model || '').trim()) throw new Error(`${flag} needs a model: set COWORK_MODEL (or the model variable of that role).`);
    if (!isClaudeModel(model) && !String(process.env.OPENAI_API_KEY || '').trim()) throw new Error(`${flag} uses ${model}, which is not a Claude model: it needs OPENAI_API_KEY.`);
  }
  /** The tokens the specialists spent, by model, to price them next to the coordinator's (list prices; estimates). */
  const specialistTokens = new Map<string, { calls: number; input: number; output: number; cached: number }>();
  const tally = (model: string, telemetry: { usage?: any }) => {
    const row = specialistTokens.get(model) ?? { calls: 0, input: 0, output: 0, cached: 0 };
    row.calls += 1; row.input += Number(telemetry.usage?.prompt_tokens) || 0; row.output += Number(telemetry.usage?.completion_tokens) || 0;
    row.cached += Number(telemetry.usage?.prompt_tokens_details?.cached_tokens) || 0;
    specialistTokens.set(model, row);
  };
  const specialistCost = () => [...specialistTokens.entries()].reduce((sum, [model, row]) => {
    const price = PRICES[model];
    return price ? sum + ((row.input - row.cached) * price.input + row.cached * price.cache + row.output * price.output) / 1_000_000 : sum;
  }, 0);
  // --ask="..." runs one request of your own through the same turn, with the common checks, and prints the whole answer.
  const asked = arg('ask');
  if (asked) CORPUS.push({ id: 'ask', title: 'Pedido suelto', request: asked, checks: [...CORPUS_COMMON_CHECKS] } as CorpusCase);
  const selected = asked ? ['ask'] : selectCases(CORPUS, arg('cases')) || CORPUS.filter(entry => !entry.axis).map(entry => entry.id);
  const unknown = selected.filter(id => !CORPUS.some(entry => entry.id === id));
  if (unknown.length) throw new Error(`Unknown cases: ${unknown.join(', ')}`);

  // The model of the turn, counted: calls against the budget, tokens and time per case.
  let calls = 0;
  let current = { usage: emptyUsage(), calls: 0, modelMs: 0 };
  const base = anthropicModel({ model: modelName });
  const counted: ModelClient = {
    name: base.name,
    async complete(request) {
      if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted');
      calls += 1; current.calls += 1;
      const started = Date.now();
      // A provider that refuses a request ends the turn with a generic apology: the reason is worth reading in the evaluation.
      const response = await base.complete(request).catch(error => { console.error(`  ! ${base.name}: ${error instanceof Error ? error.message : error}`.slice(0, 400)); throw error; });
      current.modelMs += Date.now() - started;
      if (process.env.EVAL_DEBUG) console.error(`  · ${response.stopReason} ${response.content.map(block => block.type === 'text' ? `text«${block.text.slice(0, 80)}»` : block.type === 'tool_use' ? `tool_use ${block.name}` : block.type).join(', ')}`);
      current.usage = addUsage(current.usage, response.usage);
      return response;
    },
  };
  // The descriptors of the gateway's reads; nothing here runs them (the corpus answers every read from its fixtures).
  const capabilities = coworkReadCapabilities(null as never, { userId: 'corpus', organizationId: 'corpus' }).filter(capability => capability.effect === 'read');
  const effort: Effort = settings.effort;

  const outcomes: Array<Record<string, unknown>> = [];
  let total = emptyUsage();
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const id of selected) {
      const entry = CORPUS.find(item => item.id === id)!;
      current = { usage: emptyUsage(), calls: 0, modelMs: 0 };
      const started = Date.now();
      const budgeted = () => { if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted'); calls += 1; current.calls += 1; };
      const write: CorpusWriter | undefined = writerOn ? (brief, observations, meta) => runCoworkWriter({
        request: meta.request, brief, userContext: meta.userContext as { fullName?: string | null }, observations, step: meta.step, now: CORPUS_NOW,
        generate: async ({ role, schema, systemPrompt, prompt, fix }) => {
          budgeted(); writerCalls[role] += 1;
          const chosen = coworkWriterCallModel(brief.kind, role, fix, writerModels, writerEfforts);
          const response = await generateStructuredWithTelemetry({ schema, systemPrompt, prompt, provider: 'openai', openAiModel: chosen.model,
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: role === 'writer' ? 6000 : 1500, timeoutMs: 90000, reasoningEffort: chosen.effort });
          tally(String(chosen.model), response.telemetry);
          return response.data;
        },
      }) : undefined;
      // The judge that reads the answer before it is delivered, the Designer and the Analyst: as the worker wires them (judge.ts, designer.ts, analyst.ts).
      const judge: CorpusJudge | undefined = judgeOn ? async (answer, observations, meta) => {
        if (calls >= maxCalls) return null;
        budgeted();
        try {
          const response = await generateStructuredWithTelemetry({ schema: coworkJudgeSchema,
            systemPrompt: coworkJudgeInstructions({ contactsImport: Boolean(entry.contactsImport), replyThread: Boolean(entry.replyThread), linkedinBatch: Boolean(entry.linkedinBatch) }),
            prompt: coworkJudgeTurnPrompt({ request: meta.request, history: meta.history, userContext: meta.userContext, observations, answer, now: CORPUS_NOW }),
            provider: 'openai', openAiModel: specialistModels.judge, allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 1500, timeoutMs: 45000 });
          tally(String(specialistModels.judge), response.telemetry);
          return response.data;
        } catch (error) { console.warn('[judge-in-turn] failed:', error instanceof Error ? error.message : error); return null; }
      } : undefined;
      const design: CorpusDesigner | undefined = artifactsOn ? (brief, meta) => runCoworkDesigner({
        brief, request: meta.request, data: meta.data, previous: meta.previous, userContext: meta.userContext, generatedAt: CORPUS_NOW.toISOString(),
        generate: async ({ systemPrompt, prompt }) => {
          budgeted();
          const response = await generateStructuredWithTelemetry({ schema: coworkDesignerOutputSchema, systemPrompt, prompt, provider: 'openai', openAiModel: specialistModels.designer,
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 6000, timeoutMs: 60000 });
          tally(String(specialistModels.designer), response.telemetry);
          return response.data;
        },
      }) : undefined;
      const analyze: CorpusAnalyst | undefined = analystOn ? async (brief, observations, meta) => {
        budgeted();
        const response = await generateStructuredWithTelemetry({ schema: coworkAnalystOutputSchema, systemPrompt: COWORK_ANALYST_RULES.join('\n'),
          prompt: coworkAnalystPrompt({ request: meta.request, brief, userContext: meta.userContext, observations, history: meta.history, now: CORPUS_NOW, timeZone: coworkTimeZone() }),
          provider: 'openai', openAiModel: specialistModels.analyst, allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 4000, timeoutMs: 45000 });
        tally(String(specialistModels.analyst), response.telemetry);
        return response.data;
      } : undefined;
      const outcome = await runCorpusCase(entry, async () => { throw new Error('The coordinator loop must not run in harness mode'); },
        write, judge, design, analyze, undefined,
        turn => ({ model: counted, system: turn.system, context: turn.context, capabilities, effort, maxRounds: settings.maxRounds, maxReads: settings.maxReads, deadlineMs: 80_000,
          // COWORK_WEB_ENABLED=true: the agent can search the web and read pages (each search costs 0.01 USD, counted in the report).
          ...(settings.web ? { web: settings.web } : {}) }));
      total = addUsage(total, current.usage);
      const failedChecks = outcome.checks.filter(check => !check.passed).map(check => check.label);
      outcomes.push({ id, attempt, passed: outcome.passed, failedChecks, failed: outcome.result.failed, actions: outcome.result.actions, proposal: outcome.result.proposal?.kind ?? null,
        reply: outcome.result.reply.slice(0, 600), question: outcome.result.question ?? null, suggestions: (outcome.result.suggestions ?? []).map(chip => chip.label),
        calls: current.calls, seconds: Math.round((Date.now() - started) / 100) / 10, modelSeconds: Math.round(current.modelMs / 100) / 10,
        usage: current.usage, costUsd: costUsd(current.usage, modelName) });
      if (asked) console.log(`\n${outcome.result.reply}\n${outcome.result.question ? `\n¿${outcome.result.question}\n` : ''}${(outcome.result.suggestions ?? []).map(chip => `  [${chip.label}]`).join('')}\nacciones: ${outcome.result.actions.join(', ') || '—'}\n`);
      console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${id}#${attempt} ${current.calls} calls ${Math.round((Date.now() - started) / 100) / 10}s${failedChecks.length ? ` — ${failedChecks.join('; ').slice(0, 200)}` : ''}`);
    }
  }
  const passed = outcomes.filter(item => item.passed).length;
  const report = {
    runtime: 'harness', model: modelName, effort, selected, repeat, rubric: 'cowork-corpus-checks',
    writer: writerOn ? { ...writerCalls, writer: writerModels.writer, reviewer: writerModels.reviewer } : null,
    specialists: { analyst: analystOn ? specialistModels.analyst : null, designer: artifactsOn ? specialistModels.designer : null, judge: judgeOn ? specialistModels.judge : null,
      tokens: Object.fromEntries(specialistTokens), costUsd: specialistTokens.size ? Math.round(specialistCost() * 1000) / 1000 : 0 },
    passed, total: outcomes.length, passRate: outcomes.length ? Math.round((passed / outcomes.length) * 1000) / 10 : null,
    calls, usage: total, costUsd: costUsd(total, modelName), outcomes,
  };
  console.log(`\n${passed}/${outcomes.length} cases passed (${report.passRate}%), ${calls} calls, ${total.inputTokens} input and ${total.outputTokens} output tokens${report.costUsd === null ? '' : `, about ${report.costUsd.toFixed(2)} USD`}`);
  const output = arg('output');
  if (output) {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(path.resolve(output), JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

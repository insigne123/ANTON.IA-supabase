// Real Claude, the harness runtime (COWORK_RUNTIME=harness), the same corpus and the same checks as evaluate-cowork-conversations.ts:
// the way to measure the coordinator that has run until now against the one that works with tools, case by case.
// Explicit opt-in only. Never loads env files, touches the database or calls any provider but Anthropic's.
//
//   ANTHROPIC_API_KEY=... COWORK_HARNESS_MODEL=claude-sonnet-5-5 \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-harness.ts --live --max-calls=120 [--cases=a,b|axis-*] [--repeat=2] [--output=file.json] [--writer]
//
// --writer hands writing to the Writer and the Reviewer (writer.ts), as COWORK_WRITER_ENABLED does in production and as --writer does in
// evaluate-cowork-conversations.ts: they run on OpenAI with COWORK_MODEL (COWORK_WRITER_MODEL / COWORK_REVIEWER_MODEL pick theirs), so it needs
// OPENAI_API_KEY too, and the harness only decides when to hand over. Their calls count against --max-calls.
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
import { coworkWriterCallModel, coworkWriterEfforts, coworkWriterModels } from '../src/lib/server/cowork/writer-run';
import { coworkReadCapabilities } from '../src/lib/server/cowork/read-capabilities';
import { selectCases } from './cowork-case-selection';
import { CORPUS } from './fixtures/cowork-full-corpus';
import { CORPUS_NOW } from './fixtures/cowork-conversation-corpus';
import { runCorpusCase, type CorpusWriter } from './fixtures/cowork-conversation-runner';

/** Micro-USD per token, as the Oportunidades ledger prices them (workspace-ai.ts). */
const PRICES: Record<string, { input: number; output: number; cache: number; write: number }> = {
  'claude-haiku-5-5': { input: .1, output: .5, cache: .01, write: .2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache: .1, write: 4 },
};

const costUsd = (usage: Usage, model: string) => {
  const price = PRICES[model];
  if (!price) return null;
  const fresh = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  return (fresh * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cache + usage.cacheWriteTokens * price.write) / 1_000_000;
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
  if (writerOn && (!String(process.env.OPENAI_API_KEY || '').trim() || !String(process.env.COWORK_MODEL || '').trim())) throw new Error('--writer needs OPENAI_API_KEY and COWORK_MODEL for the Writer and the Reviewer.');
  const writerModels = coworkWriterModels();
  const writerEfforts = coworkWriterEfforts();
  const writerCalls = { writer: 0, reviewer: 0 };
  const selected = selectCases(CORPUS, arg('cases')) || CORPUS.filter(entry => !entry.axis).map(entry => entry.id);
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
      const response = await base.complete(request);
      current.modelMs += Date.now() - started;
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
      const write: CorpusWriter | undefined = writerOn ? (brief, observations, meta) => runCoworkWriter({
        request: meta.request, brief, userContext: meta.userContext as { fullName?: string | null }, observations, step: meta.step, now: CORPUS_NOW,
        generate: async ({ role, schema, systemPrompt, prompt, fix }) => {
          if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted');
          calls += 1; current.calls += 1; writerCalls[role] += 1;
          const chosen = coworkWriterCallModel(brief.kind, role, fix, writerModels, writerEfforts);
          const response = await generateStructuredWithTelemetry({ schema, systemPrompt, prompt, provider: 'openai', openAiModel: chosen.model,
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: role === 'writer' ? 6000 : 1500, timeoutMs: 90000, reasoningEffort: chosen.effort });
          return response.data;
        },
      }) : undefined;
      const outcome = await runCorpusCase(entry, async () => { throw new Error('The coordinator loop must not run in harness mode'); },
        write, undefined, undefined, undefined, undefined,
        turn => ({ model: counted, system: turn.system, context: turn.context, capabilities, effort, maxRounds: settings.maxRounds, maxReads: settings.maxReads, deadlineMs: 80_000 }));
      total = addUsage(total, current.usage);
      const failedChecks = outcome.checks.filter(check => !check.passed).map(check => check.label);
      outcomes.push({ id, attempt, passed: outcome.passed, failedChecks, failed: outcome.result.failed, actions: outcome.result.actions, proposal: outcome.result.proposal?.kind ?? null,
        reply: outcome.result.reply.slice(0, 600), calls: current.calls, seconds: Math.round((Date.now() - started) / 100) / 10, modelSeconds: Math.round(current.modelMs / 100) / 10,
        usage: current.usage, costUsd: costUsd(current.usage, modelName) });
      console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${id}#${attempt} ${current.calls} calls ${Math.round((Date.now() - started) / 100) / 10}s${failedChecks.length ? ` — ${failedChecks.join('; ').slice(0, 200)}` : ''}`);
    }
  }
  const passed = outcomes.filter(item => item.passed).length;
  const report = {
    runtime: 'harness', model: modelName, effort, selected, repeat, rubric: 'cowork-corpus-checks', writer: writerOn ? { ...writerCalls, model: process.env.COWORK_MODEL } : null,
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

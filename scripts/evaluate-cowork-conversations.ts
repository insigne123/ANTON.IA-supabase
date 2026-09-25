// Real model, real loop, fixture tools: replays the production conversation
// corpus (scripts/fixtures/cowork-conversation-corpus.ts) against the
// configured model and scores each turn with the corpus checks.
// Explicit opt-in only. Never loads env files, touches the database or calls providers.
//
//   OPENAI_API_KEY=... COWORK_MODEL=gpt-6-luna \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=80 [--cases=a,b] [--repeat=2] [--output=file.json]
//
// To compare prompts, run it on the previous commit and on this one with the same flags.
import { writeFileSync } from 'node:fs';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';
import { coworkAnswerIssues } from '../src/lib/cowork/answer-quality';
import { CORPUS } from './fixtures/cowork-conversation-corpus';
import { corpusInstructions, runCorpusCase, type CorpusOutcome } from './fixtures/cowork-conversation-runner';

async function main() {
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY || !process.env.COWORK_MODEL) {
    throw new Error('Requires --live and explicit OPENAI_API_KEY/COWORK_MODEL. The offline check is scripts/cowork-conversation-corpus.test.ts.');
  }
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const selected = arg('cases')?.split(',').filter(Boolean) || CORPUS.map(entry => entry.id);
  const unknown = selected.filter(id => !CORPUS.some(entry => entry.id === id));
  if (unknown.length) throw new Error(`Unknown cases: ${unknown.join(', ')}`);
  const repeat = Math.max(1, Math.min(5, Number(arg('repeat') || 1)));
  const maxCalls = Number(arg('max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 400) throw new Error('Explicit --max-calls=1..400 required');

  let calls = 0;
  const usage: unknown[] = [];
  const outcomes: Array<CorpusOutcome & { attempt: number; seconds: number; decisions: unknown[]; issues: string[] }> = [];
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const id of selected) {
      const entry = CORPUS.find(item => item.id === id)!;
      const decisions: unknown[] = [];
      const started = Date.now();
      const outcome = await runCorpusCase(entry, async context => {
        if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted');
        calls++;
        // Same schema as production; the wrapper only keeps the raw decision so a
        // rejected one (the loop retries it) can still be read in the report.
        let raw: unknown = null;
        const schema = Object.assign(Object.create(coworkDecisionSchema), {
          parse: (value: unknown) => { raw = value; return coworkDecisionSchema.parse(value); },
        }) as typeof coworkDecisionSchema;
        let response: Awaited<ReturnType<typeof generateStructuredWithTelemetry<typeof coworkDecisionSchema>>>;
        try {
          response = await generateStructuredWithTelemetry({
            schema,
            systemPrompt: `${corpusInstructions.systemPrompt}\nspecialists.review está deshabilitado.`,
            prompt: JSON.stringify(context), provider: 'openai', openAiModel: process.env.COWORK_MODEL,
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 6000, timeoutMs: 45000,
          });
        } catch (error) {
          const issues = (error as { issues?: Array<{ path?: unknown[]; message?: string }> }).issues;
          if (Array.isArray(issues)) decisions.push({ rejected: issues.map(issue => `${(issue.path || []).join('.')}: ${issue.message}`), raw });
          throw error;
        }
        usage.push(coworkModelUsage(response.telemetry));
        decisions.push({ action: response.data.action, reads: response.data.reads ?? null, query: response.data.query,
          leadId: response.data.leadId, answer: response.data.answer, searchCriteria: response.data.searchCriteria ?? null });
        return response.data;
      });
      const shown = outcome.result.note && (outcome.result.proposal || outcome.result.search) ? outcome.result.note : outcome.result.reply;
      outcomes.push({ ...outcome, attempt, seconds: Math.round((Date.now() - started) / 100) / 10, decisions,
        issues: coworkAnswerIssues(shown, { expectNextStep: !(outcome.result.proposal || outcome.result.search) }).map(issue => issue.detail) });
      if (calls >= maxCalls) break;
    }
  }

  const checks = outcomes.flatMap(outcome => outcome.checks);
  const summary = {
    model: process.env.COWORK_MODEL, calls, cases: outcomes.length,
    casesPassed: outcomes.filter(outcome => outcome.passed).length,
    checksPassed: `${checks.filter(check => check.passed).length}/${checks.length}`,
    failedRuns: outcomes.filter(outcome => outcome.result.failed).length,
    answersWithIssues: outcomes.filter(outcome => outcome.issues.length).length,
  };
  const report = { mode: 'real_model_real_loop_corpus_tools', summary, usage, outcomes,
    limitation: 'Fixture tools copied from one production workspace; lexical checks screen behavior and need a human read of the replies.' };
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  for (const outcome of outcomes) {
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${outcome.id}${repeat > 1 ? ` #${outcome.attempt}` : ''} (${outcome.seconds}s)${failing.length ? ` · ${failing.join('; ')}` : ''}`);
  }
  if (summary.casesPassed !== summary.cases) process.exitCode = 1;
}

main().catch(error => {
  // Bounded category only; never print provider headers or credentials.
  const message = error instanceof Error ? error.message : '';
  console.error(`Evaluation stopped: ${message.match(/^(Requires --live[^.]*|Unknown cases: [\w,-]+|Explicit --max-calls=1\.\.400 required|Evaluation call budget exhausted)/)?.[0] || 'configuration or provider error'}`);
  process.exitCode = 1;
});

// Real model, real loop, fixture tools: replays the production conversation
// corpus (scripts/fixtures/cowork-conversation-corpus.ts) against the
// configured model and scores each turn with the corpus checks.
// Explicit opt-in only. Never loads env files, touches the database or calls providers.
//
//   OPENAI_API_KEY=... COWORK_MODEL=gpt-6-luna \
//   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=80 [--cases=a,b] [--repeat=2] [--output=file.json] [--stream]
//
// --stream asks the model to stream, as the worker does with COWORK_STREAMING_ENABLED, and
// reports how long each answer took to show its first words against its whole call.
//
// --writer turns on the Writer and the Reviewer (writer.ts), as COWORK_WRITER_ENABLED does:
// the coordinator hands writing to them. COWORK_WRITER_MODEL and COWORK_REVIEWER_MODEL pick
// their models (COWORK_MODEL by default).
//
// --judge-in-turn turns on the judge in the turn (judge.ts, G2), as COWORK_JUDGE_ENABLED does:
// it reads the coordinator's final answer and asks for one correction when it is worth it.
// COWORK_JUDGE_MODEL picks its model (COWORK_MODEL by default); grade the result with
// judge-cowork-conversations.ts and a different --judge-model.
//
// --contacts-import turns on contacts.import in every case (F4), as COWORK_CONTACTS_IMPORT_ENABLED
// does; the cases marked contactsImport have it on anyway. The judges read the same flag.
// With --stream the report also says how many answers the person would have seen replaced on screen
// (the first answer streamed, then corrected: replacedOnScreen) and how long a turn takes until its
// answer is final, apart for clean and corrected ones (revealSeconds): with COWORK_ANSWER_HOLD_ENABLED
// nobody sees the first answer, and the answer shows once, at that time.
//
// To compare prompts, run it on the previous commit and on this one with the same flags.
import { writeFileSync } from 'node:fs';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';
import { coworkAnswerIssues } from '../src/lib/cowork/answer-quality';
import { coworkAnswerChanged } from '../src/lib/cowork/presentation';
import { coworkLiveDraft } from '../src/lib/cowork/partial-json';
import { runCoworkWriter } from '../src/lib/cowork/writer';
import { coworkJudgeInstructions, coworkJudgeSchema, coworkJudgeTurnPrompt } from '../src/lib/cowork/judge';
import { CORPUS as PRODUCTION_CORPUS, CORPUS_NOW } from './fixtures/cowork-conversation-corpus';
import { EDIT_CORPUS, FILE_CORPUS, MARKETING_CORPUS, STARTER_CORPUS } from './fixtures/cowork-marketing-corpus';
import { corpusInstructions, corpusWriterInstructions, runCorpusCase, type CorpusJudge, type CorpusOutcome, type CorpusWriter } from './fixtures/cowork-conversation-runner';

// Production conversations first, then the marketing use cases (email and LinkedIn)
// and every button on the Cowork home.
const CORPUS = [...PRODUCTION_CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS, ...EDIT_CORPUS, ...FILE_CORPUS];

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

  const stream = process.argv.includes('--stream');
  const writerOn = process.argv.includes('--writer');
  const writerModels = { writer: process.env.COWORK_WRITER_MODEL || process.env.COWORK_MODEL, reviewer: process.env.COWORK_REVIEWER_MODEL || process.env.COWORK_MODEL };
  const writerCalls = { writer: 0, reviewer: 0 };
  const judgeOn = process.argv.includes('--judge-in-turn');
  const importOn = process.argv.includes('--contacts-import');
  const judgeModel = process.env.COWORK_JUDGE_MODEL || process.env.COWORK_MODEL;
  let judgeCalls = 0;
  const answerTimings: Array<{ firstTextMs: number | null; totalMs: number }> = [];
  let calls = 0;
  const usage: unknown[] = [];
  const outcomes: Array<CorpusOutcome & { attempt: number; seconds: number; decisions: unknown[]; issues: string[]; contactsImport: boolean }> = [];
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const id of selected) {
      const found = CORPUS.find(item => item.id === id)!;
      const entry = importOn ? { ...found, contactsImport: true } : found;
      const decisions: unknown[] = [];
      const started = Date.now();
      // The Writer and the Reviewer, with their own models and the same call budget.
      const write: CorpusWriter | undefined = writerOn ? (brief, observations, meta) => runCoworkWriter({
        request: meta.request, brief, userContext: meta.userContext as { fullName?: string | null }, observations, step: meta.step,
        generate: async ({ role, schema, systemPrompt, prompt }) => {
          if (calls >= maxCalls) throw new Error('Evaluation call budget exhausted');
          calls++;
          writerCalls[role]++;
          const response = await generateStructuredWithTelemetry({ schema, systemPrompt, prompt, provider: 'openai', openAiModel: writerModels[role],
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: role === 'writer' ? 6000 : 1500, timeoutMs: 45000 });
          usage.push(coworkModelUsage(response.telemetry));
          decisions.push({ agent: role, output: response.data });
          return response.data;
        },
      }) : undefined;
      // The judge in the turn, with its own model and the same call budget.
      const judgeInTurn: CorpusJudge | undefined = judgeOn ? async (answer, observations, meta) => {
        if (calls >= maxCalls) return null;
        calls++;
        judgeCalls++;
        try {
          const response = await generateStructuredWithTelemetry({ schema: coworkJudgeSchema, systemPrompt: coworkJudgeInstructions({ contactsImport: Boolean(entry.contactsImport), inTurn: true }),
            prompt: coworkJudgeTurnPrompt({ request: meta.request, history: meta.history, userContext: meta.userContext, observations, answer, now: CORPUS_NOW }),
            provider: 'openai', openAiModel: judgeModel, allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 1500, timeoutMs: 45000 });
          usage.push(coworkModelUsage(response.telemetry));
          decisions.push({ agent: 'judge', output: response.data });
          return response.data;
        } catch (error) {
          console.warn('[judge-in-turn] failed:', error instanceof Error ? error.message : error);
          return null;
        }
      } : undefined;
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
        const callStarted = Date.now();
        let firstTextMs: number | null = null;
        let lastPeek = 0;
        try {
          response = await generateStructuredWithTelemetry({
            schema,
            systemPrompt: `${(writerOn ? corpusWriterInstructions : corpusInstructions).systemPrompt}\nspecialists.review está deshabilitado.`,
            prompt: JSON.stringify(context), provider: 'openai', openAiModel: process.env.COWORK_MODEL,
            allowDefaultModelFallback: false, maxAttempts: 1, maxOutputTokens: 6000, timeoutMs: 45000,
            // First words of an answer as the page would get them: read at most every 50 ms.
            ...(stream ? { onPartial: (text: string) => {
              if (firstTextMs !== null || Date.now() - lastPeek < 50) return;
              lastPeek = Date.now();
              if (coworkLiveDraft(text)) firstTextMs = Date.now() - callStarted;
            } } : {}),
          });
        } catch (error) {
          const issues = (error as { issues?: Array<{ path?: unknown[]; message?: string }> }).issues;
          if (Array.isArray(issues)) decisions.push({ rejected: issues.map(issue => `${(issue.path || []).join('.')}: ${issue.message}`), raw });
          throw error;
        }
        usage.push(coworkModelUsage(response.telemetry));
        if (stream && response.data.action === 'answer') answerTimings.push({ firstTextMs, totalMs: Date.now() - callStarted });
        decisions.push({ action: response.data.action, reads: response.data.reads ?? null, query: response.data.query,
          leadId: response.data.leadId, answer: response.data.answer, searchCriteria: response.data.searchCriteria ?? null,
          outline: response.data.outline ?? null });
        return response.data;
      }, write, judgeInTurn);
      const shown = outcome.result.note && (outcome.result.proposal || outcome.result.search) ? outcome.result.note : outcome.result.reply;
      outcomes.push({ ...outcome, attempt, contactsImport: Boolean(entry.contactsImport), seconds: Math.round((Date.now() - started) / 100) / 10, decisions,
        issues: coworkAnswerIssues(shown, { expectNextStep: !(outcome.result.proposal || outcome.result.search) }).map(issue => issue.detail) });
      if (calls >= maxCalls) break;
    }
  }

  const checks = outcomes.flatMap(outcome => outcome.checks);
  const summary = {
    model: process.env.COWORK_MODEL, calls, cases: outcomes.length,
    ...(importOn ? { contactsImport: 'all cases' } : {}),
    // With --writer: how many answers the Writer wrote, and how many calls it and the Reviewer made.
    ...(writerOn ? { writer: { models: writerModels, calls: writerCalls,
      answers: outcomes.filter(outcome => outcome.result.writer).length,
      corrected: outcomes.filter(outcome => (outcome.result.writer?.steps || []).some(step => step.agent === 'reviewer' && step.state === 'done' && (step.changes || []).length > 0)).length } } : {}),
    // With --judge-in-turn: how many answers it read, how many it asked to fix and how many changed.
    ...(judgeOn ? { judgeInTurn: { model: judgeModel, calls: judgeCalls,
      judged: outcomes.filter(outcome => outcome.result.judgeInTurn).length,
      asked: outcomes.filter(outcome => outcome.result.judgeInTurn?.asked).length,
      fixed: outcomes.filter(outcome => outcome.result.judgeInTurn?.fixed).length,
      // A correction that was not one (empty, the same words, a figure without support): the first answer stood.
      keptFirst: outcomes.filter(outcome => outcome.result.judgeInTurn?.kept === 'first').length,
      keptFirstReasons: outcomes.flatMap(outcome => outcome.result.judgeInTurn?.kept === 'first' ? [String(outcome.result.judgeInTurn.keptReason)] : []) } } : {}),
    casesPassed: outcomes.filter(outcome => outcome.passed).length,
    checksPassed: `${checks.filter(check => check.passed).length}/${checks.length}`,
    failedRuns: outcomes.filter(outcome => outcome.result.failed).length,
    // Fewer reads and model calls per case mean faster turns with the same answer.
    readsPerCase: Math.round(outcomes.reduce((sum, outcome) => sum + outcome.result.actions.length, 0) / Math.max(1, outcomes.length) * 100) / 100,
    callsPerCase: Math.round(calls / Math.max(1, outcomes.length) * 100) / 100,
    answersWithIssues: outcomes.filter(outcome => outcome.issues.length).length,
    answersWithSuggestions: `${outcomes.filter(outcome => outcome.result.suggestions?.length).length}/${outcomes.filter(outcome => !outcome.result.proposal && !outcome.result.search && !outcome.result.failed).length}`,
    // The plan the person sees while it works: shown when the turn consults, and each
    // planned read actually run (a plan that promises what never happens misleads).
    plansShown: `${outcomes.filter(outcome => outcome.result.plan).length}/${outcomes.filter(outcome => outcome.result.actions.length).length}`,
    // The plan belongs to the first consulting decision: any later one is wasted output.
    laterOutlines: outcomes.reduce((sum, outcome) => sum + outcome.decisions.slice(1)
      .filter(decision => Array.isArray((decision as { outline?: unknown }).outline)).length, 0),
    // With --stream: when an answering call showed its first words, against its whole length (ms).
    ...(stream ? { answerTimings: (() => {
      const pick = (values: number[], at: number) => values.length ? values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * at))] : null;
      const first = answerTimings.flatMap(item => item.firstTextMs === null ? [] : [item.firstTextMs]);
      const total = answerTimings.map(item => item.totalMs);
      return { answers: answerTimings.length, withEarlyText: first.length, firstTextP50: pick([...first], 0.5), firstTextP90: pick([...first], 0.9),
        totalP50: pick([...total], 0.5), totalP90: pick([...total], 0.9) };
    })() } : {}),
    // With --stream: what the person would see happen to an answer without COWORK_ANSWER_HOLD_ENABLED, and
    // how long a turn takes until its answer is final (with the hold, when it shows), clean against corrected.
    ...(stream ? { replacedOnScreen: (() => {
      const answered = outcomes.filter(outcome => !outcome.result.failed && outcome.result.answers?.length);
      const corrected = answered.filter(outcome => (outcome.result.answers?.length ?? 0) > 1 || outcome.result.judgeInTurn?.fixed);
      const seconds = (list: typeof outcomes) => {
        const sorted = list.map(outcome => outcome.seconds).sort((a, b) => a - b);
        const at = (fraction: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null;
        return { n: sorted.length, p50: at(0.5), p90: at(0.9) };
      };
      return {
        answers: answered.length,
        corrected: corrected.length,
        // The first answer streamed and a correction gave a different final one: the text changed under the reader.
        replacedOnScreen: answered.filter(outcome => (outcome.result.answers?.length ?? 0) > 1 && coworkAnswerChanged(outcome.result.answers![0], outcome.result.reply)).length,
        revealSeconds: { clean: seconds(answered.filter(outcome => !corrected.includes(outcome))), corrected: seconds(corrected) },
      };
    })() } : {}),
    plannedReadsRun: (() => {
      const planned = outcomes.flatMap(outcome => (outcome.result.plan || []).filter(step => step.read).map(step => outcome.result.actions.includes(String(step.read))));
      return `${planned.filter(Boolean).length}/${planned.length}`;
    })(),
  };
  const report = { mode: 'real_model_real_loop_corpus_tools', summary, usage, outcomes,
    limitation: 'Fixture tools copied from one production workspace; lexical checks screen behavior and need a human read of the replies.' };
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  for (const outcome of outcomes) {
    const failing = outcome.checks.filter(check => !check.passed).map(check => check.label);
    console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${outcome.id}${repeat > 1 ? ` #${outcome.attempt}` : ''} (${outcome.seconds}s)${failing.length ? ` · ${failing.join('; ')}` : ''}`);
    if (outcome.result.plan) console.log(`     ☐ ${outcome.result.plan.map(step => `${step.label}${step.read ? ` (${step.read})` : ''}`).join(' → ')}`);
    if (outcome.result.suggestions?.length) console.log(`     ↳ ${outcome.result.suggestions.map(chip => `[${chip.label}]`).join(' ')}`);
  }
  if (summary.casesPassed !== summary.cases) process.exitCode = 1;
}

main().catch(error => {
  // Bounded category only; never print provider headers or credentials.
  const message = error instanceof Error ? error.message : '';
  console.error(`Evaluation stopped: ${message.match(/^(Requires --live[^.]*|Unknown cases: [\w,-]+|Explicit --max-calls=1\.\.400 required|Evaluation call budget exhausted)/)?.[0] || 'configuration or provider error'}`);
  process.exitCode = 1;
});

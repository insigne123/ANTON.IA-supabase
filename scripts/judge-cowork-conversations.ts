// LLM-as-judge over Cowork answers (plan 2.2), offline only. A model other than the
// one that writes grades each answer of an evaluation report with the fixed rubric in
// src/lib/cowork/judge.ts, or, with --calibrate, the production answers people already
// scored, to see how far the judge is from them before trusting its grades.
// Explicit opt-in only. Never loads env files, touches the database or calls providers
// other than the judge model.
//
//   OPENAI_API_KEY=... COWORK_MODEL=gpt-6-luna \
//   node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts --live --judge-model=gpt-6-sol \
//     (--calibrate [--repeat=2] | --input=report.json [--cases=a,b]) --max-calls=120 [--output=judged.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { THREAD_AGENDA_CORPUS, THREAD_CORPUS, THREAD_SEND_AGENDA_CORPUS, THREAD_SEND_CORPUS } from './fixtures/cowork-thread-corpus';
import { AGENDA_CORPUS } from './fixtures/cowork-agenda-corpus';
import { WEB_CORPUS } from './fixtures/cowork-web-corpus';
import { LECTURAS_CORPUS } from './fixtures/cowork-lecturas-corpus';
import { BATCH_CORPUS } from './fixtures/cowork-batch-corpus';
import { generateStructuredWithTelemetry } from '../src/ai/openai-json';
import {
  COWORK_JUDGE_DIMENSIONS, COWORK_JUDGE_INSTRUCTIONS, COWORK_JUDGE_NOW_RULE, coworkJudgeAgreement, coworkJudgeInstructions, coworkJudgePrompt, coworkJudgeSchema, coworkJudgeSummary,
  type CoworkJudgement,
} from '../src/lib/cowork/judge';
import { CORPUS as PRODUCTION_CORPUS, CORPUS_NOW, CORPUS_USER_CONTEXT, type CorpusCase, type CorpusTurnResult } from './fixtures/cowork-conversation-corpus';
import { EDIT_CORPUS, FILE_CORPUS, MARKETING_CORPUS, STARTER_CORPUS } from './fixtures/cowork-marketing-corpus';
import { AXIS_CORPUS } from './fixtures/cowork-axis-paquete';
import { AXIS_REST_CORPUS } from './fixtures/cowork-axis-resto';
import { AXIS_REFERENCE_INSTRUCTIONS, axisReferencePrompt, axisReferenceSchema, axisReferenceSummary, type AxisReference } from './fixtures/cowork-axis-judge';
import { JUDGE_CALIBRATION } from './fixtures/cowork-judge-calibration';
import { corpusObservations, corpusShownAnswer } from './fixtures/cowork-conversation-runner';

const CORPUS: CorpusCase[] = [...PRODUCTION_CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS, ...EDIT_CORPUS, ...FILE_CORPUS, ...AXIS_CORPUS, ...AXIS_REST_CORPUS];

async function main() {
  // Answering someone who wrote (scripts/fixtures/cowork-thread-corpus.ts).
  CORPUS.push(...THREAD_CORPUS, ...THREAD_AGENDA_CORPUS, ...THREAD_SEND_CORPUS, ...THREAD_SEND_AGENDA_CORPUS, ...BATCH_CORPUS);
  // «¿Qué toca hoy?» (scripts/fixtures/cowork-agenda-corpus.ts).
  CORPUS.push(...AGENDA_CORPUS, ...WEB_CORPUS, ...LECTURAS_CORPUS);
  if (!process.argv.includes('--live') || !process.env.OPENAI_API_KEY) throw new Error('Requires --live and an explicit OPENAI_API_KEY.');
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const judgeModel = arg('judge-model') || process.env.COWORK_JUDGE_MODEL || '';
  // A judge grading its own writing is lenient with itself.
  if (!judgeModel || judgeModel === process.env.COWORK_MODEL) throw new Error('Requires --judge-model different from COWORK_MODEL.');
  const maxCalls = Number(arg('max-calls'));
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 400) throw new Error('Explicit --max-calls=1..400 required');
  let calls = 0;
  const judge = async (prompt: string, systemPrompt = COWORK_JUDGE_INSTRUCTIONS): Promise<CoworkJudgement | null> => {
    if (calls >= maxCalls) return null;
    calls++;
    try {
      const response = await generateStructuredWithTelemetry({ schema: coworkJudgeSchema, systemPrompt, prompt,
        openAiModel: judgeModel, allowDefaultModelFallback: false, provider: 'openai', maxAttempts: 2, timeoutMs: 60000, maxOutputTokens: 1200 });
      return response.data;
    } catch (error) {
      console.warn('[judge] failed:', error instanceof Error ? error.message : error);
      return null;
    }
  };

  // The AXIS cases also get compared with what the previous AI had to do and achieved (cowork-axis-judge.ts).
  const reference = async (prompt: string): Promise<AxisReference | null> => {
    if (calls >= maxCalls) return null;
    calls++;
    try {
      const response = await generateStructuredWithTelemetry({ schema: axisReferenceSchema, systemPrompt: AXIS_REFERENCE_INSTRUCTIONS, prompt,
        openAiModel: judgeModel, allowDefaultModelFallback: false, provider: 'openai', maxAttempts: 2, timeoutMs: 60000, maxOutputTokens: 800 });
      return response.data;
    } catch (error) {
      console.warn('[judge] reference failed:', error instanceof Error ? error.message : error);
      return null;
    }
  };

  let report: Record<string, unknown>;
  if (process.argv.includes('--calibrate')) {
    const repeat = Math.max(1, Math.min(3, Number(arg('repeat') || 1)));
    const rows: Array<{ id: string; attempt: number; human: Record<string, number>; judge: CoworkJudgement['scores'] | null; problemas: string[] }> = [];
    for (let attempt = 1; attempt <= repeat; attempt++) {
      for (const item of JUDGE_CALIBRATION) {
        const judgement = await judge(coworkJudgePrompt({ request: item.request, observations: [item.facts], userContext: null, shown: { reply: item.reply } }));
        rows.push({ id: item.id, attempt, human: item.human, judge: judgement?.scores ?? null, problemas: judgement?.problemas ?? [] });
        console.log(`${item.id} #${attempt} · personas ${COWORK_JUDGE_DIMENSIONS.map(dimension => item.human[dimension]).join('/')} · juez ${judgement ? COWORK_JUDGE_DIMENSIONS.map(dimension => judgement.scores[dimension]).join('/') : 'sin respuesta'}`);
      }
    }
    const pairs = rows.flatMap(row => row.judge ? [{ human: row.human, judge: row.judge }] : []);
    report = { mode: 'calibration', judgeModel, calls, agreement: coworkJudgeAgreement(pairs), rows };
  } else {
    const input = arg('input');
    if (!input) throw new Error('Requires --input=report.json (an evaluate-cowork-conversations output) or --calibrate.');
    const source = JSON.parse(readFileSync(input, 'utf8')) as { outcomes: Array<{ id: string; attempt: number; passed: boolean; result: CorpusTurnResult; contactsImport?: boolean; replyThread?: boolean; linkedinBatch?: boolean }> };
    const selected = arg('cases')?.split(',').filter(Boolean);
    const rows: Array<{ id: string; attempt: number; passedChecks: boolean; judgement: CoworkJudgement | null;
      reference?: AxisReference | null; op?: string; block?: string; capability?: string; star?: boolean }> = [];
    for (const outcome of source.outcomes) {
      if (selected && !selected.includes(outcome.id)) continue;
      const entry = CORPUS.find(item => item.id === outcome.id);
      if (!entry) continue;
      // The rules of the turn as it ran: contacts.import, email.reply_thread and the LinkedIn batches on or off (in older reports, as the case says).
      // The worlds of the bank run on their own clock (the 25th), not on the day the judge runs: it reads the same date the coordinator did.
      const rules = [coworkJudgeInstructions({ contactsImport: outcome.contactsImport ?? Boolean(entry.contactsImport), replyThread: outcome.replyThread ?? Boolean(entry.replyThread), linkedinBatch: outcome.linkedinBatch ?? Boolean(entry.linkedinBatch) }), COWORK_JUDGE_NOW_RULE].join('\n');
      const userContext = entry.world?.userContext === undefined ? CORPUS_USER_CONTEXT : entry.world.userContext;
      const observations = corpusObservations(entry, outcome.result);
      const shown = corpusShownAnswer(outcome.result);
      const judgement = await judge(coworkJudgePrompt({
        request: entry.request,
        history: (entry.history || []).map(turn => ({ request: turn.request, reply: turn.reply, observations: turn.observations })),
        userContext, observations, shown, now: CORPUS_NOW,
      }), rules);
      const compared = entry.axis ? await reference(axisReferencePrompt(entry, { shown, observations, userContext })) : undefined;
      rows.push({ id: outcome.id, attempt: outcome.attempt, passedChecks: outcome.passed, judgement,
        ...(entry.axis ? { reference: compared ?? null, op: entry.axis.op, block: entry.axis.block, capability: entry.axis.capability, star: Boolean(entry.axis.star) } : {}) });
      if (judgement) console.log(`${outcome.passed ? 'PASS' : 'FAIL'} ${outcome.id} #${outcome.attempt} · ${COWORK_JUDGE_DIMENSIONS.map(dimension => judgement.scores[dimension]).join('/')} · ${judgement.veredicto}${judgement.problemas.length ? ` · ${judgement.problemas.join(' | ')}` : ''}${compared ? ` · frente a la IA anterior: ${compared.veredicto} (${compared.motivo})` : ''}`);
    }
    const judged = rows.flatMap(row => row.judgement ? [row] : []);
    report = {
      mode: 'report', judgeModel, source: input, calls,
      summary: coworkJudgeSummary(judged.map(row => row.judgement!)),
      passedChecks: coworkJudgeSummary(judged.filter(row => row.passedChecks).map(row => row.judgement!)),
      failedChecks: coworkJudgeSummary(judged.filter(row => !row.passedChecks).map(row => row.judgement!)),
      // Where the judge and the checks disagree: the cases worth reading first.
      passedButLow: judged.filter(row => row.passedChecks && COWORK_JUDGE_DIMENSIONS.some(dimension => row.judgement!.scores[dimension] <= 2))
        .map(row => ({ id: row.id, attempt: row.attempt, scores: row.judgement!.scores, problemas: row.judgement!.problemas })),
      failedButGood: judged.filter(row => !row.passedChecks && row.judgement!.veredicto === 'buena').map(row => ({ id: row.id, attempt: row.attempt })),
      // Only with AXIS cases: how the answers compare with what the previous AI achieved, in total, by block and by what the app can do.
      ...(rows.some(row => row.reference !== undefined) ? { axisReference: axisReferenceSummary(rows) } : {}),
      rows,
    };
  }
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const { rows: _rows, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

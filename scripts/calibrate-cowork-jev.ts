// Calibrates Jev (TypeSafe) as a fast reviewer of Cowork answers against the offline judge.
// For every answer of the corpus already graded by gpt-6-sol (an evaluate-cowork-conversations
// output with its judge-cowork-conversations report next to it, as `<name>-judge.json`), it
// rebuilds what the judge saw, asks Jev the questions of src/lib/cowork/jev-review.ts and
// measures how well each probability separates the answers the judge marked as failing.
// Only corpus answers (fictional data) travel to Jev. Explicit opt-in: needs --live and
// TYPESAFE_API_KEY; never loads env files, touches the database or calls other providers.
//
//   TYPESAFE_API_KEY=... node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-cowork-jev.ts --live \
//     --inputs=run-a.json,run-b.json --max-requests=2000 [--concurrency=6] [--output=calibration.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { askJev, type JevResult } from '../src/lib/server/jev';
import { COWORK_JEV_CHECKS, COWORK_JEV_QUESTIONS, coworkJevProbabilities, coworkJevState, type CoworkJevQuestionId } from '../src/lib/cowork/jev-review';
import type { CoworkJudgement } from '../src/lib/cowork/judge';
import { CORPUS as PRODUCTION_CORPUS, CORPUS_USER_CONTEXT, type CorpusCase, type CorpusTurnResult } from './fixtures/cowork-conversation-corpus';
import { EDIT_CORPUS, FILE_CORPUS, MARKETING_CORPUS, STARTER_CORPUS } from './fixtures/cowork-marketing-corpus';
import { corpusObservations, corpusShownAnswer } from './fixtures/cowork-conversation-runner';

const CORPUS: CorpusCase[] = [...PRODUCTION_CORPUS, ...MARKETING_CORPUS, ...STARTER_CORPUS, ...EDIT_CORPUS, ...FILE_CORPUS];

type Outcome = { id: string; attempt: number; result: CorpusTurnResult & { judgeInTurn?: { veredicto?: string } | null } };
type Row = {
  file: string; id: string; attempt: number; split: 'tune' | 'test';
  judge: CoworkJudgement; inTurnVerdict: string | null;
  jev: { status: JevResult['status']; durationMs: number; inputTokens: number; costUsd: number;
    probabilities: Record<CoworkJevQuestionId, number | null>; verdict: string | null; verdictProbabilities: Record<string, number> | null };
};

/** What the gpt-6-sol judge wrote, read as failure types (heuristic labels, to read next to the scores). */
const PROBLEM_TYPES: Record<string, RegExp> = {
  freeRead: /(pod[ií]a|pudo) (consultar|revisar|hacer|comprobar|preparar|verificar|mostrar)|antes de responder|en vez de hacerl|deja para (el )?(siguiente|otro)|pide permiso para (revisar|consultar)|ofrece (revisar|consultar|preparar|mostrar|comprobar)/i,
  asksKnown: /pide (un dato|datos|informaci[oó]n|el dato)|pregunta (qu[eé]|por) .*(ya|consult)|ya (tiene|est[aá]|estaba|figura|conoce)|dato que ya/i,
  denies: /dice que no (hay|tiene|ve|sabe|conoce)|afirma que no (hay|tiene)|no (ve|conoce) .*aunque/i,
  figure: /cifra|conteo|cuenta mal|porcentaje|hab[ií]an pasado|no (son|es) \d|\d+ (d[ií]as|contactos|env[ií]os|correos)/i,
  name: /apellido|enmascarad|completa «|nombre (que no|sin respaldo)|no figura (en|como)/i,
};

const LABELS: Record<string, (row: Row) => boolean> = {
  mala: row => row.judge.veredicto === 'mala',
  noBuena: row => row.judge.veredicto !== 'buena',
  friccion2: row => row.judge.scores.friccion <= 2,
  friccion3: row => row.judge.scores.friccion <= 3,
  veracidad3: row => row.judge.scores.veracidad <= 3,
  comprension3: row => row.judge.scores.comprension <= 3,
  ...Object.fromEntries(Object.entries(PROBLEM_TYPES).map(([name, pattern]) => [name, (row: Row) => row.judge.problemas.some(problem => pattern.test(problem))])),
};

/** Which labels each question should separate. */
const QUESTION_LABELS: Record<CoworkJevQuestionId, string[]> = {
  offers_free_read: ['freeRead', 'friccion2', 'friccion3'],
  asks_known_data: ['asksKnown', 'friccion2'],
  denies_present_context: ['denies', 'veracidad3'],
  unsupported_figure: ['figure', 'veracidad3'],
  unsupported_name: ['name', 'veracidad3'],
  misses_request: ['comprension3'],
};

function auc(scores: number[], labels: boolean[]) {
  const positives = scores.filter((_, index) => labels[index]);
  const negatives = scores.filter((_, index) => !labels[index]);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  return Math.round(wins / (positives.length * negatives.length) * 1000) / 1000;
}

function atThreshold(scores: number[], labels: boolean[], threshold: number) {
  let tp = 0, fp = 0, fn = 0;
  scores.forEach((score, index) => {
    if (score >= threshold && labels[index]) tp++;
    else if (score >= threshold) fp++;
    else if (labels[index]) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const THRESHOLDS = Array.from({ length: 99 }, (_, index) => (index + 1) / 100);

/** Tuned on one split, reported on the other: best F1, the gate (recall ≥ 0.9) and the fix (precision ≥ 0.8). */
function separation(tune: Row[], test: Row[], score: (row: Row) => number | null, label: (row: Row) => boolean) {
  const pick = (rows: Row[]) => rows.flatMap(row => { const value = score(row); return value === null ? [] : [{ value, label: label(row) }]; });
  const tuneRows = pick(tune), testRows = pick(test);
  const tuneScores = tuneRows.map(item => item.value), tuneLabels = tuneRows.map(item => item.label);
  const testScores = testRows.map(item => item.value), testLabels = testRows.map(item => item.label);
  const sweep = THRESHOLDS.map(threshold => ({ threshold, ...atThreshold(tuneScores, tuneLabels, threshold) }));
  const best = sweep.reduce((top, item) => item.f1 > top.f1 ? item : top, sweep[0]);
  const gate = [...sweep].reverse().find(item => item.recall >= 0.9) ?? null;
  const fix = sweep.find(item => item.precision >= 0.8 && item.recall > 0) ?? null;
  const onTest = (threshold: number | undefined) => threshold === undefined ? null : Object.fromEntries(Object.entries(atThreshold(testScores, testLabels, threshold)).map(([key, value]) => [key, round(value)]));
  return {
    n: testRows.length, positives: testLabels.filter(Boolean).length, auc: auc(testScores, testLabels),
    bestF1: { threshold: best.threshold, test: onTest(best.threshold) },
    gate: gate ? { threshold: gate.threshold, test: onTest(gate.threshold) } : null,
    fix: fix ? { threshold: fix.threshold, test: onTest(fix.threshold) } : null,
  };
}

function kappa(pairs: Array<[string, string]>) {
  const classes = [...new Set(pairs.flat())];
  const n = pairs.length;
  if (!n) return null;
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const expected = classes.reduce((sum, value) => sum + (pairs.filter(([a]) => a === value).length / n) * (pairs.filter(([, b]) => b === value).length / n), 0);
  return expected === 1 ? 1 : round((observed - expected) / (1 - expected));
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : null;
}

async function main() {
  if (!process.argv.includes('--live') || !process.env.TYPESAFE_API_KEY) throw new Error('Requires --live and an explicit TYPESAFE_API_KEY.');
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const inputs = (arg('inputs') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!inputs.length) throw new Error('Requires --inputs=run.json[,run2.json] (each with its <name>-judge.json next to it).');
  const maxRequests = Number(arg('max-requests'));
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 5000) throw new Error('Explicit --max-requests=1..5000 required');
  const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency') || 6)));

  // One job per graded answer that this checkout's corpus can still replay.
  const jobs: Array<{ file: string; entry: CorpusCase; outcome: Outcome; judge: CoworkJudgement }> = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const input of inputs) {
    const judgeFile = input.replace(/\.json$/, '-judge.json');
    if (!existsSync(judgeFile)) { console.warn(`[calibrate] no judge report for ${input}`); continue; }
    const run = JSON.parse(readFileSync(input, 'utf8')) as { outcomes: Outcome[] };
    const judged = JSON.parse(readFileSync(judgeFile, 'utf8')) as { rows?: Array<{ id: string; attempt: number; judgement: CoworkJudgement | null }> };
    for (const row of judged.rows || []) {
      const outcome = run.outcomes.find(item => item.id === row.id && item.attempt === row.attempt);
      const entry = CORPUS.find(item => item.id === row.id);
      const key = `${input}#${row.id}#${row.attempt}`;
      if (!row.judgement || !outcome || !entry || seen.has(key)) { skipped++; continue; }
      seen.add(key);
      jobs.push({ file: input, entry, outcome, judge: row.judgement });
    }
  }
  const selected = jobs.slice(0, maxRequests);
  console.log(`[calibrate] ${selected.length} answers to ask Jev (${skipped} skipped: no judgement, run or corpus case)`);

  const rows: Row[] = [];
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const job = selected[next++];
      const { entry, outcome } = job;
      const state = coworkJevState({
        request: entry.request,
        history: (entry.history || []).map(turn => ({ request: turn.request, reply: turn.reply, observations: turn.observations })),
        userContext: entry.world?.userContext === undefined ? CORPUS_USER_CONTEXT : entry.world.userContext,
        observations: corpusObservations(entry, outcome.result),
        shown: corpusShownAnswer(outcome.result),
      });
      const result = await askJev({ state, questions: COWORK_JEV_QUESTIONS, timeoutMs: 15000 });
      const verdict = result.answers?.verdict;
      const split = createHash('sha256').update(`${job.file}#${entry.id}#${outcome.attempt}`).digest()[0] < 0.7 * 256 ? 'tune' : 'test';
      rows.push({
        file: job.file, id: entry.id, attempt: outcome.attempt, split, judge: job.judge,
        inTurnVerdict: outcome.result.judgeInTurn?.veredicto ?? null,
        jev: { status: result.status, durationMs: result.durationMs, inputTokens: result.inputTokens, costUsd: result.costUsd,
          probabilities: coworkJevProbabilities(result.answers),
          verdict: verdict?.type === 'choice' ? verdict.choice : null,
          verdictProbabilities: verdict?.type === 'choice' ? verdict.probabilities : null },
      });
      if (rows.length % 100 === 0) console.log(`[calibrate] ${rows.length}/${selected.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const answered = rows.filter(row => row.jev.status === 'ok');
  const tune = answered.filter(row => row.split === 'tune');
  const test = answered.filter(row => row.split === 'test');
  const questions = Object.fromEntries(COWORK_JEV_CHECKS.map(id => [id, Object.fromEntries(QUESTION_LABELS[id].map(label =>
    [label, separation(tune, test, row => row.jev.probabilities[id], LABELS[label])]))]));
  // Any failure at all: the highest probability among the checks, and Jev's own «bad».
  const anyCheck = (row: Row) => Math.max(...COWORK_JEV_CHECKS.map(id => row.jev.probabilities[id] ?? 0));
  const combined = {
    anyCheckVsMala: separation(tune, test, anyCheck, LABELS.mala),
    anyCheckVsNoBuena: separation(tune, test, anyCheck, LABELS.noBuena),
    verdictBadVsMala: separation(tune, test, row => row.jev.verdictProbabilities?.bad ?? null, LABELS.mala),
  };
  const toSpanish: Record<string, string> = { good: 'buena', improvable: 'mejorable', bad: 'mala' };
  const verdictPairs = answered.flatMap(row => row.jev.verdict ? [[toSpanish[row.jev.verdict] || row.jev.verdict, row.judge.veredicto] as [string, string]] : []);
  const confusion: Record<string, Record<string, number>> = {};
  for (const [jev, judge] of verdictPairs) { confusion[judge] ??= {}; confusion[judge][jev] = (confusion[judge][jev] || 0) + 1; }
  // Where the in-turn judge (the coordinator's model) also read the answer: how each agrees with gpt-6-sol.
  const withInTurn = answered.filter(row => row.inTurnVerdict);
  const inTurn = {
    n: withInTurn.length,
    kappaInTurnJudge: kappa(withInTurn.map(row => [row.inTurnVerdict!, row.judge.veredicto])),
    kappaJev: kappa(withInTurn.flatMap(row => row.jev.verdict ? [[toSpanish[row.jev.verdict], row.judge.veredicto] as [string, string]] : [])),
  };
  const durations = rows.map(row => row.jev.durationMs);
  const statuses = rows.reduce<Record<string, number>>((count, row) => ({ ...count, [row.jev.status]: (count[row.jev.status] || 0) + 1 }), {});
  const report = {
    mode: 'jev-calibration', inputs, answers: rows.length, skipped, statuses,
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), max: Math.max(...durations) },
    inputTokens: rows.reduce((sum, row) => sum + row.jev.inputTokens, 0),
    costUsd: round(rows.reduce((sum, row) => sum + row.jev.costUsd, 0)),
    split: { tune: tune.length, test: test.length },
    judgeVerdicts: answered.reduce<Record<string, number>>((count, row) => ({ ...count, [row.judge.veredicto]: (count[row.judge.veredicto] || 0) + 1 }), {}),
    questions, combined,
    verdict: { kappa: kappa(verdictPairs), confusion },
    inTurn,
    rows,
  };
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const { rows: _rows, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

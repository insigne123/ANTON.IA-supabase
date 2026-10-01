// Calibrates the pre-send email review (src/lib/cowork/email-review.ts) on the made-up set of scripts/fixtures/cowork-email-review-set.ts:
// replies that are fine and replies that go wrong in one known way. For each question it reports how well its probability separates the
// replies that have that defect (AUC), the false positives among the fine ones at the thresholds in use, and the lowest threshold that flags
// no fine reply with how many defective ones it still catches. Only the made-up texts travel to Jev. Explicit opt-in: needs --live and
// TYPESAFE_API_KEY; never loads env files, touches the database or calls other providers.
//
//   TYPESAFE_API_KEY=... node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-cowork-email-review.ts --live [--concurrency=4] [--output=email-review.json]
import { writeFileSync } from 'node:fs';
import { askJev } from '../src/lib/server/jev';
import { COWORK_EMAIL_REVIEW_IDS, COWORK_EMAIL_REVIEW_THRESHOLDS, coworkEmailReviewProbabilities, coworkEmailReviewQuestions, coworkEmailReviewState, type CoworkEmailReviewId } from '../src/lib/cowork/email-review';
import { REVIEW_SET, SELLER } from './fixtures/cowork-email-review-set';

/** Area under the ROC curve: the chance that a defective reply gets a higher probability than a fine one (ties count half). */
export function auc(positives: number[], negatives: number[]) {
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

/** The lowest threshold (of the probabilities seen, plus a hair) that flags none of the negatives, and what share of the positives it keeps. */
export function cleanThreshold(positives: number[], negatives: number[]) {
  const top = negatives.length ? Math.max(...negatives) : 0;
  const threshold = Math.min(1, Math.round((top + 0.01) * 100) / 100);
  return { threshold, recall: positives.length ? positives.filter(value => value >= threshold).length / positives.length : null };
}

async function main() {
  if (!process.argv.includes('--live') || !process.env.TYPESAFE_API_KEY) throw new Error('Requires --live and an explicit TYPESAFE_API_KEY.');
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency')) || 4));
  const questions = coworkEmailReviewQuestions(true);
  const rows: Array<{ id: string; labels: Record<string, number>; probabilities: Record<CoworkEmailReviewId, number | null>; status: string; durationMs: number }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < REVIEW_SET.length) {
      const entry = REVIEW_SET[next++];
      const result = await askJev({ questions, timeoutMs: 8_000, state: coworkEmailReviewState({ seller: SELLER, conversation: { with: entry.who, theirLastMessage: entry.theirs },
        draft: { subject: 'Re: Antecedentes laborales en minutos', body: entry.reply } }) });
      rows.push({ id: entry.id, labels: entry.labels, probabilities: coworkEmailReviewProbabilities(result.answers), status: result.status, durationMs: result.durationMs });
    }
  }));
  const answered = rows.filter(row => row.status === 'ok');
  const report = COWORK_EMAIL_REVIEW_IDS.map(id => {
    const values = (wanted: number) => answered.filter(row => row.labels[id] === wanted).map(row => row.probabilities[id]).filter((value): value is number => value !== null);
    const positives = values(1); const negatives = values(0);
    const inUse = COWORK_EMAIL_REVIEW_THRESHOLDS[id] ?? null;
    return { question: id, positives: positives.length, negatives: negatives.length, auc: auc(positives, negatives),
      inUse, falsePositivesAtInUse: inUse === null ? null : negatives.filter(value => value >= inUse).length, recallAtInUse: inUse === null || !positives.length ? null : positives.filter(value => value >= inUse).length / positives.length,
      ...cleanThreshold(positives, negatives) };
  });
  const latencies = answered.map(row => row.durationMs).sort((a, b) => a - b);
  const summary = { items: rows.length, answered: answered.length, p50Ms: latencies[Math.floor(latencies.length * 0.5)] ?? null, p95Ms: latencies[Math.floor(latencies.length * 0.95)] ?? null };
  console.log(JSON.stringify({ summary, report }, null, 2));
  const out = arg('output');
  if (out) writeFileSync(out, JSON.stringify({ summary, report, rows }, null, 2));
}

if (process.argv[1]?.endsWith('calibrate-cowork-email-review.ts')) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

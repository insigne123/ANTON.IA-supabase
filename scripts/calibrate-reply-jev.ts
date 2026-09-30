// Jev (TypeSafe) against the app's reply classifier on labeled prospect replies
// (scripts/fixtures/reply-intent-samples.ts, fictional). Both paths keep the same rules first
// (explicit opt-out, then the hard-negative override), then ask either the current model flow
// (classifyReply) or one Jev choice question. Measures accuracy, the mistakes that would keep
// writing to someone who said no, confidence and latency.
// Explicit opt-in: needs --live, OPENAI_API_KEY and TYPESAFE_API_KEY; never loads env files.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-reply-jev.ts --live [--repeat=2] [--output=replies.json]
import { writeFileSync } from 'node:fs';
import { askJev } from '../src/lib/server/jev';
import { classifyReply } from '../src/lib/reply-classifier';
import { isExplicitOptOut, newReplyText } from '../src/lib/reply-text';
import { isHardNegativeReply } from '../src/lib/reply-intent-rules';
import { JEV_REPLY_MIN_CONFIDENCE, REPLY_JEV_QUESTION } from '../src/lib/reply-jev';
import { REPLY_INTENT_SAMPLES, type ReplyIntentSample } from './fixtures/reply-intent-samples';

type Intent = ReplyIntentSample['intent'] | 'unknown';

/** Stops writing to the prospect: getting one of these wrong keeps a sequence going to someone who said no. */
const STOP = new Set<Intent>(['negative', 'unsubscribe', 'delivery_failure']);

async function jevClassify(text: string): Promise<{ intent: Intent; confidence: number | null; ms: number; status: string }> {
  const cleaned = newReplyText(text).slice(0, 3000);
  if (isExplicitOptOut(cleaned)) return { intent: 'unsubscribe', confidence: 1, ms: 0, status: 'rule' };
  const result = await askJev({ state: { reply: cleaned }, questions: { intent: REPLY_JEV_QUESTION }, timeoutMs: 10000 });
  const answer = result.answers?.intent;
  let intent: Intent = answer?.type === 'choice' ? answer.choice as Intent : 'unknown';
  if (isHardNegativeReply(cleaned) && intent !== 'unsubscribe' && intent !== 'negative') intent = 'negative';
  return { intent, confidence: answer?.type === 'choice' ? answer.confidence : null, ms: result.durationMs, status: result.status };
}

async function modelClassify(text: string): Promise<{ intent: Intent; confidence: number | null; ms: number }> {
  const started = Date.now();
  // The model alone, whatever REPLY_CLASSIFIER_ENGINE says in this environment.
  const result = await classifyReply(text, { engine: 'llm' });
  return { intent: result.intent as Intent, confidence: result.confidence, ms: Date.now() - started };
}

function summarize(rows: Array<{ expected: Intent; got: Intent; ms: number; confidence: number | null }>) {
  const correct = rows.filter(row => row.got === row.expected).length;
  const keepsWriting = rows.filter(row => STOP.has(row.expected) && !STOP.has(row.got)).length;
  const stopsWrongly = rows.filter(row => !STOP.has(row.expected) && STOP.has(row.got)).length;
  const sorted = rows.map(row => row.ms).sort((a, b) => a - b);
  const byIntent: Record<string, string> = {};
  for (const intent of [...new Set(rows.map(row => row.expected))]) {
    const of = rows.filter(row => row.expected === intent);
    byIntent[intent] = `${of.filter(row => row.got === intent).length}/${of.length}`;
  }
  const confident = rows.filter(row => (row.confidence ?? 0) >= JEV_REPLY_MIN_CONFIDENCE);
  return {
    n: rows.length, accuracy: Math.round(correct / rows.length * 1000) / 1000, keepsWriting, stopsWrongly, byIntent,
    confidentShare: Math.round(confident.length / rows.length * 1000) / 1000,
    confidentAccuracy: confident.length ? Math.round(confident.filter(row => row.got === row.expected).length / confident.length * 1000) / 1000 : null,
    msP50: sorted[Math.floor(sorted.length / 2)] ?? null, msMax: sorted.at(-1) ?? null,
  };
}

async function main() {
  if (!process.argv.includes('--live') || !process.env.TYPESAFE_API_KEY || !process.env.OPENAI_API_KEY) {
    throw new Error('Requires --live, OPENAI_API_KEY and TYPESAFE_API_KEY.');
  }
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const repeat = Math.max(1, Math.min(3, Number(arg('repeat') || 1)));
  const jevRows: Array<{ id: string; expected: Intent; got: Intent; ms: number; confidence: number | null }> = [];
  const modelRows: typeof jevRows = [];
  for (let attempt = 1; attempt <= repeat; attempt++) {
    for (const sample of REPLY_INTENT_SAMPLES) {
      const [jev, model] = await Promise.all([jevClassify(sample.text), modelClassify(sample.text)]);
      jevRows.push({ id: sample.id, expected: sample.intent, got: jev.intent, ms: jev.ms, confidence: jev.confidence });
      modelRows.push({ id: sample.id, expected: sample.intent, got: model.intent, ms: model.ms, confidence: model.confidence });
      if (jev.intent !== sample.intent || model.intent !== sample.intent) {
        console.log(`${sample.id}: esperado ${sample.intent} · Jev ${jev.intent} · modelo ${model.intent}`);
      }
    }
  }
  const report = { mode: 'reply-classification', samples: REPLY_INTENT_SAMPLES.length, repeat,
    jev: summarize(jevRows), model: summarize(modelRows), rows: { jev: jevRows, model: modelRows } };
  const output = arg('output');
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const { rows: _rows, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

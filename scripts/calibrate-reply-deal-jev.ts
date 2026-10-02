// Jev (TypeSafe) on where an interested reply leaves the deal (Plan 6, PR-B), against fictional labeled replies
// (scripts/fixtures/reply-deal-samples.ts). Measures accuracy, the replies it would push to «Negociación» or «Ganado» when they
// are not (what costs the person a dismissal), and the accuracy above each confidence floor.
// Explicit opt-in: needs --live and TYPESAFE_API_KEY; never loads env files.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/calibrate-reply-deal-jev.ts --live [--repeat=2]
import { askJev } from '../src/lib/server/jev';
import { newReplyText } from '../src/lib/reply-text';
import { REPLY_JEV_DEAL_QUESTION } from '../src/lib/reply-jev';
import { REPLY_DEAL_SAMPLES } from './fixtures/reply-deal-samples';

async function main() {
  if (!process.argv.includes('--live') || !process.env.TYPESAFE_API_KEY) throw new Error('Requires --live and TYPESAFE_API_KEY.');
  const repeat = Number(process.argv.find(arg => arg.startsWith('--repeat='))?.split('=')[1] || 1);
  const rows: Array<{ expected: string; got: string; confidence: number; ms: number }> = [];
  for (let round = 0; round < repeat; round++) {
    for (const sample of REPLY_DEAL_SAMPLES) {
      const result = await askJev({ state: { reply: newReplyText(sample.text) }, questions: { deal: REPLY_JEV_DEAL_QUESTION }, timeoutMs: 10000 });
      const answer = result.answers?.deal;
      rows.push({ expected: sample.deal, got: answer?.type === 'choice' ? answer.choice : `(${result.status})`,
        confidence: answer?.type === 'choice' ? answer.confidence : 0, ms: result.durationMs });
    }
  }
  const floors = [0, 0.6, 0.7, 0.8, 0.85, 0.9];
  const table = floors.map(floor => {
    // Above the floor Jev's word is taken; below it the reply proposes the stage of its intent («none»).
    const decided = rows.map(row => ({ ...row, used: row.got !== 'none' && row.confidence >= floor ? row.got : 'none' }));
    const correct = decided.filter(row => row.used === row.expected).length;
    const pushedWrongly = decided.filter(row => row.used !== 'none' && row.used !== row.expected).length;
    const missed = decided.filter(row => row.expected !== 'none' && row.used === 'none').length;
    return { floor, accuracy: Math.round(correct / rows.length * 1000) / 1000, pushedWrongly, missed };
  });
  const byDeal: Record<string, string> = {};
  for (const deal of ['negotiation', 'won', 'none']) {
    const of = rows.filter(row => row.expected === deal);
    byDeal[deal] = `${of.filter(row => row.got === deal).length}/${of.length}`;
  }
  const sorted = rows.map(row => row.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({ n: rows.length, byDeal, floors: table, msP50: sorted[Math.floor(sorted.length / 2)], msMax: sorted.at(-1),
    mistakes: rows.filter(row => row.got !== row.expected).map(row => ({ expected: row.expected, got: row.got, confidence: Math.round(row.confidence * 100) / 100 })) }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

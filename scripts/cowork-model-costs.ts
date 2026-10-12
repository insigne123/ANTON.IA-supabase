// What each answer of an evaluation cost, by role and model: reads the JSON that evaluate-cowork-conversations.ts writes with
// --output (its `usage`, one entry per call, with role and case) and prices it with COWORK_MODEL_PRICING_JSON or --pricing=<file>,
// the same explicit prices the worker records. Never calls a model, loads env files or touches the database.
//
//   node --loader ./scripts/ts-test-loader.mjs scripts/cowork-model-costs.ts [--pricing=prices.json] a.json [b.json …]
//
// Per file: calls, tokens and US$ by role and model; the answers that showed an email and what one cost on average, in total and
// counting only the Writer and the Reviewer (the part a model change for writing moves); seconds per call of each role, the median
// and the 90th percentile (what a production timeout has to allow).
import { readFileSync } from 'node:fs';
import { coworkModelUsage } from '../src/lib/server/cowork/model-usage';

type Call = {
  model: string; role?: string; case?: string | null; attempt?: number | null; durationMs: number | null;
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; costUsd: number | null;
};
type Report = { usage: Call[]; outcomes: Array<{ id: string; attempt?: number; result?: { blocks?: Array<{ type?: string }> | null } }> };

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const files = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (!files.length) throw new Error('Usage: cowork-model-costs.ts [--pricing=prices.json] report.json [report.json …]');
const pricing = argument('pricing') ? readFileSync(argument('pricing')!, 'utf8') : process.env.COWORK_MODEL_PRICING_JSON;

/** A call priced again with the given prices: the report may come from a run without them. */
function priced(call: Call) {
  if (call.inputTokens === null || call.outputTokens === null) return null;
  return coworkModelUsage({ modelName: call.model, durationMs: call.durationMs ?? 0, usage: {
    prompt_tokens: call.inputTokens, completion_tokens: call.outputTokens, total_tokens: call.inputTokens + call.outputTokens,
    prompt_tokens_details: { cached_tokens: call.cachedInputTokens ?? 0 },
  } }, pricing).costUsd;
}

const usd = (value: number) => `US$${value.toFixed(5)}`;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
/** The value below which a share of the values falls (0.5 the median, 0.9 the slow end a production timeout has to allow). */
const quantile = (values: number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(share * sorted.length) - 1] ?? sorted[sorted.length - 1] : 0;
};

for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
  const groups = new Map<string, { calls: number; input: number; cached: number; output: number; usd: number; unpriced: number; ms: number[] }>();
  const perAnswer = new Map<string, { total: number; writing: number }>();
  for (const call of report.usage) {
    const role = call.role ?? 'sin rol';
    const key = `${role} · ${call.model}`;
    const group = groups.get(key) ?? { calls: 0, input: 0, cached: 0, output: 0, usd: 0, unpriced: 0, ms: [] };
    const cost = priced(call);
    group.calls++;
    group.input += call.inputTokens ?? 0;
    group.cached += call.cachedInputTokens ?? 0;
    group.output += call.outputTokens ?? 0;
    if (cost === null) group.unpriced++; else group.usd += cost;
    if (call.durationMs !== null) group.ms.push(call.durationMs);
    groups.set(key, group);
    if (call.case) {
      const answer = `${call.case}#${call.attempt ?? 1}`;
      const sum = perAnswer.get(answer) ?? { total: 0, writing: 0 };
      sum.total += cost ?? 0;
      if (role === 'writer' || role === 'reviewer' || role === 'corrector') sum.writing += cost ?? 0;
      perAnswer.set(answer, sum);
    }
  }
  console.log(`\n${file}`);
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${group.calls} llamadas · ${group.input} entrada (${group.cached} en caché) · ${group.output} salida · ${usd(group.usd)}`
      + `${group.unpriced ? ` · ${group.unpriced} sin precio` : ''} · mediana ${(quantile(group.ms, 0.5) / 1000).toFixed(1)} s · p90 ${(quantile(group.ms, 0.9) / 1000).toFixed(1)} s`);
  }
  const withEmail = report.outcomes.filter(outcome => outcome.result?.blocks?.some(block => block.type === 'email_draft' || block.type === 'sequence'))
    .map(outcome => perAnswer.get(`${outcome.id}#${outcome.attempt ?? 1}`)).filter((sum): sum is { total: number; writing: number } => Boolean(sum));
  const all = [...perAnswer.values()];
  console.log(`  Total: ${usd(all.reduce((sum, item) => sum + item.total, 0))} en ${all.length} respuestas.`
    + ` Con correo: ${withEmail.length}, en promedio ${usd(mean(withEmail.map(item => item.total)))} cada una`
    + ` (Redactora, Revisora y corrección: ${usd(mean(withEmail.map(item => item.writing)))}).`);
}

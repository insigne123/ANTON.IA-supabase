// A spending cap for the scripts that call a model with the test keys (AGENTS.md: the paid measurements use ANTHROPIC_API_KEY_TEST, never production's).
// It is preloaded, so it sits between every script and the two providers:
//
//   SPEND_CAP_USD=1.5 SPEND_LEDGER=<file> node --import ./scripts/spend-guard.mjs [--import <the TypeScript loader>] scripts/<script>.ts ...
//
// - Only the cheap models: Luna on OpenAI and Haiku on Anthropic. Any other model (Opus, Sonnet, Fable, Sol, Terra, Astra, GPT-x) is refused before it is sent.
// - It adds up the tokens each answer reports, prices them with figures twice the price list of the app (the true price is lower, never higher), and stops
//   sending when the estimate reaches SPEND_CAP_USD (default 1.5). At the end it prints what was spent.
// - With SPEND_LEDGER=<file> every run appends what it spent and starts from the sum of the earlier ones: the cap is for the whole session, not per run.
// - Web search and other paid tools are not priced: a script that uses them is not covered by this guard.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const PRICES = {
  // US dollars per million tokens: twice what the price list of the app says (apphosting.yaml, COWORK_MODEL_PRICING_JSON: Luna 0.1 in and 0.5 out,
  // Haiku 0.1 and 0.5), so the estimate may only err upwards.
  openai: { in: 0.2, out: 1.0 },
  anthropic: { in: 0.2, out: 1.0 },
};
const ALLOWED = { openai: /luna/i, anthropic: /haiku/i };

export const providerOf = host => (host === 'api.openai.com' ? 'openai' : host === 'api.anthropic.com' ? 'anthropic' : null);
export const modelAllowed = (provider, model) => ALLOWED[provider].test(String(model || ''));

/** Dollars for the usage an answer reports, whichever of the two shapes it has. Cached tokens are priced as new ones (an upper bound). */
export function estimateCost(provider, usage) {
  const price = PRICES[provider];
  const input = Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0) + Number(usage?.cache_read_input_tokens ?? 0) + Number(usage?.cache_creation_input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? usage?.completion_tokens ?? 0);
  return { input, output, usd: (input * price.in + output * price.out) / 1e6 };
}

/** The usage of an Anthropic answer that came as a stream of events (the SDK streams): the input is in `message_start`, the output grows to its last `message_delta`. */
export function usageFromStream(text) {
  let input = 0, cached = 0, output = 0;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === 'message_start') {
        const usage = event.message?.usage ?? {};
        input = Number(usage.input_tokens || 0);
        cached = Number(usage.cache_read_input_tokens || 0) + Number(usage.cache_creation_input_tokens || 0);
        output = Math.max(output, Number(usage.output_tokens || 0));
      } else if (event.type === 'message_delta') output = Math.max(output, Number(event.usage?.output_tokens || 0));
    } catch { /* a line that is not an event */ }
  }
  return { input_tokens: input, cache_read_input_tokens: cached, output_tokens: output };
}

/** What the earlier runs of a ledger spent. */
export function ledgerTotal(file) {
  if (!file || !existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).reduce((sum, line) => { try { return sum + Number(JSON.parse(line).estimatedUsd || 0); } catch { return sum; } }, 0);
}

/** A fetch that counts and caps, over `realFetch`. `state()` says what this run has spent. */
export function guardedFetch(realFetch, { cap = 1.5, before = 0 } = {}) {
  const totals = new Map();
  let spent = before;
  let calls = 0;
  const guarded = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const provider = providerOf(url.hostname);
    if (!provider) return realFetch(input, init);
    let model = '';
    try { model = JSON.parse(typeof init?.body === 'string' ? init.body : '{}').model || ''; } catch { /* not JSON: refused below */ }
    if (!modelAllowed(provider, model)) throw new Error(`spend-guard: «${model || 'sin modelo'}» en ${provider} no está permitido (solo Luna en OpenAI y Haiku en Anthropic)`);
    if (spent >= cap) throw new Error(`spend-guard: tope de US$${cap} alcanzado (estimado US$${spent.toFixed(4)}); no se envían más llamadas`);
    const response = await realFetch(input, init);
    calls += 1;
    let usage = null;
    try {
      const type = response.headers.get('content-type') || '';
      usage = /json/i.test(type) ? (await response.clone().json())?.usage : /event-stream/i.test(type) ? usageFromStream(await response.clone().text()) : null;
    } catch { /* an answer the guard cannot read: priced below as a large one */ }
    // Nothing is awaited from here on, so calls that finish together cannot overwrite each other's totals.
    const cost = estimateCost(provider, usage);
    const entry = totals.get(`${provider}:${model}`) ?? { calls: 0, input: 0, output: 0, usd: 0 };
    entry.calls += 1;
    if (cost.input + cost.output > 0) { entry.input += cost.input; entry.output += cost.output; entry.usd += cost.usd; spent += cost.usd; }
    else { entry.usd += 0.01; spent += 0.01; } // An answer the guard cannot read: counted as a large one, so the estimate does not undercount.
    totals.set(`${provider}:${model}`, entry);
    return response;
  };
  guarded.state = () => ({
    capUsd: cap, estimatedUsd: Math.round((spent - before) * 10000) / 10000, earlierRunsUsd: Math.round(before * 10000) / 10000, calls,
    byModel: Object.fromEntries([...totals].map(([key, value]) => [key, { calls: value.calls, inputTokens: value.input, outputTokens: value.output, usd: Math.round(value.usd * 10000) / 10000 }])),
  });
  return guarded;
}

// Preloaded: patch the global fetch once and report at exit.
if (!globalThis.__spendGuardInstalled && !process.env.SPEND_GUARD_NO_INSTALL) {
  globalThis.__spendGuardInstalled = true;
  const ledger = process.env.SPEND_LEDGER || '';
  const guarded = guardedFetch(globalThis.fetch, { cap: Number(process.env.SPEND_CAP_USD || 1.5), before: ledgerTotal(ledger) });
  globalThis.fetch = guarded;
  process.on('exit', () => {
    const text = JSON.stringify({ at: new Date().toISOString(), ...guarded.state() });
    process.stderr.write(`[spend-guard] ${text}\n`);
    if (ledger) { try { appendFileSync(ledger, `${text}\n`); } catch { /* the line above is the record */ } }
  });
}

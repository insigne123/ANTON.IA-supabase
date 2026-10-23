import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.SPEND_GUARD_NO_INSTALL = '1';
const { estimateCost, guardedFetch, ledgerTotal, modelAllowed, providerOf, usageFromStream } = await import('../scripts/spend-guard.mjs');

const answer = usage => new Response(JSON.stringify({ usage }), { status: 200, headers: { 'content-type': 'application/json' } });
const call = (fetcher, url, model) => fetcher(url, { method: 'POST', body: JSON.stringify({ model }) });

test('only Luna on OpenAI and Haiku on Anthropic are allowed, and only those two providers are watched', () => {
  assert.equal(providerOf('api.openai.com'), 'openai');
  assert.equal(providerOf('api.anthropic.com'), 'anthropic');
  assert.equal(providerOf('example.com'), null);
  for (const [provider, model] of [['openai', 'gpt-6-luna'], ['anthropic', 'claude-haiku-5-5']]) assert.equal(modelAllowed(provider, model), true, model);
  for (const [provider, model] of [['anthropic', 'claude-opus-5-5'], ['anthropic', 'claude-sonnet-5-5'], ['anthropic', 'claude-fable-5-1'], ['openai', 'gpt-6-sol'], ['openai', 'gpt-4o'], ['openai', ''], ['anthropic', undefined]]) {
    assert.equal(modelAllowed(provider, model), false, String(model));
  }
});

test('the usage of both providers is priced above the real price, cached tokens as new ones', () => {
  assert.deepEqual(estimateCost('openai', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }), { input: 1_000_000, output: 1_000_000, usd: 1.2 });
  assert.deepEqual(estimateCost('anthropic', { input_tokens: 500_000, cache_read_input_tokens: 500_000, output_tokens: 200_000 }), { input: 1_000_000, output: 200_000, usd: 0.4 });
  assert.equal(estimateCost('anthropic', undefined).usd, 0);
});

test('a model that is not allowed is refused before anything is sent; other hosts pass untouched', async () => {
  const sent = [];
  const fetcher = guardedFetch(async (input) => { sent.push(String(input)); return answer({ input_tokens: 10, output_tokens: 10 }); });
  await assert.rejects(() => call(fetcher, 'https://api.anthropic.com/v1/messages', 'claude-opus-5-5'), /no está permitido/);
  await assert.rejects(() => call(fetcher, 'https://api.openai.com/v1/chat/completions', 'gpt-4o'), /no está permitido/);
  await assert.rejects(() => fetcher('https://api.anthropic.com/v1/messages', { method: 'POST', body: 'no json' }), /sin modelo/);
  assert.deepEqual(sent, []);
  await fetcher('https://example.com/page');
  assert.deepEqual(sent, ['https://example.com/page']);
  assert.equal(fetcher.state().calls, 0);
});

test('what each answer reports is added up, and when the estimate reaches the cap nothing more is sent', async () => {
  let sent = 0;
  const fetcher = guardedFetch(async () => { sent += 1; return answer({ prompt_tokens: 500_000, completion_tokens: 100_000 }); }, { cap: 0.3 });
  await call(fetcher, 'https://api.openai.com/v1/chat/completions', 'gpt-6-luna'); // 0.1 + 0.1 = 0.2
  await call(fetcher, 'https://api.openai.com/v1/chat/completions', 'gpt-6-luna'); // 0.4 in total: over the cap
  await assert.rejects(() => call(fetcher, 'https://api.openai.com/v1/chat/completions', 'gpt-6-luna'), /tope de US\$0.3 alcanzado/);
  assert.equal(sent, 2);
  const state = fetcher.state();
  assert.equal(state.calls, 2);
  assert.equal(state.estimatedUsd, 0.4);
  assert.deepEqual(state.byModel['openai:gpt-6-luna'], { calls: 2, inputTokens: 1_000_000, outputTokens: 200_000, usd: 0.4 });
});

test('the usage of a streamed Anthropic answer is read from its events, and an answer the guard cannot read is counted as a large one, not as free', async () => {
  const stream = [
    'event: message_start', `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 3000, cache_read_input_tokens: 500, output_tokens: 1 } } })}`, '',
    'event: content_block_delta', `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'x' } })}`, '',
    'event: message_delta', `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 400 } })}`, '',
  ].join('\n');
  assert.deepEqual(usageFromStream(stream), { input_tokens: 3000, cache_read_input_tokens: 500, output_tokens: 400 });
  const read = guardedFetch(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  await call(read, 'https://api.anthropic.com/v1/messages', 'claude-haiku-5-5');
  assert.equal(read.state().estimatedUsd, 0.0011); // 3 500 in at 0.2 and 400 out at 1, per million
  const unreadable = guardedFetch(async () => new Response('data: x', { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  await call(unreadable, 'https://api.anthropic.com/v1/messages', 'claude-haiku-5-5');
  assert.equal(unreadable.state().estimatedUsd, 0.01);
});

test('answers that arrive together are all counted', async () => {
  const fetcher = guardedFetch(async () => answer({ prompt_tokens: 1_000_000, completion_tokens: 0 }));
  await Promise.all(Array.from({ length: 5 }, () => call(fetcher, 'https://api.openai.com/v1/chat/completions', 'gpt-6-luna')));
  const state = fetcher.state();
  assert.equal(state.calls, 5);
  assert.equal(state.byModel['openai:gpt-6-luna'].calls, 5);
  assert.equal(state.estimatedUsd, 1);
});

test('the cap is shared across runs through the ledger', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'spend-')), 'ledger.jsonl');
  assert.equal(ledgerTotal(file), 0);
  writeFileSync(file, `${JSON.stringify({ estimatedUsd: 0.4 })}\n${JSON.stringify({ estimatedUsd: 0.35 })}\nnot json\n`);
  assert.equal(ledgerTotal(file), 0.75);
  assert.equal(guardedFetch(async () => answer({}), { cap: 1, before: ledgerTotal(file) }).state().earlierRunsUsd, 0.75);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 3);
});

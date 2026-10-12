import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import {
  claudeEffort, claudeJsonSchema, claudeRequest, claudeUsage, generateClaudeStructured, isClaudeModel, type ClaudeClient,
} from './anthropic-json';
import { generateStructuredWithTelemetry, isProviderQuotaExhausted, openAiReasoningEffort } from './openai-json';
import { coworkModelUsage } from '@/lib/server/cowork/model-usage';

const schema = z.object({
  reply: z.string().trim().min(1).max(1200),
  blocks: z.array(z.object({ type: z.literal('email_draft'), subject: z.string().max(400), body: z.string().max(12000) }).strict()).min(1).max(3),
  question: z.string().max(400).nullable(),
}).strict();
const answer = { reply: 'Listo.', blocks: [{ type: 'email_draft', subject: 'Antecedentes en minutos', body: 'Hola Ana,' }], question: null };

type Captured = { params: ReturnType<typeof claudeRequest> | null; signal?: AbortSignal };
function fakeClient(message: { stop_reason?: string; text?: string; usage?: Record<string, number>; model?: string }, captured: Captured = { params: null }) {
  const client: ClaudeClient = {
    messages: {
      stream: (params, options) => {
        captured.params = params;
        captured.signal = options.signal;
        let onText: ((delta: string, snapshot: string) => void) | null = null;
        return {
          on: (_event, listener) => { onText = listener; },
          finalMessage: async () => {
            const text = message.text ?? JSON.stringify(answer);
            onText?.(text.slice(0, 10), text.slice(0, 10));
            onText?.(text.slice(10), text);
            return {
              model: message.model ?? 'claude-haiku-5-5',
              stop_reason: message.stop_reason ?? 'end_turn',
              content: [{ type: 'thinking' }, { type: 'text', text }],
              usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...message.usage },
            };
          },
        };
      },
    },
  };
  return { client, captured };
}

test('only claude- models go to Anthropic, and each provider gets an effort it takes', () => {
  assert.equal(isClaudeModel('claude-haiku-5-5'), true);
  assert.equal(isClaudeModel(' Claude-Sonnet-5-5 '), true);
  assert.equal(isClaudeModel('gpt-6-luna'), false);
  assert.equal(isClaudeModel(undefined), false);
  assert.equal(claudeEffort(undefined), 'low');
  assert.equal(claudeEffort('none'), 'low');
  assert.equal(claudeEffort('max'), 'max');
  assert.equal(openAiReasoningEffort('gpt-6-luna', 'max'), 'xhigh', 'gpt-6 rejects «max»: its top level is xhigh');
  assert.equal(openAiReasoningEffort('gpt-6-luna', undefined), 'low');
  assert.equal(openAiReasoningEffort('gpt-6.1-sol', 'high'), 'high');
});

test('the JSON schema is closed and keeps no constraint the structured outputs refuse', () => {
  const json = claudeJsonSchema(z.object({
    format: z.string().min(2).max(10),
    pattern: z.array(z.number().int().min(0).max(365)).max(12),
    nested: z.object({ email: z.string().email(), day: z.number().min(1) }).strict(),
  }).strict());
  const text = JSON.stringify(json);
  for (const keyword of ['"minLength"', '"maxLength"', '"minimum"', '"maximum"', '"maxItems"', '"$schema"']) assert.ok(!text.includes(keyword), keyword);
  const properties = json.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(properties), ['format', 'pattern', 'nested'], 'properties named like keywords stay');
  assert.equal(json.additionalProperties, false);
  assert.equal((properties.nested as { additionalProperties?: unknown }).additionalProperties, false);
  assert.equal(((properties.nested.properties as Record<string, Record<string, unknown>>).email).format, 'email', 'supported formats stay');
});

test('the request carries the format, the effort and room for thinking', () => {
  const low = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'p', systemPrompt: 's', schema, maxOutputTokens: 6000 });
  assert.equal(low.output_config.effort, 'low');
  assert.equal(low.output_config.format.type, 'json_schema');
  assert.equal(low.max_tokens, 10000);
  assert.equal(low.system, 's');
  assert.deepEqual(low.messages, [{ role: 'user', content: 'p' }]);
  assert.ok(!('temperature' in low) && !('thinking' in low), 'no sampling and the model\'s own adaptive thinking');
  const max = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'p', schema, maxOutputTokens: 1500, reasoningEffort: 'max' });
  assert.equal(max.output_config.effort, 'max');
  assert.equal(max.max_tokens, 33500);
});

test('Claude usage reads like OpenAI usage and is priced the same way', () => {
  const usage = claudeUsage({ input_tokens: 1000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 500 });
  assert.equal(usage.prompt_tokens, 5000);
  assert.equal(usage.prompt_tokens_details.cached_tokens, 4000);
  assert.equal(usage.completion_tokens, 500);
  const pricing = JSON.stringify({ 'claude-haiku-5-5': { version: 'anthropic-2026-10-06', inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, cachedInputUsdPerMillion: 0.01 } });
  const priced = coworkModelUsage({ modelName: 'claude-haiku-5-5', durationMs: 900, usage }, pricing);
  assert.equal(Number(priced.costUsd?.toFixed(8)), Number(((1000 * 0.1 + 4000 * 0.01 + 500 * 0.5) / 1e6).toFixed(8)));
});

test('a Claude answer comes back validated, streamed to the preview and with its telemetry', async () => {
  const { client, captured } = fakeClient({});
  const previews: string[] = [];
  const result = await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema, reasoningEffort: 'medium', onPartial: text => previews.push(text) }, client);
  assert.deepEqual(result.data, answer);
  assert.equal(result.telemetry.modelName, 'claude-haiku-5-5');
  assert.equal(result.telemetry.usage.prompt_tokens, 1200);
  assert.equal(result.telemetry.usage.completion_tokens, 300);
  assert.equal(previews.at(-1), JSON.stringify(answer));
  assert.equal(captured.params?.output_config.effort, 'medium');
});

test('a refusal, a cut answer or invalid JSON fail with their usage kept', async () => {
  for (const [message, pattern] of [
    [{ stop_reason: 'refusal' }, /CLAUDE_REFUSAL/],
    [{ stop_reason: 'max_tokens' }, /CLAUDE_MAX_TOKENS/],
    [{ text: '{"reply":' }, /JSON/],
    [{ text: JSON.stringify({ ...answer, blocks: [] }) }, /at least 1|too_small|Array must contain/i],
  ] as const) {
    const { client } = fakeClient(message);
    await assert.rejects(generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema }, client), (error: unknown) => {
      assert.match(String((error as Error).message), pattern);
      const telemetry = (error as { structuredTelemetry?: { usage?: { completion_tokens?: number } } }).structuredTelemetry;
      assert.equal(telemetry?.usage?.completion_tokens, 300, 'a paid answer keeps its usage');
      return true;
    });
  }
});

test('an exhausted Anthropic account stops like an exhausted OpenAI one', () => {
  assert.equal(isProviderQuotaExhausted(new Error('CLAUDE_HTTP_400:Your credit balance is too low to access the Anthropic API. credit_balance_exhausted')), true);
});

test('a Claude model never needs the OpenAI key and asks for its own', async () => {
  const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(generateStructuredWithTelemetry({ schema, prompt: 'p', provider: 'openai', openAiModel: 'claude-haiku-5-5', allowDefaultModelFallback: false, maxAttempts: 1 }),
      /ANTHROPIC_API_KEY/);
    await assert.rejects(generateStructuredWithTelemetry({ schema, prompt: 'p', provider: 'openai', openAiModel: 'gpt-6-luna', allowDefaultModelFallback: false, maxAttempts: 1 }),
      /OPENAI_API_KEY/);
  } finally {
    if (saved.openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.openai;
    if (saved.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.anthropic;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import {
  claudeClamp, claudeContent, claudeCut, claudeEffort, claudeFormatFits, claudeJsonSchema, claudeJsonText, claudeReadJsonText, claudeRequest, claudeSchemaPlan, claudeUsage, generateClaudeStructured, isClaudeModel, type ClaudeClient,
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

test('a property that takes any value travels as JSON text and is read back', () => {
  const anyValue = z.object({ name: z.string(), criteria: z.unknown(), nested: z.object({ criteria: z.unknown().optional() }).strict() }).strict();
  const plan = claudeSchemaPlan(anyValue);
  assert.ok(!JSON.stringify(plan.json).includes('{}') && !JSON.stringify(plan.json).includes('OpenAiAnyType'), 'no empty or recursive schema reaches the API');

  assert.deepEqual([...plan.jsonText], ['criteria']);
  assert.equal(((plan.json.properties as Record<string, Record<string, unknown>>).criteria).type, 'string');
  const read = claudeReadJsonText({ name: '{"a":1}', criteria: '{"titles":["Jefe de Selección"]}', nested: { criteria: 'no es json' } }, plan.jsonText);
  assert.deepEqual(read, { name: '{"a":1}', criteria: { titles: ['Jefe de Selección'] }, nested: { criteria: 'no es json' } }, 'only those properties, and text that is not JSON stays');
});

test('a schema too large for the format travels in the instructions and its answer is read the same way', () => {
  const wide = z.object(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index}`, z.string().nullable().optional()]))).strict();
  assert.equal(claudeFormatFits(claudeJsonSchema(wide)), false);
  assert.equal(claudeFormatFits(claudeJsonSchema(z.object({ a: z.string(), b: z.string().nullable() }).strict())), true);
  const request = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'p', systemPrompt: 'reglas', schema: wide });
  assert.ok(!('format' in request.output_config), 'no format the API would refuse');
  assert.equal(request.output_config.effort, 'low');
  const system = request.system?.[0].text || '';
  assert.ok(system.startsWith('reglas\n\nResponde solo con un objeto JSON válido') && system.includes('"f19"'), 'the rules first, then the schema');
  assert.equal(claudeJsonText('```json\n{"f0":"a"}\n```'), '{"f0":"a"}');
  assert.equal(claudeJsonText('Aquí va: {"f0":"a"} listo'), '{"f0":"a"}');
});

test('the large schema answer is validated with the full schema', async () => {
  const wide = z.object({ ...Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index}`, z.string().nullable().optional()])), action: z.enum(['answer']) }).strict();
  const client: ClaudeClient = { messages: { stream: () => ({ on: () => undefined,
    finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"action":"answer","f3":null,"reports":[]}\n```' }], usage: { input_tokens: 10, output_tokens: 5 } }) }) } };
  const result = await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema: wide }, client);
  assert.deepEqual(result.data, { action: 'answer', f3: null }, 'an extra top-level key is dropped, not a retry');
});

test('an expensive Claude is refused before any request, even when called directly', async () => {
  const { client, captured } = fakeClient({});
  for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
    await assert.rejects(generateClaudeStructured({ model, prompt: 'p', schema }, client), /no está permitido/, model);
  }
  assert.equal(captured.params, null, 'nothing went out');
  assert.equal((await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema }, client)).data.reply, 'Listo.');
});

test('the request carries the format, the effort and room for thinking', () => {
  const low = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'p', systemPrompt: 's', schema, maxOutputTokens: 6000 });
  assert.equal(low.output_config.effort, 'low');
  assert.equal(low.output_config.format?.type, 'json_schema');
  assert.equal(low.max_tokens, 10000);
  assert.deepEqual(low.system, [{ type: 'text', text: 's', cache_control: { type: 'ephemeral' } }], 'the fixed rules are cached');
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
  for (const [message, pattern, calls] of [
    [{ stop_reason: 'refusal' }, /CLAUDE_REFUSAL/, 1],
    [{ stop_reason: 'max_tokens' }, /CLAUDE_MAX_TOKENS/, 1],
    // An answer that misses the schema gets one correction before it fails: both calls are paid.
    [{ text: '{"reply":' }, /JSON/, 2],
    [{ text: JSON.stringify({ ...answer, blocks: [] }) }, /at least 1|too_small|Array must contain/i, 2],
  ] as const) {
    const { client } = fakeClient(message);
    await assert.rejects(generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema }, client), (error: unknown) => {
      assert.match(String((error as Error).message), pattern);
      const telemetry = (error as { structuredTelemetry?: { usage?: { completion_tokens?: number } } }).structuredTelemetry;
      assert.equal(telemetry?.usage?.completion_tokens, 300 * calls, 'a paid answer keeps its usage');
      return true;
    });
  }
});

test('the schema tells the model the sizes the format cannot hold', () => {
  const json = claudeJsonSchema(z.object({
    reason: z.string().max(300).describe('Por qué.'),
    steps: z.array(z.string().max(120)).max(3),
    free: z.string(),
  }).strict());
  const properties = json.properties as Record<string, { description?: string; items?: { description?: string } }>;
  assert.equal(properties.reason.description, 'Por qué. Máximo 300 caracteres.', 'the description stays and the size follows');
  assert.equal(properties.steps.description, 'Máximo 3 elementos.');
  assert.equal(properties.steps.items?.description, 'Máximo 120 caracteres.');
  assert.equal(properties.free.description, undefined, 'a field without a limit says nothing');
  assert.ok(!JSON.stringify(json).includes('"maxLength"'), 'the keyword itself still never travels');
});

test('a text is cut at a word, closed with «…», and never past its limit', () => {
  const text = 'Revisar las bases administrativas y técnicas antes de postular por el plazo de cierre';
  const cut = claudeCut(text, 40);
  assert.ok(cut.length <= 40 && cut.endsWith('…') && !cut.includes('  '), cut);
  assert.equal(cut, 'Revisar las bases administrativas y…', 'at the last space that fits, without a loose word');
  assert.equal(claudeCut('corto', 40), 'corto');
  assert.equal(claudeCut('x'.repeat(100), 10), `${'x'.repeat(9)}…`, 'a text without spaces is cut where it must');
  assert.ok(claudeCut(`${'a'.repeat(8)}😀😀😀`, 10).length <= 10 && !/[\uD800-\uDBFF]…$/.test(claudeCut(`${'a'.repeat(9)}😀😀😀`, 11)), 'never in the middle of an emoji');
});

test('only a short text or a list over its limit is cut back; anything else goes to the model', () => {
  const limits = z.object({ reply: z.string().max(40), steps: z.array(z.string().max(30)).max(2), body: z.string().max(1000), count: z.number().max(5) }).strict();
  const parse = (value: unknown) => { try { limits.parse(value); return null; } catch (error) { return error; } };
  const base = { reply: 'Listo.', steps: ['a', 'b'], body: 'Hola', count: 1 };

  const long = { ...base, reply: 'Esta respuesta es bastante más larga de lo que el esquema permite', steps: ['a', 'b', 'c', 'd'] };
  const clamped = claudeClamp(long, parse(long));
  assert.ok(clamped, 'a short text and a list are cut');
  assert.deepEqual(clamped.cut, ['reply', 'steps']);
  assert.doesNotThrow(() => limits.parse(clamped.value));
  assert.equal((long.steps as string[]).length, 4, 'the answer it was given is not changed');

  const body = { ...base, body: 'x'.repeat(1500) };
  assert.equal(claudeClamp(body, parse(body)), null, 'a body someone reads whole is not cut');
  const number = { ...base, count: 9 };
  assert.equal(claudeClamp(number, parse(number)), null, 'a number is not cut');
  const mixed = { ...base, reply: 'y'.repeat(60), steps: 'no es una lista' };
  assert.equal(claudeClamp(mixed, parse(mixed)), null, 'a different problem next to it goes to the model');
});

test('an answer a little over a limit is cut back and costs no second call', async () => {
  const requests: unknown[] = [];
  const over = { ...answer, question: `${'¿Quieres que lo ajuste para el sector minero y la zona norte? '.repeat(10)}`, blocks: Array.from({ length: 5 }, () => answer.blocks[0]) };
  const client: ClaudeClient = { messages: { stream: params => { requests.push(params);
    return { on: () => undefined, finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(over) }], usage: { input_tokens: 100, output_tokens: 10 } }) }; } } };
  const result = await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema }, client);
  assert.equal(requests.length, 1);
  assert.equal(result.data.blocks.length, 3);
  assert.ok((result.data.question || '').length <= 400 && (result.data.question || '').endsWith('…'));
});

test('an answer that misses the schema in a way a cut cannot fix gets one correction, even with the format', async () => {
  const requests: Array<ReturnType<typeof claudeRequest>> = [];
  const answers = [{ ...answer, blocks: [{ ...answer.blocks[0], body: 'x'.repeat(13000) }] }, answer];
  const client: ClaudeClient = { messages: { stream: params => { requests.push(params);
    return { on: () => undefined, finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answers[requests.length - 1]) }], usage: { input_tokens: 100, output_tokens: 10 } }) }; } } };
  const result = await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema }, client);
  assert.deepEqual(result.data, answer);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].output_config.format, 'the correction keeps the format');
  assert.ok(String(requests[1].messages[2].content).includes('blocks.0.body'), 'it names the field that was too long');
  assert.equal(result.telemetry.usage.prompt_tokens, 200, 'both calls are paid');
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

test('an answer without the format that misses the schema gets one correction, told what was wrong', async () => {
  const wide = z.object({ ...Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`f${index}`, z.string().nullable().optional()])),
    action: z.enum(['answer', 'leads.search']), query: z.string().nullable() }).strict();
  const instruction = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'p', schema: wide }).system?.[0].text || '';
  assert.ok(instruction.includes('nunca null: action.') && instruction.includes('aunque sea en null: query.'), 'the fields that always carry a value are named');
  const requests: Array<ReturnType<typeof claudeRequest>> = [];
  const answers = ['{"action":null,"query":null}', '{"action":"answer","query":null}'];
  const client: ClaudeClient = { messages: { stream: params => { requests.push(params); const text = answers[requests.length - 1];
    return { on: () => undefined, finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 10 } }) }; } } };
  const result = await generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema: wide }, client);
  assert.deepEqual(result.data, { action: 'answer', query: null });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].messages.map(message => message.role), ['user', 'assistant', 'user']);
  assert.ok(String(requests[1].messages[2].content).includes('action'), 'the correction names the field');
  assert.equal((result.telemetry.usage as { prompt_tokens: number }).prompt_tokens, 200, 'both calls are paid');
  // A second miss is the caller's failure, with its usage.
  const twice: ClaudeClient = { messages: { stream: () => ({ on: () => undefined,
    finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"action":null,"query":null}' }], usage: { input_tokens: 100, output_tokens: 10 } }) }) } };
  await assert.rejects(generateClaudeStructured({ model: 'claude-haiku-5-5', prompt: 'p', schema: wide }, twice),
    (error: unknown) => (error as { structuredTelemetry?: { usage: { prompt_tokens: number } } }).structuredTelemetry?.usage.prompt_tokens === 200);
});

test('images and PDFs go before the prompt, the last one cached; without them the prompt stays a plain string', () => {
  assert.equal(claudeContent('Hola'), 'Hola');
  assert.equal(claudeContent('Hola', []), 'Hola');
  const content = claudeContent('Transcribe', [{ kind: 'image', mediaType: 'image/png', data: 'iVBO' }, { kind: 'pdf', mediaType: 'application/pdf', data: 'JVBE' }]);
  assert.deepEqual(content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' }, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'Transcribe' },
  ]);
  const request = claudeRequest({ model: 'claude-haiku-5-5', prompt: 'Transcribe', schema, attachments: [{ kind: 'image', mediaType: 'image/jpeg', data: '/9j/' }] },
    { previous: '{}', problem: 'falta reply' });
  assert.equal((request.messages[0].content as any[])[0].type, 'image', 'the correction keeps the image in the first turn');
  assert.equal(request.messages.length, 3);
});

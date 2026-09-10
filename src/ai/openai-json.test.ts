import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { z } from 'genkit';

import { generateStructured, generateStructuredWithTelemetry } from './openai-json';

type RequestBody = {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: string;
  response_format?: {
    type?: string;
    json_schema?: {
      name?: string;
      strict?: boolean;
      schema?: Record<string, unknown>;
    };
  };
  messages?: Array<{ role: string; content: string }>;
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function mockOpenAi(t: TestContext, implementation: typeof fetch) {
  const names = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'];
  const previous = names.map((name) => [name, process.env[name]] as const);
  t.after(() => previous.forEach(([name, value]) => restoreEnv(name, value)));
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_BASE_URL = 'https://openai.example/v1';
  process.env.OPENAI_MODEL = 'gpt-5.6-sol';
  t.mock.method(console, 'warn', () => {});
  return t.mock.method(globalThis, 'fetch', implementation);
}

test('separates prompts and sends a deterministic strict schema to OpenAI', async () => {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  const requestedBodies: RequestBody[] = [];

  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok","count":2}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const schema = z.object({ value: z.string().min(1), count: z.number().int() });
    const options = {
      prompt: 'Return a value.',
      systemPrompt: 'Extract the requested fields without adding commentary.',
      schema,
      provider: 'openai' as const,
      temperature: 0.2,
    };
    const firstResult = await generateStructured(options);
    const secondResult = await generateStructured(options);

    assert.deepEqual(firstResult, { value: 'ok', count: 2 });
    assert.deepEqual(secondResult, firstResult);
    assert.equal(requestedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requestedBodies.length, 2);
    assert.equal(requestedBodies[0].model, 'gpt-5.6-luna');
    assert.equal(requestedBodies[0].temperature, undefined);
    assert.equal(requestedBodies[0].max_completion_tokens, undefined);
    assert.equal(requestedBodies[0].reasoning_effort, undefined);
    assert.deepEqual(requestedBodies[0].messages, [
      { role: 'system', content: 'Extract the requested fields without adding commentary.' },
      { role: 'user', content: 'Return a value.' },
    ]);
    assert.equal(requestedBodies[0].response_format?.type, 'json_schema');
    assert.equal(requestedBodies[0].response_format?.json_schema?.strict, true);
    assert.match(requestedBodies[0].response_format?.json_schema?.name || '', /^structured_output_[0-9a-f]{8}$/);
    assert.equal(
      requestedBodies[1].response_format?.json_schema?.name,
      requestedBodies[0].response_format?.json_schema?.name,
    );
    assert.deepEqual(requestedBodies[0].response_format?.json_schema?.schema, {
      type: 'object',
      properties: {
        value: { type: 'string', minLength: 1 },
        count: { type: 'integer' },
      },
      required: ['value', 'count'],
      additionalProperties: false,
      $schema: 'https://json-schema.org/draft/2019-09/schema#',
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('OPENAI_API_KEY', previous.apiKey);
    restoreEnv('OPENAI_BASE_URL', previous.baseUrl);
    restoreEnv('OPENAI_MODEL', previous.model);
  }
});

test('keeps GLM provider configuration and JSON object response format', async () => {
  const previous = {
    apiKey: process.env.GLM_API_KEY,
    baseUrl: process.env.GLM_BASE_URL,
    model: process.env.SUPLIA_GLM_MODEL,
  };
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedBody: RequestBody = {};

  process.env.GLM_API_KEY = 'test-glm-key';
  process.env.GLM_BASE_URL = 'https://glm.example/v4/';
  process.env.SUPLIA_GLM_MODEL = 'glm-configured';
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"glm-ok"}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'glm',
      maxOutputTokens: 6000,
      reasoningEffort: 'low',
    });

    assert.deepEqual(result, { value: 'glm-ok' });
    assert.equal(requestedUrl, 'https://glm.example/v4/chat/completions');
    assert.equal(requestedBody.model, 'glm-configured');
    assert.equal(requestedBody.max_completion_tokens, undefined);
    assert.equal(requestedBody.reasoning_effort, undefined);
    assert.deepEqual(requestedBody.response_format, { type: 'json_object' });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('GLM_API_KEY', previous.apiKey);
    restoreEnv('GLM_BASE_URL', previous.baseUrl);
    restoreEnv('SUPLIA_GLM_MODEL', previous.model);
  }
});

test('removes boolean finite bounds from OpenAI JSON schemas', async () => {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  const originalFetch = globalThis.fetch;
  let requestedBody: RequestBody = {};

  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  globalThis.fetch = async (_input, init) => {
    requestedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":0.5,"website":"https://example.com"}' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    await generateStructured({
      prompt: 'Return a score.',
      schema: z.object({ score: z.number().finite(), website: z.string().url() }),
      provider: 'openai',
    });

    const scoreSchema = requestedBody.response_format?.json_schema?.schema?.properties as Record<string, any>;
    assert.notEqual(scoreSchema.score?.exclusiveMaximum, true);
    assert.notEqual(scoreSchema.score?.exclusiveMinimum, true);
    assert.notEqual(scoreSchema.website?.format, 'uri');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('OPENAI_API_KEY', previous.apiKey);
    restoreEnv('OPENAI_BASE_URL', previous.baseUrl);
    restoreEnv('OPENAI_MODEL', previous.model);
  }
});

test('falls back to the next model when runtime Zod parsing rejects output', async () => {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const requestedBodies: RequestBody[] = [];

  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  console.warn = () => {};
  globalThis.fetch = async (_input, init) => {
    const body: RequestBody = JSON.parse(String(init?.body || '{}'));
    requestedBodies.push(body);
    const content = body.model === 'primary-model' ? '{"value":42}' : '{"value":"fallback-ok"}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await generateStructuredWithTelemetry({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModels: ['primary-model', 'fallback-model'],
    });

    assert.deepEqual(result.data, { value: 'fallback-ok' });
    assert.equal(result.telemetry.modelName, 'fallback-model');
    assert.equal(result.telemetry.requestedModel, 'fallback-model');
    assert.equal(result.telemetry.usage, null);
    assert.deepEqual(requestedBodies.map((body) => body.model), ['primary-model', 'fallback-model']);
    assert.ok(requestedBodies.every((body) => body.response_format?.type === 'json_schema'));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    restoreEnv('OPENAI_API_KEY', previous.apiKey);
    restoreEnv('OPENAI_BASE_URL', previous.baseUrl);
    restoreEnv('OPENAI_MODEL', previous.model);
  }
});

test('preserves the global model fallback by default and when explicitly enabled', async (t) => {
  const models: string[] = [];
  mockOpenAi(t, async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    return body.model === 'primary-model'
      ? new Response('unavailable', { status: 500 })
      : Response.json({ choices: [{ message: { content: '{"value":"ok"}' } }] });
  });

  for (const allowDefaultModelFallback of [undefined, true]) {
    models.length = 0;
    const result = await generateStructuredWithTelemetry({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModel: 'primary-model',
      allowDefaultModelFallback,
    });
    assert.deepEqual(models, ['primary-model', 'gpt-5.6-sol']);
    assert.equal(result.telemetry.modelName, 'gpt-5.6-sol');
    assert.equal(result.telemetry.requestedModel, 'gpt-5.6-sol');
  }
});

test('disabling the default fallback preserves only explicit, deduplicated models', async (t) => {
  const models: string[] = [];
  mockOpenAi(t, async (_input, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    return new Response('unavailable', { status: 500 });
  });

  for (const openAiModels of [undefined, [' primary-model ', 'primary-model']]) {
    models.length = 0;
    await assert.rejects(generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModel: 'fallback-model',
      openAiModels,
      allowDefaultModelFallback: false,
    }), /OPENAI_HTTP_500/);
    assert.deepEqual(models, openAiModels ? ['primary-model', 'fallback-model'] : ['fallback-model']);
  }
});

test('fails closed without explicit models when default fallback is disabled', async (t) => {
  const fetchMock = mockOpenAi(t, async () => assert.fail('No request should be sent.'));
  await assert.rejects(generateStructured({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModels: [' ', ''],
    allowDefaultModelFallback: false,
  }), /Specify openAiModel or openAiModels/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('sends requested GPT-5 token controls and records the effective response model and usage', async (t) => {
  let body: RequestBody = {};
  const usage = { prompt_tokens: 100, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 10 } };
  mockOpenAi(t, async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      model: 'gpt-5.6-luna-2026-09-08',
      choices: [{ message: { content: '{"value":"ok"}' } }],
      usage,
    });
  });

  const result = await generateStructuredWithTelemetry({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModel: 'gpt-5.6-luna',
    maxOutputTokens: 6000,
    reasoningEffort: 'high',
  });
  assert.deepEqual(result.data, { value: 'ok' });
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.max_completion_tokens, 6000);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, undefined);
  assert.equal(result.telemetry.modelName, 'gpt-5.6-luna-2026-09-08');
  assert.equal(result.telemetry.requestedModel, 'gpt-5.6-luna');
  assert.deepEqual(result.telemetry.usage, usage);
  assert.ok(result.telemetry.durationMs >= 0);
});

test('omits GPT-5 reasoning controls for other OpenAI models', async (t) => {
  let body: RequestBody = {};
  mockOpenAi(t, async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: '{"value":"ok"}' } }] });
  });
  await generateStructured({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModel: 'gpt-4o',
    maxOutputTokens: 1000,
    reasoningEffort: 'low',
    temperature: 0.2,
  });
  assert.equal(body.max_completion_tokens, 1000);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.temperature, 0.2);
});

test('does not send requests for an already cancelled caller', async (t) => {
  const fetchMock = mockOpenAi(t, async () => assert.fail('No request should be sent.'));
  const caller = new AbortController();
  const reason = new Error('Caller cancelled before generation.');
  caller.abort(reason);
  await assert.rejects(generateStructured({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModels: ['primary-model', 'fallback-model'],
    signal: caller.signal,
    timeoutMs: 75_000,
  }), (error) => error === reason);
  assert.equal(fetchMock.mock.callCount(), 0);
});

for (const timeoutMs of [undefined, 75_000]) {
  test(`caller cancellation stops all models with timeout ${timeoutMs ?? 'unset'}`, async (t) => {
    const caller = new AbortController();
    const reason = new Error('Caller cancelled a 429 request.');
    let signal: AbortSignal | null | undefined;
    const fetchMock = mockOpenAi(t, async (_input, init) => {
      signal = init?.signal;
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });
    const generation = generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModels: ['primary-model', 'fallback-model'],
      signal: caller.signal,
      timeoutMs,
    });
    const rejected = assert.rejects(generation, (error) => error === reason);
    assert.ok(signal);
    if (timeoutMs !== undefined) assert.notEqual(signal, caller.signal);
    caller.abort(reason);
    await rejected;
    assert.equal(signal.aborted, true);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const phase of ['headers', 'body', 'error body']) {
  test(`deadline aborts stalled response ${phase} without trying other models`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const caller = new AbortController();
    let signal: AbortSignal | null | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const fetchMock = mockOpenAi(t, async (_input, init) => {
      signal = init?.signal;
      const waitForAbort = () => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        markStarted();
      });
      if (phase === 'headers') return waitForAbort();
      const response = new Response(null, { status: phase === 'error body' ? 429 : 200 });
      t.mock.method(response, phase === 'error body' ? 'text' : 'json', waitForAbort);
      return response;
    });
    const generation = generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModels: ['primary-model', 'fallback-model'],
      signal: phase === 'headers' ? undefined : caller.signal,
      timeoutMs: 75_000,
    });
    const rejected = assert.rejects(generation, { name: 'TimeoutError' });
    await started;
    t.mock.timers.tick(74_999);
    assert.equal(signal?.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal?.aborted, true);
    assert.equal(caller.signal.aborted, false);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test('retries 429 three times with fresh deadlines and clears completed attempt timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  const fetchMock = mockOpenAi(t, async (_input, init) => {
    assert.ok(init?.signal);
    signals.push(init.signal);
    return signals.length < 3
      ? new Response('rate limited', { status: 429 })
      : Response.json({ choices: [{ message: { content: '{"value":"ok"}' } }] });
  });
  const generation = generateStructured({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModel: 'gpt-5.6-luna',
    allowDefaultModelFallback: false,
    timeoutMs: 1000,
  });
  for (const delay of [700, 1400]) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    t.mock.timers.tick(delay);
  }
  assert.deepEqual(await generation, { value: 'ok' });
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(new Set(signals).size, 3);
  t.mock.timers.tick(1000);
  assert.ok(signals.every((signal) => !signal.aborted));
});

test('caller cancellation interrupts rate-limit backoff without retrying or falling back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  const reason = new Error('Caller cancelled during rate-limit backoff.');
  const fetchMock = mockOpenAi(t, async () => new Response('rate limited', { status: 429 }));
  const generation = generateStructured({
    prompt: 'Return a value.',
    schema: z.object({ value: z.string() }),
    provider: 'openai',
    openAiModels: ['primary-model', 'fallback-model'],
    signal: caller.signal,
    timeoutMs: 75_000,
  });
  const rejected = assert.rejects(generation, (error) => error === reason);
  await new Promise<void>((resolve) => setImmediate(resolve));
  caller.abort(reason);
  await rejected;
  t.mock.timers.runAll();
  assert.equal(fetchMock.mock.callCount(), 1);
});

for (const name of ['AbortError', 'TimeoutError']) {
  test(`treats fetch ${name} as terminal even if its message mentions 429`, async (t) => {
    const reason = new DOMException('429 request aborted', name);
    const fetchMock = mockOpenAi(t, async () => { throw reason; });
    await assert.rejects(generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModels: ['primary-model', 'fallback-model'],
    }), (error) => error === reason);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { z } from 'genkit';

import { generateStructuredWithTelemetry } from './openai-json';
import { getReportModels, reportGenerationOptions } from './report-models';

const MODEL_ENV_NAMES = [
  'OPENAI_MODEL',
  'OPENAI_FAST_MODEL',
  'OPENAI_BALANCED_MODEL',
  'OPENAI_ORCHESTRATOR_MODEL',
  'OPENAI_REASONING_MODEL',
  'OPENAI_CRITICAL_MODEL',
  'OPENAI_FALLBACK_MODEL',
  'OPENAI_LEGACY_FALLBACK_MODEL',
  'SUPLIA_OPENAI_FAST_MODEL',
  'SUPLIA_OPENAI_BALANCED_MODEL',
  'SUPLIA_OPENAI_ORCHESTRATOR_MODEL',
  'SUPLIA_OPENAI_REASONING_MODEL',
  'SUPLIA_OPENAI_CRITICAL_MODEL',
  'SUPLIA_OPENAI_FALLBACK_MODEL',
  'SUPLIA_OPENAI_LEGACY_FALLBACK_MODEL',
  'NATIVE_RESEARCH_REPORT_MODEL',
];

function mockReportEnv(t: TestContext, model = 'gpt-5.6-sol') {
  const overrides = {
    ...Object.fromEntries(MODEL_ENV_NAMES.map((name) => [name, model])),
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: 'https://openai.example/v1',
    AI_PROVIDER: 'glm',
    SUPLIA_AI_PROVIDER: 'glm',
  };
  const previous = Object.keys(overrides).map((name) => [name, process.env[name]] as const);
  t.after(() => previous.forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }));
  Object.assign(process.env, overrides);
  t.mock.method(console, 'warn', () => {});
}

const TIERS = ['fast', 'balanced', 'reasoning'] as const;

for (const override of ['gpt-5.6-sol', 'gpt-5.6-astra', 'gpt-5.6-terra']) {
  test(`report models and limits ignore ${override} environment overrides`, (t) => {
    mockReportEnv(t, override);
    for (const tier of TIERS) {
      const expected = ['gpt-5.6-luna'];
      assert.deepEqual(getReportModels(tier), expected);
      assert.deepEqual(reportGenerationOptions(tier), {
        provider: 'openai',
        openAiModels: expected,
        allowDefaultModelFallback: false,
        timeoutMs: 75_000,
        maxOutputTokens: 6000,
        reasoningEffort: 'low',
        maxAttempts: 1,
      });
      getReportModels(tier).push(override);
      reportGenerationOptions(tier).openAiModels.push(override);
      assert.deepEqual(getReportModels(tier), expected);
      assert.deepEqual(reportGenerationOptions(tier).openAiModels, expected);
    }
  });
}

for (const tier of TIERS) {
  test(`${tier} report API failures never escalate to the global Sol fallback`, async (t) => {
    mockReportEnv(t);
    const models: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      assert.equal(String(input), 'https://openai.example/v1/chat/completions');
      assert.equal(body.max_completion_tokens, 6000);
      assert.equal(body.reasoning_effort, 'low');
      assert.equal(body.temperature, undefined);
      assert.equal(body.max_tokens, undefined);
      assert.ok(init?.signal);
      return new Response('unavailable', { status: 500 });
    });
    await assert.rejects(generateStructuredWithTelemetry({
      ...reportGenerationOptions(tier),
      prompt: 'Return a report.',
      schema: z.object({ summary: z.string() }),
    }), /OPENAI_HTTP_500/);
    assert.deepEqual(models, getReportModels(tier));
  });
}

test('reasoning reports use Luna and expose the actual model', async (t) => {
  mockReportEnv(t);
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    return Response.json({
      model: `${body.model}-2026-09-08`,
      choices: [{ message: { content: '{"summary":"ok"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    });
  });
  const result = await generateStructuredWithTelemetry({
    ...reportGenerationOptions('reasoning'),
    prompt: 'Return a report.',
    schema: z.object({ summary: z.string() }),
  });
  assert.deepEqual(models, ['gpt-5.6-luna']);
  assert.deepEqual(result.data, { summary: 'ok' });
  assert.equal(result.telemetry.modelName, 'gpt-5.6-luna-2026-09-08');
  assert.equal(result.telemetry.requestedModel, 'gpt-5.6-luna');
  assert.deepEqual(result.telemetry.usage, { prompt_tokens: 100, completion_tokens: 30 });
});

test('report rate limits attempt each allowed model only once', async (t) => {
  mockReportEnv(t);
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body)).model);
    return new Response('rate limited', { status: 429 });
  });
  await assert.rejects(generateStructuredWithTelemetry({
    ...reportGenerationOptions('reasoning'),
    prompt: 'Return a report.',
    schema: z.object({ summary: z.string() }),
  }), /OPENAI_HTTP_429/);
  assert.deepEqual(models, ['gpt-5.6-luna']);
});

test('invalid Luna output fails closed without escalating to Terra', async (t) => {
  mockReportEnv(t, 'gpt-5.6-terra');
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    models.push(JSON.parse(String(init?.body)).model);
    return Response.json({ choices: [{ message: { content: '{"summary":42}' } }] });
  });
  await assert.rejects(generateStructuredWithTelemetry({
    ...reportGenerationOptions('reasoning'), prompt: 'Return a report.', schema: z.object({ summary: z.string() }),
  }));
  assert.deepEqual(models, ['gpt-5.6-luna']);
});

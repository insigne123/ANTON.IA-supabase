import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'genkit';

import { generateStructured } from './openai-json';

type RequestBody = {
  model?: string;
  temperature?: number;
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
    });

    assert.deepEqual(result, { value: 'glm-ok' });
    assert.equal(requestedUrl, 'https://glm.example/v4/chat/completions');
    assert.equal(requestedBody.model, 'glm-configured');
    assert.deepEqual(requestedBody.response_format, { type: 'json_object' });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('GLM_API_KEY', previous.apiKey);
    restoreEnv('GLM_BASE_URL', previous.baseUrl);
    restoreEnv('SUPLIA_GLM_MODEL', previous.model);
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
    const result = await generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
      openAiModels: ['primary-model', 'fallback-model'],
    });

    assert.deepEqual(result, { value: 'fallback-ok' });
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

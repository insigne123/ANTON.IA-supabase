import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'genkit';

import { generateStructured } from './openai-json';

test('uses Luna on Chat Completions for generic OpenAI generation', async () => {
  const previous = {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  };
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedBody: Record<string, unknown> = {};

  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"value":"ok"}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await generateStructured({
      prompt: 'Return a value.',
      schema: z.object({ value: z.string() }),
      provider: 'openai',
    });
    assert.deepEqual(result, { value: 'ok' });
    assert.equal(requestedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requestedBody.model, 'gpt-5.6-luna');
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.apiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.apiKey;
    if (previous.baseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previous.model;
  }
});

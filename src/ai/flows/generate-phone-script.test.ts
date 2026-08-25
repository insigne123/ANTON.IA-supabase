import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePhoneScript } from './generate-phone-script';

test('generates a structured phone script through the generic Luna model', async () => {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_MODEL;
  const originalFetch = globalThis.fetch;
  let requestedBody: Record<string, any> = {};

  process.env.OPENAI_API_KEY = 'test-openai-key';
  delete process.env.OPENAI_MODEL;
  globalThis.fetch = async (_input, init) => {
    requestedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            opening: 'Hola Ana.',
            pitch: 'Ayudamos a equipos como el tuyo.',
            objections: '- Ya tenemos proveedor: podemos complementar.',
            closing: '¿Te acomoda el jueves o el viernes?',
          }),
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await generatePhoneScript({
      report: { pains: ['Tiempo de respuesta'] },
      companyProfile: { name: 'ANTON.IA' },
      lead: { fullName: 'Ana', country: 'Chile' },
    });
    assert.equal(result.opening, 'Hola Ana.');
    assert.equal(requestedBody.model, 'gpt-5.6-luna');
    assert.equal(requestedBody.response_format && requestedBody.response_format.type, 'json_object');
    assert.match(String((requestedBody.messages as Array<{ content: string }>)[1].content), /ANTON\.IA/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousModel;
  }
});

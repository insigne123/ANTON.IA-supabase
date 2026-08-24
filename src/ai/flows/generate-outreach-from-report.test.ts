import assert from 'node:assert/strict';
import test from 'node:test';

import { generateOutreachFromDraftContextV2 } from './generate-outreach-from-report';
import { draftContextFixture } from '@/lib/server/draft-v2-test-fixtures';

test('DraftContextV2 generation fails closed when OpenAI is unavailable, even if another provider is configured', async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousProvider = process.env.AI_PROVIDER;
  const previousGlmKey = process.env.GLM_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_PROVIDER = 'glm';
    process.env.GLM_API_KEY = 'configured-but-not-used';

    await assert.rejects(
      () => generateOutreachFromDraftContextV2({ context: draftContextFixture() }),
      /OPENAI_API_KEY/,
    );
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    if (previousGlmKey === undefined) delete process.env.GLM_API_KEY;
    else process.env.GLM_API_KEY = previousGlmKey;
  }
});

test('DraftContextV2 generation exposes only the server-selected factual evidence to OpenAI', async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body || '{}'));
      prompt = String(request.messages?.[1]?.content || '');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ subject: 'Una idea para Acme', body: 'Contenido factual.' }) } }],
        usage: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const baseContext = draftContextFixture();
    const context = {
      ...baseContext,
      evidence: [...baseContext.evidence, {
        ...baseContext.evidence[0],
        evidenceId: 'evidence-unsupported-signal',
        statement: 'Acme necesita contratar urgentemente.',
        supportedFactClaimIds: [],
      }],
    };

    const result = await generateOutreachFromDraftContextV2({ context });

    assert.equal(result.personalization[0].claimId, 'claim-acme-overview');
    assert.deepEqual(result.hypothesisIds, []);
    assert.match(prompt, /"hypotheses":\[\]/);
    assert.doesNotMatch(prompt, /Acme necesita contratar urgentemente/);
    assert.doesNotMatch(prompt, /claim-acme-opportunity/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

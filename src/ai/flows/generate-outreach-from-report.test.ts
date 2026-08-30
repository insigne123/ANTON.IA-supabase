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
    assert.match(prompt, /El servidor lo agregará literalmente una sola vez al final/);
    assert.match(prompt, /No agregues ninguna pregunta, invitación a actuar/);
    assert.match(prompt, /paráfrasis natural y fiel/);
    assert.match(prompt, /no por un equipo de marketing/);
    assert.match(prompt, /No incluyas firma/);
    assert.doesNotMatch(prompt, /gpt-4o-mini/);
    assert.doesNotMatch(prompt, /Acme necesita contratar urgentemente/);
    assert.doesNotMatch(prompt, /claim-acme-opportunity/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

test('DraftContextV2 generation reserves words for server-side CTA normalization', async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body || '{}'));
      prompt = String(request.messages?.[1]?.content || '');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ subject: 'Procesos en Acme', body: 'Acme reduce trabajo manual. Northstar ordena tareas repetitivas para que el equipo encuentre información y responda consultas con menos pasos.' }) } }],
        usage: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await generateOutreachFromDraftContextV2({ context: draftContextFixture() });

    assert.match(prompt, /Devuelve entre 62 y 112 palabras/);
    assert.match(prompt, /reserva margen si el servidor debe quitar un CTA no aprobado/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

test('DraftContextV2 generation consumes the validated report brief and prioritizes its canonical anchor', async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body || '{}'));
      prompt = String(request.messages?.[1]?.content || '');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ subject: 'Una idea para Ada', body: 'Contenido factual.' }) } }],
        usage: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const baseContext = draftContextFixture();
    const context = {
      ...baseContext,
      report: {
        synthesis: { method: 'model' as const, status: 'completed' as const },
        outreachBrief: {
          selectedFactualAnchorClaimIds: ['claim-ada-role'],
          selectedHypothesisIds: ['claim-acme-opportunity'],
          doNotClaim: ['No presentar hipótesis como necesidades confirmadas.'],
        },
      },
    };

    const result = await generateOutreachFromDraftContextV2({ context });

    assert.equal(result.personalization[0].claimId, 'claim-acme-overview');
    assert.match(prompt, /REPORT_OUTREACH_BRIEF/);
    assert.match(prompt, /claim-ada-role/);
    assert.match(prompt, /No presentar hipótesis como necesidades confirmadas/);
    assert.match(prompt, /Acme publica que ayuda a equipos de operaciones a reducir trabajo manual/);
    assert.doesNotMatch(prompt, /Directora de Operaciones/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

test('DraftContextV2 generation labels a campaign step instruction as non-factual guidance', async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body || '{}'));
      prompt = String(request.messages?.[1]?.content || '');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ subject: 'Seguimiento breve', body: 'Contenido factual.' }) } }],
        usage: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    await generateOutreachFromDraftContextV2({
      context: draftContextFixture(),
      instruction: 'Retoma el valor principal sin repetir el correo inicial.',
    });

    assert.match(prompt, /CAMPAIGN_STEP_INSTRUCTION/);
    assert.match(prompt, /Retoma el valor principal sin repetir el correo inicial/);
    assert.match(prompt, /estrategia de redacción, no evidencia factual/);
    assert.match(prompt, /sin relajar ninguna regla no negociable/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

test('DraftContextV2 generation strips sequence metadata and formal titles from the writing context', async () => {
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

    await generateOutreachFromDraftContextV2({
      context: draftContextFixture(),
      sequenceContext: {
        sequenceInstruction: 'Haz un seguimiento con un ángulo nuevo.',
        priorMessages: [{
          kind: 'initial',
          index: 0,
          name: 'Seguimiento inicial',
          subject: 'Seguimiento breve',
          body: 'Por tu rol de Directora de Operaciones, pensé en un ángulo acotado para este seguimiento.',
        }],
        currentStep: {
          index: 1,
          total: 2,
          name: 'Segundo seguimiento',
          offsetDays: 3,
          instruction: 'Aporta un ángulo nuevo en este seguimiento.',
        },
      },
    });

    assert.match(prompt, /SEQUENCE_WRITING_CONTEXT \(metadata privada de redacción, no publicable\)/);
    assert.match(prompt, /Nunca menciones ni copies los nombres, etapas, días, instrucciones o la secuencia/);
    assert.doesNotMatch(prompt, /Seguimiento inicial|Segundo seguimiento|Directora de Operaciones|offsetDays/);
    const sequenceStart = prompt.indexOf('SEQUENCE_WRITING_CONTEXT');
    const sequenceEnd = prompt.indexOf('\n\nUsa estos mensajes', sequenceStart);
    assert.ok(sequenceStart >= 0 && sequenceEnd > sequenceStart);
    assert.doesNotMatch(prompt.slice(sequenceStart, sequenceEnd), /ángulo acotado/);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
});

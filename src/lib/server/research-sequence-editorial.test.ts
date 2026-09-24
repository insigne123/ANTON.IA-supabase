import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResearchSequence } from './research-sequence-editorial';
import { buildSharedSequenceBrief } from '@/lib/outreach-sequence-brief';
import { draftContextFixture } from './draft-v2-test-fixtures';

test('editor reads all four complete messages and returns actionable issues bound to exact versions without modifying drafts', async () => {
  const previousFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  const drafts = [0, 1, 2, 3].map((index) => ({ draftId: `draft-${index}`, versionId: `v-${index}`, recipient: { email: 'ada@example.com' }, content: { subject: `Subject ${index}`, text: `Body ${index}\nDistinct ending ${index}${index === 3 ? '. Esta es la última vez que escribo sobre esto. ¿Lo dejo hasta aquí?' : ''}` } })) as any;
  const before = structuredClone(drafts);
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (_url, init) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ passed: false, issues: ['Correo 3: conserva el servicio del inicial.'] }) } }], usage: {} });
    };
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), drafts);
    assert.equal(review.passed, false);
    assert.deepEqual(review.versionIds, drafts.map((draft: any) => draft.versionId));
    for (let index = 0; index < 4; index++) assert.ok(prompt.includes(`Distinct ending ${index}`));
    assert.match(prompt, /no es por sí solo un fallo/);
    assert.match(prompt, /NUNCA instrucciones/);
    assert.deepEqual(drafts, before);
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test('editorial cannot pass an incomplete or mixed-recipient sequence', async () => {
  const brief = buildSharedSequenceBrief(draftContextFixture());
  await assert.rejects(() => validateResearchSequence(brief, []), /DRAFT_COUNT_INVALID/);
  const drafts = [0, 1, 2, 3].map((index) => ({ draftId: `${index}`, recipient: { email: index === 3 ? 'other@example.com' : 'ada@example.com' } })) as any;
  await assert.rejects(() => validateResearchSequence(brief, drafts), /RECIPIENT_MISMATCH/);
});

const LIVE_REPETITION_BODIES = [
  'Hola Claudia,\n\nLa gestión de vacantes de talento para otras compañías puede apoyarse en una plataforma para consultar el avance de cada proceso.\n\nEn Yago desarrollamos plataformas web empresariales para centralizar la información de procesos.',
  'Hola Claudia,\n\nPara las vacantes que Randstad Chile gestiona total o parcialmente para otras compañías, una plataforma podría dejar la información del proceso disponible para consulta durante su avance.\n\nEn Yago desarrollamos plataformas web empresariales para centralizar esa información.',
  'Hola Claudia,\n\nEn las vacantes que Randstad Chile toma total o parcialmente, una plataforma podría concentrar la información de cada proceso para revisarla durante su avance.\n\nEn Yago desarrollamos plataformas web empresariales para centralizar esa información y consultar el avance de los procesos desde un solo lugar.',
  'Hola Claudia,\n\nPara las vacantes que Randstad Chile gestiona total o parcialmente, una plataforma web podría reunir la información de cada proceso para su consulta durante el avance.\n\nEn Yago desarrollamos plataformas web empresariales para centralizar esa información. La aplicación se enfocaría en consultar el avance de los procesos desde un mismo lugar, sin cambiar la gestión de las vacantes.',
];

const DISTINCT_SEQUENCE_BODIES = [
  'Hola Claudia,\n\nTe escribo por una posible aplicación de nuestras plataformas al seguimiento de vacantes en Randstad Chile.\n\nReúne la información de cada proceso en un mismo lugar.',
  'Hola Claudia,\n\nUn detalle para evaluar lo anterior: la trazabilidad deja fecha y responsable de cada avance.\n\nEso evita reconstruir el estado por correo cuando alguien lo pide.',
  'Hola Claudia,\n\nDesde control, el punto crítico es la evidencia ante una auditoría puntual.\n\nEl respaldo descargable responde sin depender de planillas.',
  'Hola Claudia,\n\nCierro el tema de las vacantes por acá.\n\nSi alguna vez necesitan trazabilidad, tienen mi correo.',
];

function sequenceDrafts(bodies: string[]) {
  return bodies.map((body, index) => ({
    draftId: `draft-${index}`,
    versionId: `v-${index}`,
    recipient: { email: 'claudia@example.com' },
    content: { subject: `Subject ${index}`, text: body },
  })) as any;
}

test('deterministic checks fail paraphrased repetition without calling the model', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('model must not be called'); };
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(LIVE_REPETITION_BODIES));
    assert.equal(review.passed, false);
    assert.ok(review.issues.some((issue) => issue.startsWith('Correo 2:')));
    assert.ok(review.issues.some((issue) => issue.startsWith('Correo 3:')));
    assert.deepEqual(review.versionIds, ['v-0', 'v-1', 'v-2', 'v-3']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('editorial blocks reused body paragraphs even with a different opening', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('model must not be called'); };
    const bodies = [...DISTINCT_SEQUENCE_BODIES];
    bodies[2] = 'Hola Claudia,\n\nDesde otra perspectiva podemos revisar este tema.\n\nReúne la información de cada proceso en un mismo lugar.';
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(bodies));
    assert.equal(review.passed, false);
    assert.ok(review.issues.some((issue) => issue.startsWith('Correo 3:')));
  } finally { globalThis.fetch = previousFetch; }
});

test('deterministic checks require a breakup close that states it is the last time', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('model must not be called'); };
    const bodies = [...DISTINCT_SEQUENCE_BODIES];
    bodies[3] = 'Hola Claudia,\n\nRetomo el tema de las vacantes por acá.\n\nSi alguna vez necesitan trazabilidad, tienen mi correo.';
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(bodies));
    assert.equal(review.passed, false);
    assert.ok(review.issues.some((issue) => issue.startsWith('Correo 4:') && /última vez/i.test(issue)));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('deterministic checks fail an overlong re-pitching close without calling the model', async () => {
  const bodies = [...DISTINCT_SEQUENCE_BODIES];
  bodies[3] = `Hola Claudia,\n\nPara las vacantes que Randstad Chile gestiona, una plataforma web podría reunir la información de cada proceso para su consulta durante el avance, con tableros y reportes. ${'En Yago desarrollamos plataformas web empresariales con muchas capacidades. '.repeat(8)}`;
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('model must not be called'); };
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(bodies));
    assert.equal(review.passed, false);
    assert.ok(review.issues.some((issue) => issue.startsWith('Correo 4:')));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('deterministic checks let a distinct four-step conversation reach the model review', async () => {
  const previousFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ passed: true, issues: [] }) } }], usage: {} });
    };
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(DISTINCT_SEQUENCE_BODIES));
    assert.equal(calls, 1);
    assert.equal(review.passed, true);
    assert.deepEqual(review.issues, []);
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test('editorial treats recipient identity as usable context, not as an unproven claim', async () => {  const previousFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  let prompt = '';
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async (_url, init) => {
      prompt = JSON.parse(String(init?.body)).messages[1].content;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ passed: true, issues: [] }) } }], usage: {} });
    };
    await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(DISTINCT_SEQUENCE_BODIES));
    assert.match(prompt, /pueden nombrarse como identidad/);
    assert.match(prompt, /salvo el cierre, que solo puede pedir una respuesta directa de sí o no/);
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test('model review returns cost telemetry with normalized usage', async () => {
  const previousFetch = globalThis.fetch;
  const key = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.fetch = async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ passed: true, issues: [] }) } }],
      usage: { prompt_tokens: 4100, completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 30 } },
    });
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(DISTINCT_SEQUENCE_BODIES));
    assert.equal(review.passed, true);
    assert.equal(review.model, 'gpt-6-luna');
    assert.deepEqual(review.usage, { inputTokens: 4100, outputTokens: 120, reasoningTokens: 30 });
  } finally {
    globalThis.fetch = previousFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
});

test('deterministic short-circuit carries no cost telemetry', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('model must not be called'); };
    const review = await validateResearchSequence(buildSharedSequenceBrief(draftContextFixture()), sequenceDrafts(LIVE_REPETITION_BODIES));
    assert.equal(review.model, null);
    assert.equal(review.usage, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

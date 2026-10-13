import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkLiveDraft } from '@/lib/cowork/partial-json';
import type { CoworkAnalysisBrief } from '@/lib/cowork/analyst';
import { coworkAnalystEnabled, coworkAnalystModel, coworkAnalystTurn } from './analyst-run';

const output = {
  reply: 'Respondieron 4 de 46 contactos por correo, el 8,7 %. Todavía no es concluyente.',
  blocks: [{ type: 'metrics', title: 'Correo, últimos 30 días', period: 'Últimos 30 días',
    items: [{ label: 'Respuestas', value: '4', detail: '4 de 46 envíos' }, { label: 'Tasa', value: '8,7 %', detail: 'sobre 46 envíos' }] },
  { type: 'table', title: 'Vacía', columns: ['Canal'], rows: [] }],
  document: null,
  question: '¿Escribo el correo para probar el rubro retail con 20 contactos?',
  suggestions: [{ label: 'Sí, escríbelo', message: 'Sí, escribe el correo de prueba' }],
};
const brief: CoworkAnalysisBrief = { question: '¿Cómo me ha ido este mes?', focus: null, notes: null };

function harness(timeLeft = () => 90_000) {
  const log: string[] = [];
  const pushed: string[] = [];
  const prompts: string[] = [];
  const options: Array<{ timeoutMs: number; maxOutputTokens: number; openAiModel?: string }> = [];
  const analyze = coworkAnalystTurn({
    request: '¿cómo me ha ido este mes?', userContext: { fullName: 'Nicolás Yarur' },
    history: [{ at: '2026-10-01T15:00:00Z', request: 'hola', reply: 'Hola, ¿en qué te ayudo?' }],
    signal: new AbortController().signal, authorize: async () => {},
    reserve: async role => { log.push(`reserve:${role}`); return `call-${role}`; },
    generate: async call => {
      options.push({ timeoutMs: call.timeoutMs, maxOutputTokens: call.maxOutputTokens, openAiModel: call.openAiModel });
      prompts.push(call.prompt);
      const text = JSON.stringify(output);
      for (const size of [30, text.length]) call.onPartial?.(text.slice(0, size));
      return { data: call.schema.parse(output), telemetry: { modelName: call.openAiModel || 'm', durationMs: 5 } };
    },
    recordUsage: async id => { log.push(`usage:${id}`); },
    record: async event => { log.push(`step:${event.result.agent}:${event.result.state}`); },
    liveDraft: { push: text => { pushed.push(text); }, flush: async () => { log.push('flush'); } },
    timeLeft, timeZone: 'America/Santiago', model: 'analyst-model', now: () => new Date('2026-10-06T15:00:00Z'),
  });
  return { analyze, log, pushed, prompts, options };
}

test('the Analyst answers with what the turn read, streamed into the live draft, under the writer role', async () => {
  const h = harness();
  const answer = await h.analyze(brief, [{ action: 'metrics.rates', input: 'last_30_days', result: { sent: 46, replies: 4 } }]);
  // An empty card is dropped; the rest is the turn's answer as the Analyst wrote it.
  assert.deepEqual(answer, { reply: output.reply, document: null, blocks: [output.blocks[0]], question: output.question, suggestions: output.suggestions });
  assert.deepEqual(h.log, ['step:analyst:working', 'reserve:writer', 'flush', 'usage:call-writer', 'step:analyst:done']);
  assert.equal(coworkLiveDraft(h.pushed.at(-1) || '')?.reply, output.reply);
  assert.deepEqual(h.options, [{ timeoutMs: 40_000, maxOutputTokens: 4000, openAiModel: 'analyst-model' }]);
  // It reads the brief, the data, the last turns and today's date in the person's time zone.
  const prompt = JSON.parse(h.prompts[0]);
  assert.deepEqual(prompt.brief, brief);
  assert.equal(prompt.observations[0].action, 'metrics.rates');
  assert.equal(prompt.history[0].request, 'hola');
  assert.match(prompt.clock.localDate, /octubre de 2026/);
});

test('without time for its call the Analyst does not start, and the loop answers without it', async () => {
  const h = harness(() => 10_000);
  await assert.rejects(h.analyze(brief, []), /time exhausted/);
  assert.deepEqual(h.log, []);
});

test('the Analyst is off unless its flag says so, and uses COWORK_MODEL unless it has its own', () => {
  assert.equal(coworkAnalystEnabled({}), false);
  assert.equal(coworkAnalystEnabled({ COWORK_ANALYST_ENABLED: 'true' }), true);
  assert.equal(coworkAnalystModel({ COWORK_MODEL: 'gpt-6-luna' }), 'gpt-6-luna');
  assert.equal(coworkAnalystModel({ COWORK_MODEL: 'gpt-6-luna', COWORK_ANALYST_MODEL: 'gpt-6.1-sol' }), 'gpt-6.1-sol');
});

test('a report to send comes back as a document, and the Analyst never talks about the mailbox coverage (v14)', async () => {
  const { coworkAnalystAnswer, coworkAnalystOutputSchema, COWORK_ANALYST_RULES } = await import('@/lib/cowork/analyst');
  const report = { title: 'Prospección de septiembre 2026', content: '# Prospección de septiembre 2026\n\nSin envíos este mes.\n\n## Próximos pasos\n\n- Activar una campaña.' };
  assert.deepEqual(coworkAnalystAnswer(coworkAnalystOutputSchema.parse({ ...output, document: report })).document, report);
  assert.equal(coworkAnalystAnswer(coworkAnalystOutputSchema.parse(output)).document, null);
  assert.match(COWORK_ANALYST_RULES.join('\n'), /document: si el pedido es un informe o un resumen para enviar o compartir/);
  assert.match(COWORK_ANALYST_RULES.join('\n'), /Nunca hables de la «cobertura» del correo/);
});

test('the Analyst says the figures without their technical limits, fits its actions to the account and always offers the step that moves small figures (v15)', async () => {
  const { COWORK_ANALYST_RULES } = await import('@/lib/cowork/analyst');
  const rules = COWORK_ANALYST_RULES.join('\n');
  assert.match(rules, /No expliques de dónde salen las cifras ni sus límites técnicos/);
  assert.match(rules, /Con menos de 5 envíos, da la cifra sin porcentaje/);
  assert.match(rules, /nunca «Semana calendario» si son 7 días/);
  assert.match(rules, /descuéntalo de los contactos por escribir \(con 4 contactos con correo y uno ya contactado, son 3\)/);
  assert.match(rules, /Si las cifras son cero o chicas, siempre hay uno: el que las mueve/);
  assert.match(rules, /El informe no explica cómo consultaste los datos/);
});

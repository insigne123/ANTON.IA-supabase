import assert from 'node:assert/strict';
import test from 'node:test';
import type { JevResult } from '@/lib/server/jev';
import { classifyReply } from './reply-classifier';
import { JEV_REPLY_MIN_CONFIDENCE, REPLY_JEV_QUESTION, jevReplyClassification, jevReplyRead, replyEngine } from './reply-jev';

const jev = (choice: string, confidence: number): JevResult => ({
  status: 'ok', answers: { intent: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } }, model: 'jev-latest', durationMs: 120, inputTokens: 80, costUsd: 0.0000034,
});
const jevDown = (status: JevResult['status']): JevResult => ({ status, answers: null, model: null, durationMs: 3000, inputTokens: 0, costUsd: 0 });
const model = (intent = 'neutral') => ({
  calls: [] as string[],
  llm: async function (this: { calls: string[] }, input: { text: string }) { this.calls.push(input.text); return { intent, sentiment: 'neutral', shouldContinue: true, confidence: 0.7, summary: 'Lo pensará', reason: 'modelo' }; },
});
function jevStub(result: JevResult | Error) {
  const calls: Array<{ state: unknown; questions: unknown }> = [];
  return { calls, askJev: async (input: { state: unknown; questions: unknown }) => { calls.push(input); if (result instanceof Error) throw result; return result; } };
}
const run = async (text: string, engine: 'llm' | 'shadow' | 'jev-first', result: JevResult | Error, intent = 'neutral') => {
  const fixture = model(intent);
  const ask = jevStub(result);
  const classification = await classifyReply(text, { engine, llm: fixture.llm.bind(fixture), askJev: ask.askJev as never });
  return { classification, modelCalls: fixture.calls, jevCalls: ask.calls };
};

test('the engine comes from REPLY_CLASSIFIER_ENGINE and is the model unless told otherwise', () => {
  assert.equal(replyEngine({}), 'llm');
  assert.equal(replyEngine({ REPLY_CLASSIFIER_ENGINE: '' }), 'llm');
  assert.equal(replyEngine({ REPLY_CLASSIFIER_ENGINE: 'jev' }), 'llm');
  assert.equal(replyEngine({ REPLY_CLASSIFIER_ENGINE: ' Shadow ' }), 'shadow');
  assert.equal(replyEngine({ REPLY_CLASSIFIER_ENGINE: 'jev-first' }), 'jev-first');
});

test('an answer of Jev is taken only when it is a choice the app knows and Jev is sure', () => {
  const answer = (choice: string, confidence: number) => jev(choice, confidence).answers!.intent;
  assert.equal(jevReplyClassification(answer('negative', JEV_REPLY_MIN_CONFIDENCE - 0.01)), null);
  assert.equal(jevReplyClassification(answer('negative', JEV_REPLY_MIN_CONFIDENCE))?.intent, 'negative');
  assert.equal(jevReplyClassification(answer('invented', 1)), null);
  assert.equal(jevReplyClassification({ type: 'noul', noul: 0.99 }), null);
  assert.equal(jevReplyClassification(undefined), null);
  // The rules of the campaign: interest and refusals stop the automatic follow-ups, automatic and neutral replies let them go on.
  const meaning = Object.fromEntries(Object.keys(REPLY_JEV_QUESTION.type === 'choice' ? REPLY_JEV_QUESTION.criteria : {}).map(intent => {
    const classification = jevReplyClassification(answer(intent, 1))!;
    return [intent, [classification.sentiment, classification.shouldContinue]];
  }));
  assert.deepEqual(meaning, {
    meeting_request: ['positive', false], positive: ['positive', false], negative: ['negative', false], unsubscribe: ['negative', false],
    auto_reply: ['neutral', true], neutral: ['neutral', true], delivery_failure: ['neutral', false],
  });
  assert.deepEqual(jevReplyRead(answer('positive', 0.42)), { intent: 'positive', confidence: 0.42 });
  assert.deepEqual(jevReplyRead(undefined), { intent: null, confidence: null });
});

test('by default the model classifies and Jev is never asked', async () => {
  const { classification, modelCalls, jevCalls } = await run('Me interesa, cuéntame más', 'llm', jev('positive', 1));
  assert.equal(classification.reason, 'modelo');
  assert.equal(modelCalls.length, 1);
  assert.equal(jevCalls.length, 0);
});

test('in shadow the model decides and only whether Jev agrees is logged, never the reply', async (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'info', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  const secret = 'Ana Pérez, teléfono 912345678';
  const agree = await run(`Gracias, lo evaluamos. ${secret}`, 'shadow', jev('neutral', 0.95), 'neutral');
  assert.equal(agree.classification.reason, 'modelo');
  assert.equal(agree.jevCalls.length, 1);
  const disagree = await run('Gracias, lo evaluamos', 'shadow', jev('positive', 0.6), 'neutral');
  assert.equal(disagree.classification.intent, 'neutral', 'what Jev says is not used');
  const down = await run('Gracias, lo evaluamos', 'shadow', jevDown('timeout'), 'neutral');
  assert.equal(down.classification.reason, 'modelo');
  const thrown = await run('Gracias, lo evaluamos', 'shadow', new Error('boom'), 'neutral');
  assert.equal(thrown.classification.reason, 'modelo');
  const logged = lines.filter(line => line.includes('jev shadow')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.deepEqual(logged.map(item => [item.model, item.jev, item.agree, item.trusted, item.status]), [
    ['neutral', 'neutral', true, true, 'ok'],
    ['neutral', 'positive', false, false, 'ok'],
    ['neutral', null, false, false, 'timeout'],
    ['neutral', null, false, false, 'error'],
  ]);
  assert.equal(lines.some(line => line.includes('Ana') || line.includes('912345678') || line.includes('evaluamos') || line.includes('Lo pensará')), false);
});

test('with jev-first Jev decides when it is sure, and the model reads the reply when it is not or cannot answer', async () => {
  const sure = await run('Sí, agendemos una llamada el jueves', 'jev-first', jev('meeting_request', 0.97));
  assert.deepEqual([sure.classification.intent, sure.classification.reason, sure.classification.shouldContinue], ['meeting_request', 'jev', false]);
  assert.equal(sure.modelCalls.length, 0, 'a reply Jev is sure about does not reach the model');

  for (const unsure of [jev('positive', 0.64), jev('invented', 1), jevDown('disabled'), jevDown('timeout'), jevDown('http_error'), jevDown('invalid'), new Error('boom')]) {
    const outcome = await run('Lo vemos con el equipo', 'jev-first', unsure);
    assert.equal(outcome.classification.reason, 'modelo', JSON.stringify(unsure));
    assert.equal(outcome.modelCalls.length, 1);
  }
});

test('the rules of the app go first in every engine: an explicit opt-out and an empty reply never reach Jev', async () => {
  for (const engine of ['llm', 'shadow', 'jev-first'] as const) {
    const optOut = await run('Por favor, no me escriban más, dénme de baja', engine, jev('neutral', 1));
    assert.equal(optOut.classification.intent, 'unsubscribe', engine);
    assert.equal(optOut.jevCalls.length, 0, engine);
    assert.equal(optOut.modelCalls.length, 0, engine);
    const empty = await run('   ', engine, jev('neutral', 1));
    assert.equal(empty.classification.intent, 'unknown', engine);
    assert.equal(empty.jevCalls.length, 0, engine);
  }
});

test('a clear refusal is never read as a reply that lets the sequence go on, whoever reads it', async () => {
  const refusal = 'No estoy interesado, gracias';
  const fromJev = await run(refusal, 'jev-first', jev('neutral', 0.97));
  assert.deepEqual([fromJev.classification.intent, fromJev.classification.shouldContinue, fromJev.classification.reason], ['negative', false, 'hard_negative_override']);
  const fromModel = await run(refusal, 'llm', jev('neutral', 0.97), 'neutral');
  assert.deepEqual([fromModel.classification.intent, fromModel.classification.shouldContinue], ['negative', false]);
});

test('Jev is asked one choice question about the reply text alone', async () => {
  const { jevCalls } = await run('Gracias, lo evaluamos', 'jev-first', jev('neutral', 0.95));
  assert.deepEqual(jevCalls[0].state, { reply: 'Gracias, lo evaluamos' });
  const question = (jevCalls[0].questions as { intent: typeof REPLY_JEV_QUESTION }).intent;
  assert.equal(question.type, 'choice');
  assert.deepEqual(Object.keys(question.type === 'choice' ? question.criteria : {}).sort(),
    ['auto_reply', 'delivery_failure', 'meeting_request', 'negative', 'neutral', 'positive', 'unsubscribe']);
});

test('when the model fails the heuristics answer, as before, and the shadow still logs', async (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'info', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  const ask = jevStub(jev('neutral', 0.9));
  const classification = await classifyReply('Gracias, lo evaluamos', { engine: 'shadow', llm: async () => { throw new Error('sin créditos'); }, askJev: ask.askJev as never });
  assert.equal(classification.intent, 'neutral');
  assert.equal(classification.summary, 'Neutral reply');
  assert.equal(lines.filter(line => line.includes('jev shadow')).length, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkLiveDraft } from '@/lib/cowork/partial-json';
import type { CoworkWriteBrief } from '@/lib/cowork/writer';
import { coworkWriterEfforts, coworkWriterEnabled, coworkWriterModels, coworkWriterTurn } from './writer-run';

// A clean first email: it asks nothing of a meeting the request did not ask for («escríbele a Felipe»).
const signed = 'Hola,\nEn Yago revisamos antecedentes laborales con AXIS en minutos.\n¿Cuántos ingresos revisan al mes?\nNicolás Yarur';
const draft = {
  reply: 'Te dejo el correo para Felipe.',
  blocks: [{ type: 'email_draft', title: 'Correo a Felipe', to: ['Felipe'], subject: 'Antecedentes en minutos', body: signed }],
  question: '¿Lo dejo listo para enviar?',
  suggestions: [{ label: 'Sí', message: 'Sí, déjalo listo' }],
};
const brief: CoworkWriteBrief = { kind: 'email', recipients: ['Felipe'], objective: 'Una reunión', angle: null, tone: null, steps: null, notes: null, findings: null };

function harness(replies: unknown[], timeLeft = () => 90_000, adjust = true, efforts?: Parameters<typeof coworkWriterTurn>[0]['efforts']) {
  const log: string[] = [];
  const pushed: string[] = [];
  const options: Array<{ timeoutMs: number; maxOutputTokens: number; openAiModel?: string; streamed: boolean; effort?: string }> = [];
  const write = coworkWriterTurn({
    request: 'escríbele a Felipe', userContext: { fullName: 'Nicolás Yarur' }, signal: new AbortController().signal,
    authorize: async () => {},
    reserve: async role => { log.push(`reserve:${role}`); return `call-${role}`; },
    generate: async call => {
      options.push({ timeoutMs: call.timeoutMs, maxOutputTokens: call.maxOutputTokens, openAiModel: call.openAiModel, streamed: Boolean(call.onPartial), effort: call.reasoningEffort });
      const reply = replies.shift();
      const text = JSON.stringify(reply);
      // The model streams its JSON in pieces.
      if (call.onPartial) for (const size of [20, 60, text.length]) call.onPartial(text.slice(0, size));
      return { data: call.schema.parse(reply), telemetry: { modelName: call.openAiModel || 'm', durationMs: 5 } };
    },
    recordUsage: async id => { log.push(`usage:${id}`); },
    record: async event => { log.push(`step:${event.result.agent}:${event.result.state}`); },
    liveDraft: { push: text => { pushed.push(text); }, review: () => { log.push('review'); }, ...(adjust ? { adjust: () => { log.push('adjust'); } } : {}),
      flush: async () => { log.push('flush'); } },
    timeLeft, models: { writer: 'writer-model', reviewer: 'reviewer-model' }, efforts,
  });
  return { write, log, pushed, options };
}

test('the Writer streams into the live draft and the Reviewer reads it, each under its own role', async () => {
  const h = harness([draft, { verdict: 'ok', issues: [] }]);
  const answer = await h.write(brief, []);
  assert.deepEqual(answer, { reply: draft.reply, document: null, question: draft.question, blocks: draft.blocks, suggestions: draft.suggestions });
  assert.deepEqual(h.log, [
    'step:writer:working', 'reserve:writer', 'flush', 'usage:call-writer', 'step:writer:done',
    'review', 'step:reviewer:working', 'reserve:reviewer', 'flush', 'usage:call-reviewer', 'step:reviewer:done',
  ]);
  // What the page shows while the Writer writes is its reply, read like a coordinator answer.
  assert.equal(coworkLiveDraft(h.pushed.at(-1) || '')?.reply, draft.reply);
  assert.deepEqual(coworkLiveDraft(h.pushed.at(-1) || '')?.cards, [{ type: 'email_draft', title: 'Correo a Felipe', parts: 1 }]);
  assert.deepEqual(h.options.map(option => `${option.openAiModel}:${option.maxOutputTokens}:${option.streamed}`),
    ['writer-model:6000:true', 'reviewer-model:1500:false']);
});

test('a correction of the draft tells the live draft before it is written, and a draft without that hook still works', async () => {
  const gratis = { ...draft, blocks: [{ ...draft.blocks[0], body: signed.replace('en minutos', 'gratis') }] };
  const h = harness([gratis, draft]);
  await h.write(brief, []);
  assert.deepEqual(h.log.filter(item => item === 'review' || item === 'adjust' || item.startsWith('step:reviewer')),
    ['review', 'step:reviewer:working', 'adjust', 'step:reviewer:done']);
  // Not held, the live draft has no adjust hook: the turn goes on.
  const plain = harness([gratis, draft], () => 90_000, false);
  await plain.write(brief, []);
  assert.ok(!plain.log.includes('adjust'));
  assert.ok(plain.log.includes('step:reviewer:done'));
});

test('the calls fit in the time the turn has left', async () => {
  // Plenty of time: each call keeps its own timeout.
  const roomy = harness([draft, { verdict: 'ok', issues: [] }]);
  await roomy.write(brief, []);
  assert.deepEqual(roomy.options.map(option => option.timeoutMs), [30_000, 15_000]);
  // Time for the Writer but not for a review: the draft goes out without one.
  const tight = harness([draft], () => 18_000);
  await tight.write(brief, []);
  assert.deepEqual(tight.options.map(option => option.timeoutMs), [18_000]);
  assert.ok(!tight.log.includes('reserve:reviewer'));
  // Not even time for the Writer: it refuses before reserving, and the coordinator answers instead.
  const late = harness([draft], () => 9_000);
  await assert.rejects(late.write(brief, []), /Cowork turn time exhausted/);
  assert.ok(!late.log.includes('reserve:writer'));
});

test('the flag and the models come from the environment', () => {
  assert.equal(coworkWriterEnabled({}), false);
  assert.equal(coworkWriterEnabled({ COWORK_WRITER_ENABLED: 'true' }), true);
  assert.deepEqual(coworkWriterModels({ COWORK_MODEL: 'base' }), { writer: 'base', reviewer: 'base', fix: 'base' });
  assert.deepEqual(coworkWriterModels({ COWORK_MODEL: 'base', COWORK_REVIEWER_MODEL: 'cheap' }), { writer: 'base', reviewer: 'cheap', fix: 'base' });
  // The correction follows the Writer unless it has its own model.
  assert.deepEqual(coworkWriterModels({ COWORK_MODEL: 'base', COWORK_WRITER_MODEL: 'draft' }), { writer: 'draft', reviewer: 'base', fix: 'draft' });
  assert.deepEqual(coworkWriterModels({ COWORK_MODEL: 'base', COWORK_WRITER_MODEL: 'draft', COWORK_WRITER_FIX_MODEL: 'fixer' }), { writer: 'draft', reviewer: 'base', fix: 'fixer' });
});

test('each role thinks with its own effort, and an unknown value keeps the model default', async () => {
  assert.deepEqual(coworkWriterEfforts({ COWORK_WRITER_EFFORT: 'xhigh', COWORK_REVIEWER_EFFORT: ' LOW ' }), { writer: 'xhigh', reviewer: 'low', fix: 'xhigh' });
  assert.deepEqual(coworkWriterEfforts({ COWORK_WRITER_EFFORT: 'turbo' }), { writer: undefined, reviewer: undefined, fix: undefined });
  assert.deepEqual(coworkWriterEfforts({}), { writer: undefined, reviewer: undefined, fix: undefined });
  assert.deepEqual(coworkWriterEfforts({ COWORK_WRITER_EFFORT: 'high', COWORK_WRITER_FIX_EFFORT: 'low' }), { writer: 'high', reviewer: undefined, fix: 'low' });
  const h = harness([draft, { verdict: 'ok', issues: [] }], () => 90_000, true, { writer: 'max', reviewer: 'low' });
  await h.write(brief, []);
  assert.deepEqual(h.options.map(option => `${option.openAiModel}:${option.effort}`), ['writer-model:max', 'reviewer-model:low']);
  const plain = harness([draft, { verdict: 'ok', issues: [] }]);
  await plain.write(brief, []);
  assert.deepEqual(plain.options.map(option => option.effort), [undefined, undefined]);
});

test('the correction may run on its own model and effort: one model drafts and another fixes', async () => {
  const gratis = { ...draft, blocks: [{ ...draft.blocks[0], body: signed.replace('en minutos', 'gratis') }] };
  const h = harness([gratis, draft]);
  const write = coworkWriterTurn({
    request: 'escríbele a Felipe', userContext: { fullName: 'Nicolás Yarur' }, signal: new AbortController().signal, authorize: async () => {},
    reserve: async role => `call-${role}`,
    generate: async call => {
      h.options.push({ timeoutMs: call.timeoutMs, maxOutputTokens: call.maxOutputTokens, openAiModel: call.openAiModel, streamed: Boolean(call.onPartial), effort: call.reasoningEffort });
      const reply = [gratis, draft][h.options.length - 1];
      return { data: call.schema.parse(reply), telemetry: { modelName: call.openAiModel || 'm', durationMs: 5 } };
    },
    recordUsage: async () => {}, record: async () => {}, liveDraft: null, timeLeft: () => 90_000,
    models: { writer: 'draft-model', reviewer: 'reviewer-model', fix: 'fix-model' }, efforts: { writer: 'low', fix: 'medium' },
  });
  await write(brief, []);
  // The checks found «gratis»: no Reviewer, and the correction goes to its own model, with the budget and limits of the Writer.
  assert.deepEqual(h.options.map(option => `${option.openAiModel}:${option.effort}:${option.maxOutputTokens}:${option.timeoutMs}`),
    ['draft-model:low:6000:30000', 'fix-model:medium:6000:30000']);
});

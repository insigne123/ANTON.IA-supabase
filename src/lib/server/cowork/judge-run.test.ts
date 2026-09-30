import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkAnswer } from '@/lib/cowork/agent-loop';
import type { CoworkJudgement } from '@/lib/cowork/judge';
import { coworkJudgeEnabled, coworkJudgeModel, coworkJudgeTurn } from './judge-run';

const answer: CoworkAnswer = {
  reply: 'Tienes 4 contactos de RR. HH. guardados.', document: null,
  question: '¿Quieres que revise a quiénes ya les escribiste?', suggestions: [{ label: 'Sí, revisa', message: 'Sí, revisa los envíos' }],
};
const scores = { comprension: 5, veracidad: 5, utilidad: 4, claridad: 5, friccion: 5 };
const clean: CoworkJudgement = { scores, problemas: [], veredicto: 'buena' };
const offered: CoworkJudgement = {
  scores: { ...scores, utilidad: 3, friccion: 2 }, veredicto: 'mala',
  problemas: ['Pregunta si revisa los envíos, aunque podía consultarlos antes de responder.'],
};

function harness(verdicts: Array<CoworkJudgement | Error>, timeLeft = () => 60_000, callTimeoutMs?: number) {
  const log: string[] = [];
  const steps: Array<{ state: string; label: string; outcome?: string }> = [];
  const details: Array<Record<string, unknown> | undefined> = [];
  const options: Array<{ timeoutMs: number; maxOutputTokens: number; openAiModel?: string; prompt: string }> = [];
  const judge = coworkJudgeTurn({
    request: 'a quién le escribo de RR. HH.', history: [], userContext: { fullName: 'Nicolás Yarur' }, signal: new AbortController().signal,
    authorize: async () => {},
    reserve: async () => { log.push('reserve:judge'); return 'call-judge'; },
    generate: async call => {
      options.push({ timeoutMs: call.timeoutMs, maxOutputTokens: call.maxOutputTokens, openAiModel: call.openAiModel, prompt: call.prompt });
      const verdict = verdicts.shift();
      if (verdict instanceof Error) throw verdict;
      return { data: call.schema.parse(verdict), telemetry: { modelName: call.openAiModel || 'm', durationMs: 5 } };
    },
    recordUsage: async id => { log.push(`usage:${id}`); },
    record: async event => {
      log.push(`step:${event.result.agent}:${event.result.state}`);
      steps.push({ state: event.result.state, label: event.result.label, ...(event.result.outcome ? { outcome: event.result.outcome } : {}) });
      details.push(event.result.detail);
    },
    liveDraft: { review: () => { log.push('review'); }, flush: async () => { log.push('flush'); } },
    timeLeft, model: 'judge-model', ...(callTimeoutMs ? { callTimeoutMs } : {}),
  });
  return { judge, log, steps, options, details };
}

test('the judge reads the answer as the person would see it, under its own role, and a clean one stands', async () => {
  const h = harness([clean]);
  assert.equal(await h.judge.review(answer, [{ action: 'leads.search', input: 'RR. HH.', result: { count: 4 } }]), null);
  assert.deepEqual(h.log, ['step:judge:working', 'review', 'flush', 'reserve:judge', 'usage:call-judge', 'step:judge:done']);
  assert.deepEqual(h.steps.at(-1), { state: 'done', label: 'Sin ajustes', outcome: 'clean' });
  assert.deepEqual(h.options.map(option => `${option.openAiModel}:${option.maxOutputTokens}:${option.timeoutMs}`), ['judge-model:1500:15000']);
  // What it found stays with its step for whoever reviews the turn later; the page ignores it.
  assert.deepEqual(h.details.at(-1), { engine: 'llm', model: 'judge-model', durationMs: 5, canRead: true, asked: false, scores, problemas: [], veredicto: 'buena' });
  // What it reads: the reads of the turn, and the reply with its question and buttons.
  const prompt = JSON.parse(h.options[0].prompt);
  assert.deepEqual(prompt.loQueVioElUsuario.botones, ['Sí, revisa los envíos']);
  assert.equal(prompt.loQueVioElUsuario.preguntaFinal, answer.question);
  assert.equal(prompt.datosConsultados.length, 1);
  // Nothing to fix: the row closes and finish has nothing to add.
  await h.judge.finish(answer);
  assert.equal(h.steps.length, 2);
});

test('an answer worth fixing goes back with what to fix, and finish says whether it changed', async () => {
  const fixed = harness([offered]);
  const fix = await fixed.judge.review(answer, []);
  assert.match(fix || '', /Pregunta si revisa los envíos/);
  assert.deepEqual(fixed.steps.at(-1), { state: 'working', label: 'Ajustando la respuesta' });
  assert.equal(fixed.details.at(-1)?.asked, true);
  fixed.judge.corrected({ keep: 'correction', reason: 'improved' });
  await fixed.judge.finish({ ...answer, reply: 'Tienes 4 contactos de RR. HH.; a 2 ya les escribiste.' });
  assert.deepEqual(fixed.steps.at(-1), { state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed' });
  assert.deepEqual(fixed.details.at(-1), { kept: 'correction' });
  // The correction was not one (a figure without support): the first answer stood, and the row says so.
  const guarded = harness([offered]);
  await guarded.judge.review(answer, []);
  guarded.judge.corrected({ keep: 'first', reason: 'new_figures', figures: ['12'] });
  await guarded.judge.finish(answer);
  assert.deepEqual(guarded.steps.at(-1), { state: 'done', label: 'Dejó la primera respuesta', outcome: 'skipped' });
  assert.deepEqual(guarded.details.at(-1), { kept: 'first', reason: 'new_figures' });
  // The correction failed: the loop returned the judged answer as it was. The charts step hands it back
  // as a new object: the same reply is still no correction.
  const kept = harness([offered]);
  await kept.judge.review(answer, []);
  await kept.judge.finish({ ...answer, blocks: [] });
  assert.deepEqual(kept.steps.at(-1), { state: 'done', label: 'No alcanzó a ajustarla', outcome: 'skipped' });
  // Without a verdict (the correction became the Writer's emails), a different reply is the correction.
  const written = harness([offered]);
  await written.judge.review(answer, []);
  await written.judge.finish({ ...answer, reply: 'Te dejé el correo para Felipe.' });
  assert.deepEqual(written.steps.at(-1), { state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed' });
  // The turn failed after the request: the row still closes.
  const failed = harness([offered]);
  await failed.judge.review(answer, []);
  await failed.judge.finish(null);
  assert.deepEqual(failed.steps.at(-1), { state: 'done', label: 'No alcanzó a ajustarla', outcome: 'skipped' });
});

test('without a read left for the correction, friction alone is not worth one; an unsupported claim is', async () => {
  const friction = harness([offered]);
  assert.equal(await friction.judge.review(answer, [], { canRead: false }), null);
  assert.deepEqual(friction.steps.at(-1), { state: 'done', label: 'Sin ajustes', outcome: 'clean' });
  const claim = harness([{ ...offered, scores: { ...offered.scores, veracidad: 2 }, problemas: ['Dice «2 envíos» sin respaldo.'] }]);
  assert.match(await claim.judge.review(answer, [], { canRead: false }) || '', /ya no quedan consultas/);
  // With a read left, it quotes the question the answer ended with.
  const quoted = harness([offered]);
  assert.match(await quoted.judge.review(answer, [], { canRead: true }) || '', /Tu respuesta terminaba con «¿Quieres que revise a quiénes ya les escribiste\?»/);
});

test('without time for the call and a correction it does not start; a failed call lets the answer stand', async () => {
  const late = harness([offered], () => 40_000);
  assert.equal(await late.judge.review(answer, []), null);
  assert.deepEqual(late.log, []);
  // Held, the person waits for the review: its call gets 8 s, and needs less time left to start.
  const held = harness([clean], () => 40_000, 8_000);
  assert.equal(await held.judge.review(answer, []), null);
  assert.deepEqual(held.options.map(option => option.timeoutMs), [8_000]);
  const broken = harness([new Error('timeout')]);
  assert.equal(await broken.judge.review(answer, []), null);
  assert.deepEqual(broken.steps.at(-1), { state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped' });
  // A cancelled turn is not swallowed.
  const controller = new AbortController();
  const cancelled = coworkJudgeTurn({
    request: 'x', history: [], userContext: null, signal: controller.signal, authorize: async () => {},
    reserve: async () => undefined,
    generate: async () => { controller.abort(); throw new Error('aborted'); },
    recordUsage: async () => undefined, record: async () => undefined, liveDraft: null, timeLeft: () => 60_000,
  });
  await assert.rejects(cancelled.review(answer, []), /aborted/);
});

test('the flag and the model come from the environment', () => {
  assert.equal(coworkJudgeEnabled({}), false);
  assert.equal(coworkJudgeEnabled({ COWORK_JUDGE_ENABLED: 'true' }), true);
  assert.equal(coworkJudgeModel({ COWORK_MODEL: 'base' }), 'base');
  assert.equal(coworkJudgeModel({ COWORK_MODEL: 'base', COWORK_JUDGE_MODEL: 'other' }), 'other');
});

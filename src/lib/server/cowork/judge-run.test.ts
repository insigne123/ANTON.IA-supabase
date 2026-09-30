import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoworkAnswer } from '@/lib/cowork/agent-loop';
import type { CoworkJudgement } from '@/lib/cowork/judge';
import type { CoworkReviewEngine } from '@/lib/cowork/review-engine';
import type { JevResult } from '@/lib/server/jev';
import { coworkJudgeEnabled, coworkJudgeModel, coworkJudgeTurn, type AskJev } from './judge-run';

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

// ── Jev in the review of the turn (COWORK_REVIEW_ENGINE, COWORK_JEV_SHADOW) ──

/** What Jev says when asked: the probability that the reply offers a read it could have made, and its own verdict. */
const said = (probability: number, extra: Partial<JevResult> = {}): JevResult => ({
  status: 'ok', model: 'jev-1.13.0', durationMs: 150, inputTokens: 3000, costUsd: 0.000126,
  answers: { offers_free_read: { type: 'noul', noul: probability }, unsupported_figure: { type: 'noul', noul: 0.97 },
    verdict: { type: 'choice', choice: 'good', confidence: 0.9, probabilities: { good: 0.9, improvable: 0.08, bad: 0.02 } } }, ...extra,
});
const silent = (status: JevResult['status']): JevResult => ({ status, answers: null, model: null, durationMs: 3000, inputTokens: 0, costUsd: 0 });

function jevHarness(options: { engine: CoworkReviewEngine; jev: Array<JevResult | Error>; verdicts?: Array<CoworkJudgement | Error>; shadow?: boolean; withoutJev?: boolean; timeLeft?: () => number }) {
  const log: string[] = [];
  const steps: Array<{ agent: string; state: string; label: string; outcome?: string }> = [];
  const details: Array<Record<string, unknown> | undefined> = [];
  const asked: Array<{ state: Record<string, unknown>; timeoutMs: number; questions: string[] }> = [];
  const verdicts = options.verdicts ?? [];
  const jev: AskJev = async input => {
    log.push('jev');
    asked.push({ state: input.state as Record<string, unknown>, timeoutMs: input.timeoutMs, questions: Object.keys(input.questions) });
    const next = options.jev.shift();
    if (next instanceof Error) throw next;
    return next ?? silent('disabled');
  };
  const judge = coworkJudgeTurn({
    request: 'a quién le escribo de RR. HH.', history: [], userContext: { fullName: 'Nicolás Yarur' }, signal: new AbortController().signal,
    authorize: async () => {},
    reserve: async () => { log.push('reserve:judge'); return 'call-judge'; },
    generate: async call => {
      log.push('model');
      const verdict = verdicts.shift();
      if (verdict instanceof Error) throw verdict;
      return { data: call.schema.parse(verdict), telemetry: { modelName: call.openAiModel || 'm', durationMs: 5 } };
    },
    recordUsage: async id => { log.push(`usage:${id}`); },
    record: async event => {
      steps.push({ agent: event.result.agent, state: event.result.state, label: event.result.label, ...(event.result.outcome ? { outcome: event.result.outcome } : {}) });
      details.push(event.result.detail);
    },
    liveDraft: { review: () => { log.push('review'); }, flush: async () => { log.push('flush'); } },
    timeLeft: options.timeLeft ?? (() => 60_000), model: 'judge-model',
    engine: options.engine, ...(options.withoutJev ? {} : { jev }), jevShadow: options.shadow === true,
  });
  return { judge, log, steps, details, asked };
}

test('jev: a fired question asks for the same correction, without the model, and keeps what Jev said but never what it read', async () => {
  const h = jevHarness({ engine: 'jev', jev: [said(0.93)] });
  const fix = await h.judge.review(answer, [{ action: 'leads.search', input: 'RR. HH.', result: { count: 4 } }]);
  assert.match(fix || '', /Termina ofreciendo una consulta o una preparación que Cowork podía hacer ahora/);
  assert.match(fix || '', /Tu respuesta terminaba con «¿Quieres que revise a quiénes ya les escribiste\?»/);
  // Jev answered: the model was never reserved, called or paid.
  assert.deepEqual(h.log, ['review', 'flush', 'jev']);
  assert.deepEqual(h.steps, [{ agent: 'judge', state: 'working', label: 'Revisando la respuesta' }, { agent: 'judge', state: 'working', label: 'Ajustando la respuesta' }]);
  const detail = h.details.at(-1) as Record<string, any>;
  assert.equal(detail.engine, 'jev');
  assert.equal(detail.asked, true);
  assert.equal(detail.veredicto, 'mala');
  assert.deepEqual(detail.jev.fired, ['offers_free_read']);
  assert.equal(detail.jev.status, 'ok');
  assert.equal(detail.jev.probabilities.offers_free_read, 0.93);
  assert.equal(detail.jev.costUsd, 0.000126);
  // Only the calibrated question fires, whatever the others say (0.97 for a figure here).
  assert.equal(detail.scores.veracidad, 5);
  // What Jev read: the same material as the judge, with English keys, all the questions, and a short wait.
  assert.equal(h.asked[0].timeoutMs, 1500);
  assert.deepEqual(h.asked[0].questions.slice(0, 2), ['offers_free_read', 'asks_known_data']);
  assert.equal((h.asked[0].state.shownToUser as { reply: string }).reply, answer.reply);
  assert.equal(h.asked[0].state.request, 'a quién le escribo de RR. HH.');
  // What the step keeps is what Jev said, not what it read.
  assert.doesNotMatch(JSON.stringify(h.details), /Tienes 4 contactos|RR\. HH\.|Nicolás/);
  // The loop's verdict closes the row as with the model.
  h.judge.corrected({ keep: 'correction', reason: 'improved' });
  await h.judge.finish({ ...answer, reply: 'Tienes 4 contactos de RR. HH.; a 2 ya les escribiste.' });
  assert.deepEqual(h.steps.at(-1), { agent: 'judge', state: 'done', label: 'Ajustó la respuesta', outcome: 'fixed' });
});

test('jev: under its threshold the answer stands, and its own verdict alone is not a correction', async () => {
  const h = jevHarness({ engine: 'jev', jev: [said(0.6)] });
  assert.equal(await h.judge.review(answer, []), null);
  assert.deepEqual(h.steps.at(-1), { agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean' });
  assert.equal((h.details.at(-1) as Record<string, any>).engine, 'jev');
  assert.deepEqual((h.details.at(-1) as Record<string, any>).jev.fired, []);
  assert.ok(!h.log.includes('model'));
  // Jev calling the whole reply «bad» without a question firing leaves a «mala» verdict but no problem to fix.
  const bad = jevHarness({ engine: 'jev', jev: [said(0.3, { answers: { offers_free_read: { type: 'noul', noul: 0.3 }, verdict: { type: 'choice', choice: 'bad', confidence: 0.8, probabilities: { bad: 0.8, improvable: 0.15, good: 0.05 } } } })] });
  assert.equal(await bad.judge.review(answer, []), null);
  assert.deepEqual(bad.steps.at(-1), { agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean' });
});

test('jev fails open: without a key, late, unreadable or missing, the answer goes out as it is and the model is not asked instead', async () => {
  for (const result of [silent('disabled'), silent('timeout'), silent('http_error'), silent('invalid'), new Error('network down')]) {
    const h = jevHarness({ engine: 'jev', jev: [result] });
    assert.equal(await h.judge.review(answer, []), null);
    assert.deepEqual(h.steps.at(-1), { agent: 'judge', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped' });
    assert.ok(!h.log.includes('model') && !h.log.includes('reserve:judge'));
    assert.equal((h.details.at(-1) as Record<string, any>).jev.status, result instanceof Error ? 'error' : result.status);
  }
  // Without Jev handed to the judge at all, nothing asks it.
  const none = jevHarness({ engine: 'jev', jev: [], withoutJev: true });
  assert.equal(await none.judge.review(answer, []), null);
  assert.deepEqual(none.steps.at(-1), { agent: 'judge', state: 'done', label: 'No alcanzó a revisar', outcome: 'skipped' });
  // Without time for the call and a correction it does not start.
  const late = jevHarness({ engine: 'jev', jev: [said(0.93)], timeLeft: () => 31_000 });
  assert.equal(await late.judge.review(answer, []), null);
  assert.deepEqual(late.log, []);
  // A cancelled turn is not swallowed.
  const controller = new AbortController();
  const cancelled = coworkJudgeTurn({
    request: 'x', history: [], userContext: null, signal: controller.signal, authorize: async () => {}, reserve: async () => undefined,
    generate: async () => { throw new Error('the model must not be asked'); }, recordUsage: async () => undefined, record: async () => undefined,
    liveDraft: null, timeLeft: () => 60_000, engine: 'jev', jev: async () => { controller.abort(); throw new Error('aborted'); },
  });
  await assert.rejects(cancelled.review(answer, []), /aborted/);
});

test('jev-llm: when Jev clears the answer the model does not read it; when Jev sees something, or does not answer, it does', async () => {
  const cleared = jevHarness({ engine: 'jev-llm', jev: [said(0.2)], verdicts: [offered] });
  assert.equal(await cleared.judge.review(answer, []), null);
  assert.deepEqual(cleared.log, ['review', 'flush', 'jev']);
  assert.deepEqual(cleared.steps.at(-1), { agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean' });
  assert.equal((cleared.details.at(-1) as Record<string, any>).llm, false);
  assert.equal((cleared.details.at(-1) as Record<string, any>).engine, 'jev-llm');
  // Between its screening threshold (0.74) and its firing one (0.88) Jev only hands the answer to the model, which decides.
  const seen = jevHarness({ engine: 'jev-llm', jev: [said(0.8)], verdicts: [clean] });
  assert.equal(await seen.judge.review(answer, []), null);
  assert.deepEqual(seen.log, ['review', 'flush', 'jev', 'reserve:judge', 'model', 'usage:call-judge']);
  const seenDetail = seen.details.at(-1) as Record<string, any>;
  assert.equal(seenDetail.engine, 'jev-llm');
  assert.equal(seenDetail.model, 'judge-model');
  assert.equal(seenDetail.jev.probabilities.offers_free_read, 0.8);
  assert.deepEqual(seenDetail.jev.fired, []);
  // What the model finds goes back as a correction, as with the model alone.
  const fixed = jevHarness({ engine: 'jev-llm', jev: [said(0.8)], verdicts: [offered] });
  assert.match(await fixed.judge.review(answer, []) || '', /Pregunta si revisa los envíos/);
  // Jev did not answer: the model reads it, as if Jev were not there.
  for (const result of [silent('timeout'), silent('disabled'), new Error('network down')]) {
    const h = jevHarness({ engine: 'jev-llm', jev: [result], verdicts: [clean] });
    assert.equal(await h.judge.review(answer, []), null);
    assert.ok(h.log.includes('model'));
    assert.deepEqual(h.steps.at(-1), { agent: 'judge', state: 'done', label: 'Sin ajustes', outcome: 'clean' });
  }
});

test('off: nobody reviews, and with the shadow Jev answers in a step of its own that the page does not know, touching nothing else', async () => {
  const plain = jevHarness({ engine: 'off', jev: [said(0.93)], verdicts: [offered] });
  assert.equal(await plain.judge.review(answer, []), null);
  assert.deepEqual(plain.log, []);
  assert.deepEqual(plain.steps, []);
  const watching = jevHarness({ engine: 'off', jev: [said(0.93)], verdicts: [offered], shadow: true });
  assert.equal(await watching.judge.review(answer, []), null);
  // No «Revisando» step, no change on the page, the model untouched: one step for Jev, which the page ignores.
  assert.deepEqual(watching.log, ['jev']);
  assert.deepEqual(watching.steps, [{ agent: 'jev', state: 'done', label: 'Jev en sombra' }]);
  const detail = watching.details[0] as Record<string, any>;
  assert.equal(detail.shadow, true);
  assert.deepEqual(detail.fired, ['offers_free_read']);
  assert.equal(detail.probabilities.offers_free_read, 0.93);
  assert.equal(detail.costUsd, 0.000126);
  // Jev failing in the shadow changes nothing either.
  const failing = jevHarness({ engine: 'off', jev: [new Error('network down')], shadow: true });
  assert.equal(await failing.judge.review(answer, []), null);
  assert.deepEqual(failing.steps, [{ agent: 'jev', state: 'done', label: 'Jev en sombra' }]);
  assert.equal((failing.details[0] as Record<string, any>).status, 'error');
  // Without time even for Jev, nothing starts.
  const late = jevHarness({ engine: 'off', jev: [said(0.93)], shadow: true, timeLeft: () => 1_000 });
  assert.equal(await late.judge.review(answer, []), null);
  assert.deepEqual(late.log, []);
});

test('llm with the shadow: Jev answers while the model thinks, the model decides and Jev only records', async () => {
  const h = jevHarness({ engine: 'llm', jev: [said(0.97)], verdicts: [clean], shadow: true });
  assert.equal(await h.judge.review(answer, []), null);
  // Jev is asked before the model is reserved: it adds no wait.
  assert.deepEqual(h.log, ['review', 'flush', 'jev', 'reserve:judge', 'model', 'usage:call-judge']);
  assert.deepEqual(h.steps.map(step => `${step.agent}:${step.label}`), ['judge:Revisando la respuesta', 'jev:Jev en sombra', 'judge:Sin ajustes']);
  assert.deepEqual((h.details[1] as Record<string, any>).fired, ['offers_free_read']);
  // What the model found is unchanged by what Jev said; the judge's own step has no Jev in it.
  assert.deepEqual(h.details.at(-1), { engine: 'llm', model: 'judge-model', durationMs: 5, canRead: true, asked: false, scores, problemas: [], veredicto: 'buena' });
  // The model asking for a fix is not stopped by a quiet Jev, nor Jev's shout turned into one.
  const quiet = jevHarness({ engine: 'llm', jev: [said(0.05)], verdicts: [offered], shadow: true });
  assert.match(await quiet.judge.review(answer, []) || '', /Pregunta si revisa los envíos/);
  // A Jev that fails, and a model that fails, each in its own way.
  const brokenJev = jevHarness({ engine: 'llm', jev: [new Error('network down')], verdicts: [clean], shadow: true });
  assert.equal(await brokenJev.judge.review(answer, []), null);
  assert.deepEqual(brokenJev.steps.map(step => step.label), ['Revisando la respuesta', 'Jev en sombra', 'Sin ajustes']);
  const brokenModel = jevHarness({ engine: 'llm', jev: [said(0.97)], verdicts: [new Error('timeout')], shadow: true });
  assert.equal(await brokenModel.judge.review(answer, []), null);
  assert.deepEqual(brokenModel.steps.map(step => step.label), ['Revisando la respuesta', 'Jev en sombra', 'No alcanzó a revisar']);
  // Without the shadow, the model's review is exactly what it was and Jev is never asked.
  const plain = jevHarness({ engine: 'llm', jev: [said(0.97)], verdicts: [clean] });
  assert.equal(await plain.judge.review(answer, []), null);
  assert.ok(!plain.log.includes('jev'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_JEV_CHECKS, COWORK_JEV_DEFAULT_SCREEN, COWORK_JEV_DEFAULT_THRESHOLDS, COWORK_JEV_QUESTIONS, coworkJevJudgement, coworkJevProbabilities, coworkJevSeen, coworkJevState, coworkJevStateFromPrompt } from './jev-review';
import { coworkJudgePrompt, coworkJudgeTurnPrompt } from './judge';

test('Jev reads the same material as the judge, with English keys', () => {
  const state = coworkJevState({
    request: '¿qué puedes hacer?',
    userContext: { fullName: 'Nicolás Y.', offer: 'AXIS consulta el PJUD por lote.' },
    observations: [{ action: 'leads.search', input: '', result: { items: [{ name: 'Marcela Rojas' }] } }],
    shown: { reply: 'No veo qué vende Yago.', question: '¿Me cuentas qué vendes?', quickReplies: ['Te cuento'] },
  });
  assert.equal(state.request, '¿qué puedes hacer?');
  assert.deepEqual(state.user, { fullName: 'Nicolás Y.', offer: 'AXIS consulta el PJUD por lote.' });
  assert.match(String(state.consultedData[0]), /Marcela Rojas/);
  assert.equal(state.shownToUser.reply, 'No veo qué vende Yago.');
  assert.equal(state.shownToUser.finalQuestion, '¿Me cuentas qué vendes?');
  assert.deepEqual(state.shownToUser.buttons, ['Te cuento']);
});

test('every check is an English yes/no question; the verdict is a choice', () => {
  for (const id of COWORK_JEV_CHECKS) {
    assert.equal(COWORK_JEV_QUESTIONS[id].type, 'noul');
    assert.match(COWORK_JEV_QUESTIONS[id].instructions, /^The reply /);
  }
  assert.deepEqual(Object.keys(COWORK_JEV_QUESTIONS.verdict.criteria), ['good', 'improvable', 'bad']);
});

test('fired questions become a regular judgement with problems in Spanish', () => {
  const judgement = coworkJevJudgement({
    denies_present_context: { type: 'noul', noul: 0.79 },
    offers_free_read: { type: 'noul', noul: 0.06 },
    verdict: { type: 'choice', choice: 'bad', confidence: 0.37, probabilities: { bad: 0.58, improvable: 0.37, good: 0.05 } },
  }, { denies_present_context: 0.7 });
  assert.deepEqual(judgement?.fired, ['denies_present_context']);
  assert.equal(judgement?.veredicto, 'mala');
  assert.equal(judgement?.scores.veracidad, 2);
  assert.equal(judgement?.scores.friccion, 5);
  assert.match(judgement?.problemas[0] || '', /no sabe o no ve algo que sí está/);
});

test('thresholds decide what fires; nothing fired leaves Jev\'s own verdict', () => {
  const answers = { offers_free_read: { type: 'noul' as const, noul: 0.6 },
    verdict: { type: 'choice' as const, choice: 'improvable', confidence: 0.5, probabilities: { improvable: 0.6, good: 0.3, bad: 0.1 } } };
  const lenient = coworkJevJudgement(answers);
  assert.deepEqual(lenient?.fired, [], 'the calibrated default for this check is 0.88');
  assert.equal(lenient?.veredicto, 'mejorable');
  assert.deepEqual(lenient?.problemas, []);
  const strict = coworkJevJudgement(answers, { offers_free_read: 0.5 });
  assert.deepEqual(strict?.fired, ['offers_free_read']);
  assert.equal(strict?.scores.friccion, 2);
  assert.equal(coworkJevJudgement(null), null);
  assert.equal(coworkJevProbabilities({}).offers_free_read, null);
});

test('by default only the calibrated check fires; the others are only measured', () => {
  const all = Object.fromEntries(COWORK_JEV_CHECKS.map(id => [id, { type: 'noul' as const, noul: 0.95 }]));
  assert.deepEqual(coworkJevJudgement(all)?.fired, ['offers_free_read']);
});

test('the state from the prompt the judge in the turn already built is the state of the same material', () => {
  const input = {
    request: '¿qué puedes hacer?', userContext: { fullName: 'Nicolás Y.' }, history: [{ request: 'hola', reply: 'Hola' }],
    observations: [{ action: 'leads.search', input: '', result: { items: [{ name: 'Marcela Rojas' }] } }],
    shown: { reply: 'Puedo buscar contactos.', question: '¿Busco a tu equipo?', quickReplies: ['Sí'] },
  };
  assert.deepEqual(coworkJevStateFromPrompt(coworkJudgePrompt(input)), coworkJevState(input));
  // The turn's prompt carries the answer as the person sees it: Jev reads exactly what the model would.
  const turn = coworkJevStateFromPrompt(coworkJudgeTurnPrompt({
    request: input.request, history: input.history, userContext: input.userContext, observations: input.observations,
    answer: { reply: 'Puedo buscar contactos.', document: null, question: '¿Busco a tu equipo?', suggestions: [{ label: 'Sí', message: 'Sí' }] },
  }));
  assert.equal(turn.request, '¿qué puedes hacer?');
  assert.equal(turn.shownToUser.reply, 'Puedo buscar contactos.');
  assert.equal(turn.shownToUser.finalQuestion, '¿Busco a tu equipo?');
  assert.deepEqual(turn.shownToUser.buttons, ['Sí']);
  assert.match(JSON.stringify(turn.consultedData[0]), /Marcela Rojas/);
});

test('the screening asks for coverage and the firing one for precision: 0.74 hands the answer to the model, 0.88 asks for a correction', () => {
  assert.equal(COWORK_JEV_DEFAULT_SCREEN.offers_free_read, 0.74);
  assert.equal(COWORK_JEV_DEFAULT_THRESHOLDS.offers_free_read, 0.88);
  assert.ok(COWORK_JEV_DEFAULT_SCREEN.offers_free_read! < COWORK_JEV_DEFAULT_THRESHOLDS.offers_free_read!);
  const at = (noul: number) => ({ offers_free_read: { type: 'noul' as const, noul }, unsupported_figure: { type: 'noul' as const, noul: 0.99 } });
  assert.deepEqual(coworkJevSeen(at(0.73)), []);
  assert.deepEqual(coworkJevSeen(at(0.74)), ['offers_free_read'], 'only the calibrated question screens; the figure check never does');
  assert.deepEqual(coworkJevJudgement(at(0.8))?.fired, [], 'seen is not fired');
  assert.deepEqual(coworkJevJudgement(at(0.88))?.fired, ['offers_free_read']);
  assert.deepEqual(coworkJevSeen(at(0.3), { offers_free_read: 0.2 }), ['offers_free_read']);
  assert.deepEqual(coworkJevSeen(null), []);
  assert.deepEqual(coworkJevSeen({}), []);
});

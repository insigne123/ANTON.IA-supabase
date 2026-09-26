import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COWORK_JUDGE_DIMENSIONS, COWORK_JUDGE_INSTRUCTIONS, coworkJudgeAgreement, coworkJudgePrompt, coworkJudgeSchema, coworkJudgeSummary,
  type CoworkJudgement,
} from './judge';

const judgement = (scores: number[], veredicto: CoworkJudgement['veredicto'] = 'mejorable'): CoworkJudgement => ({
  scores: Object.fromEntries(COWORK_JUDGE_DIMENSIONS.map((dimension, index) => [dimension, scores[index]])) as CoworkJudgement['scores'],
  problemas: [], veredicto,
});

test('a judgement has five scores from 1 to 5, a few concrete problems and a verdict', () => {
  assert.equal(coworkJudgeSchema.safeParse(judgement([5, 4, 3, 2, 1])).success, true);
  assert.equal(coworkJudgeSchema.safeParse(judgement([6, 4, 3, 2, 1])).success, false);
  assert.equal(coworkJudgeSchema.safeParse(judgement([0, 4, 3, 2, 1])).success, false);
  assert.equal(coworkJudgeSchema.safeParse({ ...judgement([3, 3, 3, 3, 3]), problemas: ['a', 'b', 'c', 'd', 'e', 'f'] }).success, false);
  // The rubric names every dimension and the verdict rule, and asks to grade only what was shown.
  for (const dimension of COWORK_JUDGE_DIMENSIONS) assert.match(COWORK_JUDGE_INSTRUCTIONS, new RegExp(`- ${dimension}:`));
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /Evalúa solo eso/);
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /Contar mal/);
});

test('the judge sees the request, the data and exactly what was shown, trimmed to a fair size', () => {
  const prompt = JSON.parse(coworkJudgePrompt({
    request: '¿A quién le escribo?', history: [{ request: 'hola', reply: 'Hola' }], userContext: { companyName: 'Yago SpA' },
    observations: [{ action: 'leads.search', result: { items: 'x'.repeat(5000) } }],
    shown: { reply: 'A Felipe.', cards: null, question: '¿Le escribo?', quickReplies: ['Sí, escríbele'],
      proposal: { kind: 'campaign_create', label: 'Crear campaña', note: 'Te dejo la campaña.', detail: { correos: [] } } },
  }));
  assert.equal(prompt.pedido, '¿A quién le escribo?');
  assert.equal(prompt.loQueVioElUsuario.preguntaFinal, '¿Le escribo?');
  assert.deepEqual(prompt.loQueVioElUsuario.botones, ['Sí, escríbele']);
  assert.equal(prompt.loQueVioElUsuario.tarjetaDeAprobacion.nota, 'Te dejo la campaña.');
  assert.match(prompt.datosConsultados[0], /… \[recortado\]$/);
  assert.ok(prompt.datosConsultados[0].length < 2600);
  // The data of earlier turns counts as consulted; a search proposal is an approval card too.
  const later = JSON.parse(coworkJudgePrompt({ request: 'créala', history: [{ request: 'busca', reply: 'Listo.', observations: [{ action: 'leads.search', result: 'Felipe Muñoz' }] }],
    shown: { reply: 'Revisa los criterios.', search: { titles: ['HR Manager'], limit: 10 }, document: { title: 'Informe', content: 'Resumen' } } }));
  assert.match(later.datosDelHistorial[0], /Felipe Muñoz/);
  assert.equal(later.loQueVioElUsuario.tarjetaDeAprobacion.tipo, 'búsqueda de prospectos con el proveedor');
  assert.deepEqual(later.loQueVioElUsuario.documento, { titulo: 'Informe', contenido: 'Resumen' });
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /siempre se proponen con una tarjeta de aprobación/);
  // Product facts the judge cannot guess: sending goes through a campaign, and the «use» button fixes a text.
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /no hay envío directo/);
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /«Usar esta versión».*no crear nada/);
  // A failed turn reads as the error the person saw.
  assert.equal(JSON.parse(coworkJudgePrompt({ request: 'x', shown: { reply: '', failed: 'No pude completar esta respuesta.' } })).loQueVioElUsuario.respuesta,
    'Error: No pude completar esta respuesta.');
});

test('summaries and agreement with people are plain numbers', () => {
  const summary = coworkJudgeSummary([judgement([5, 5, 4, 4, 4], 'buena'), judgement([4, 2, 3, 3, 3], 'mala')]);
  assert.deepEqual(summary.means, { comprension: 4.5, veracidad: 3.5, utilidad: 3.5, claridad: 3.5, friccion: 3.5 });
  assert.deepEqual(summary.veredictos, { buena: 1, mejorable: 0, mala: 1 });
  assert.equal(summary.withLowScore, 1);
  assert.equal(coworkJudgeSummary([]).means.comprension, null);
  const agreement = coworkJudgeAgreement([
    { human: { comprension: 4, veracidad: 5 }, judge: judgement([4, 3, 1, 1, 1]).scores },
    { human: { comprension: 2, veracidad: 5 }, judge: judgement([4, 5, 1, 1, 1]).scores },
  ]);
  assert.deepEqual(agreement.comprension, { n: 2, mae: 1, withinOne: 0.5 });
  assert.deepEqual(agreement.veracidad, { n: 2, mae: 1, withinOne: 0.5 });
  assert.equal(agreement.utilidad, null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COWORK_JUDGE_DIMENSIONS, COWORK_JUDGE_INSTRUCTIONS, coworkJudgeAgreement, coworkJudgePrompt, coworkJudgeSchema, coworkJudgeSummary,
  coworkJudgeFix, coworkShownFromAnswer, COWORK_JUDGE_TURN_INSTRUCTIONS, type CoworkJudgement,
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

test('in the turn, the judge asks for one correction only when it is worth it, and reads what the person would see', () => {
  const judgement = (scores: Partial<CoworkJudgement['scores']>, veredicto: CoworkJudgement['veredicto'], problemas: string[]): CoworkJudgement => ({
    scores: { comprension: 5, veracidad: 5, utilidad: 4, claridad: 5, friccion: 5, ...scores }, veredicto, problemas });
  // A good answer, or one only a little improvable, stands.
  assert.equal(coworkJudgeFix(judgement({}, 'buena', [])), null);
  assert.equal(coworkJudgeFix(judgement({ utilidad: 3 }, 'mejorable', ['Podría ser más breve.'])), null);
  // A free read offered instead of done, a claim without support, or a bad answer get one correction.
  const deferral = coworkJudgeFix(judgement({ friccion: 2 }, 'mala', ['Pide permiso para revisar los envíos, una consulta que podía hacer.']));
  assert.match(String(deferral), /una revisión de tu respuesta encontró:\n- Pide permiso para revisar los envíos/);
  assert.match(String(deferral), /hazla en esta decisión/);
  assert.ok(coworkJudgeFix(judgement({ veracidad: 3 }, 'mejorable', ['Dice «1 envío registrado» sin respaldo.'])));
  assert.equal(coworkJudgeFix(judgement({ friccion: 2 }, 'mala', [])), null, 'nothing concrete to fix');
  // The correction knows what the answer offered: its closing question, quoted.
  const quoted = coworkJudgeFix(judgement({ friccion: 2 }, 'mala', ['Pide permiso para revisar los envíos.']),
    { canRead: true, question: '¿Quieres que revise tus envíos?' });
  assert.match(String(quoted), /Tu respuesta terminaba con «¿Quieres que revise tus envíos\?»/);
  assert.match(String(quoted), /no con algo que puedas hacer tú/);
  // Without a read left, only what a rewrite can fix: a claim without support, or a misunderstood request.
  const noRead = { canRead: false, question: '¿Quieres que revise tus envíos?' };
  assert.equal(coworkJudgeFix(judgement({ friccion: 2 }, 'mala', ['Pide permiso para revisar los envíos.']), noRead), null);
  const rewrite = coworkJudgeFix(judgement({ veracidad: 3 }, 'mejorable', ['Dice «1 envío registrado» sin respaldo.']), noRead);
  assert.match(String(rewrite), /ya no quedan consultas: corrígela con lo que ya tienes/);
  assert.doesNotMatch(String(rewrite), /hazla en esta decisión/);
  assert.ok(coworkJudgeFix(judgement({ comprension: 2 }, 'mala', ['Responde otra cosa.']), noRead));
  assert.deepEqual(coworkShownFromAnswer({ reply: 'Te dejo la tabla.', question: '¿La exporto?', document: null,
    blocks: [{ type: 'table', title: 'Contactos', columns: ['Nombre'], rows: [['Felipe']] }], suggestions: [{ label: 'Sí', message: 'Sí, expórtala' }] }),
  { reply: 'Te dejo la tabla.', cards: 'Contactos\nNombre\nFelipe', question: '¿La exporto?', quickReplies: ['Sí, expórtala'], document: null });
});

test('the judge in the turn keeps the rubric and is stricter with offering what Cowork could do now; the offline judge does not change', () => {
  assert.ok(COWORK_JUDGE_TURN_INSTRUCTIONS.startsWith(COWORK_JUDGE_INSTRUCTIONS));
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /Sé estricto con la fricción/);
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /No es fricción ofrecer una acción que necesita aprobación/);
  assert.doesNotMatch(COWORK_JUDGE_INSTRUCTIONS, /Sé estricto con la fricción/);
});

test('the judge sees the options of a closing question as the chat shows them, and reads when asking with them is right', () => {
  const choices = { multiple: true, options: ['RR. HH.', 'Retail'] };
  const shown = coworkShownFromAnswer({ reply: 'Marca los segmentos.', question: '¿A qué segmentos va la campaña?', document: null,
    suggestions: [{ label: 'Sí', message: 'Sí, adelante' }], choices });
  assert.deepEqual(shown.choices, choices);
  assert.deepEqual(shown.quickReplies, []);
  const prompt = JSON.parse(coworkJudgePrompt({ request: 'arma una campaña', shown }));
  assert.deepEqual(prompt.loQueVioElUsuario.opciones, { variasALaVez: true, opciones: ['RR. HH.', 'Retail'], puedeEscribirOtra: true });
  // Without options, what the judge reads does not change.
  const plain = JSON.parse(coworkJudgePrompt({ request: 'hola', shown: coworkShownFromAnswer({ reply: 'Hola.', question: '¿Seguimos?', document: null }) }));
  assert.equal('opciones' in plain.loQueVioElUsuario, false);
  // Options without a question are not shown, as in the chat.
  assert.equal(coworkShownFromAnswer({ reply: 'Listo.', document: null, choices }).choices, undefined);
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /pregunta final con opciones .* no es fricción; pedir con opciones algo que Cowork podía decidir/);
});

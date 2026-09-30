import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COWORK_JUDGE_DIMENSIONS, COWORK_JUDGE_INSTRUCTIONS, COWORK_JUDGE_NOW_RULE, coworkJudgeAgreement, coworkJudgePrompt, coworkJudgeSchema, coworkJudgeSummary,
  coworkJudgeEvidence, coworkJudgeFix, coworkJudgeInstructions, coworkJudgeTurnPrompt, coworkShownFromAnswer, COWORK_JUDGE_TURN_INSTRUCTIONS, type CoworkJudgement,
} from './judge';
import { COWORK_NEXT_STEP_RULE } from './next-step';

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
  // What the person saved in «Perfil» is evidence: saying it is missing is a veracity failure.
  assert.match(COWORK_JUDGE_INSTRUCTIONS, /Lo que trae usuario \(oferta, servicios, pruebas y rubro\) también cuenta como dato consultado/);
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
  assert.ok(coworkJudgeFix(judgement({ veracidad: 2 }, 'mala', ['Dice «1 envío registrado» sin respaldo.'])));
  assert.equal(coworkJudgeFix(judgement({ friccion: 2 }, 'mala', [])), null, 'nothing concrete to fix');
  // A 3 (one avoidable step, an imprecise figure) stands: those corrections were not clearly better (G2).
  assert.equal(coworkJudgeFix(judgement({ friccion: 3 }, 'mejorable', ['Pregunta si revisa los envíos.'])), null);
  assert.equal(coworkJudgeFix(judgement({ veracidad: 3 }, 'mejorable', ['Dice «1 envío registrado» sin respaldo.'])), null);
  // The correction knows what the answer offered (its closing question, quoted), closes by the same rule
  // as the coordinator, and edits the answer instead of writing it again.
  const quoted = coworkJudgeFix(judgement({ friccion: 2 }, 'mala', ['Pide permiso para revisar los envíos.']),
    { canRead: true, question: '¿Quieres que revise tus envíos?' });
  assert.match(String(quoted), /Tu respuesta terminaba con «¿Quieres que revise tus envíos\?»/);
  assert.ok(String(quoted).includes(`Cómo cerrar: ${COWORK_NEXT_STEP_RULE}`));
  assert.match(String(quoted), /Edita tu respuesta anterior \(answerToCorrect\): cambia solo lo señalado/);
  assert.match(String(quoted), /No cambies el propósito de la respuesta/);
  // Without a read left, only what a rewrite can fix: a claim without support, or a misunderstood request.
  const noRead = { canRead: false, question: '¿Quieres que revise tus envíos?' };
  assert.equal(coworkJudgeFix(judgement({ friccion: 2 }, 'mala', ['Pide permiso para revisar los envíos.']), noRead), null);
  const rewrite = coworkJudgeFix(judgement({ veracidad: 2 }, 'mala', ['Dice «1 envío registrado» sin respaldo.']), noRead);
  assert.match(String(rewrite), /ya no quedan consultas: corrígela con lo que ya tienes/);
  assert.doesNotMatch(String(rewrite), /hazla en esta decisión/);
  assert.ok(coworkJudgeFix(judgement({ comprension: 2 }, 'mala', ['Responde otra cosa.']), noRead));
  assert.deepEqual(coworkShownFromAnswer({ reply: 'Te dejo la tabla.', question: '¿La exporto?', document: null,
    blocks: [{ type: 'table', title: 'Contactos', columns: ['Nombre'], rows: [['Felipe']] }], suggestions: [{ label: 'Sí', message: 'Sí, expórtala' }] }),
  { reply: 'Te dejo la tabla.', cards: 'Contactos\nNombre\nFelipe', question: '¿La exporto?', quickReplies: ['Sí, expórtala'], document: null });
});

test('the judge in the turn keeps the rubric and closes by the coordinator\'s rule; the offline judge does not change', () => {
  assert.ok(COWORK_JUDGE_TURN_INSTRUCTIONS.startsWith(COWORK_JUDGE_INSTRUCTIONS));
  // One rule for how an answer closes: the coordinator was told to offer a next step and the judge
  // punished it, so most judged answers were sent back.
  assert.ok(COWORK_JUDGE_TURN_INSTRUCTIONS.includes(COWORK_NEXT_STEP_RULE));
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /que el pedido necesitaba, la fricción es 2 o menos/);
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /No es fricción ofrecer una acción que necesita aprobación/);
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /los botones pueden ofrecer otros pedidos/);
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /Ante una pregunta general .*no le exijas consultas/);
  assert.match(COWORK_JUDGE_TURN_INSTRUCTIONS, /ahora es la fecha y hora del trabajo/);
  assert.doesNotMatch(COWORK_JUDGE_INSTRUCTIONS, /Esta revisión ocurre antes de mostrar/);
});

test('the offline judge can be given the date of the work without changing how much it reads or what it was calibrated on', () => {
  const observations = Array.from({ length: 8 }, (_, index) => ({ action: `read.${index}`, result: { index } }));
  const base = { request: '¿Qué toca hoy?', observations, shown: { reply: 'Hoy toca…' } as never };
  // Without a date nothing is added: the calibration set and older reports read as they always did.
  const plain = JSON.parse(coworkJudgePrompt(base));
  assert.equal('ahora' in plain, false);
  assert.equal(plain.datosConsultados.length, 6, 'the calibrated budget: the first six reads');
  // With the work's date the judge counts days from it (a world dated the 25th is not read as if it were the day the judge runs)…
  const dated = JSON.parse(coworkJudgePrompt({ ...base, now: new Date('2026-09-25T13:10:00Z') }));
  assert.match(dated.ahora, /^25 [a-z]+ 2026, \d{2}:10$/);
  assert.equal(dated.datosConsultados.length, 6, 'the date does not widen what it reads');
  // …and the rule that says so is the same sentence the judge in the turn follows.
  assert.match(COWORK_JUDGE_NOW_RULE, /ahora es la fecha y hora del trabajo/);
  assert.ok(COWORK_JUDGE_TURN_INSTRUCTIONS.includes(COWORK_JUDGE_NOW_RULE));
  assert.equal(COWORK_JUDGE_INSTRUCTIONS.includes(COWORK_JUDGE_NOW_RULE), false, 'the calibrated rubric itself does not move');
  // The in-turn evidence, when given, wins: one date, read once.
  const both = JSON.parse(coworkJudgePrompt({ ...base, now: new Date('2026-09-01T00:00:00Z'), evidence: { now: new Date('2026-09-25T13:00:00Z') } }));
  assert.match(both.ahora, /^25 [a-z]+ 2026/);
});

test('in the turn, the judge reads every read as the coordinator did: local times, no IDs, a count per list, within one budget', () => {
  const id = '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
  const leads = { action: 'leads.search', input: 'RR. HH.', result: { items: [
    { id, name: 'Felipe Mu***z', email: 'felipe@empresa.cl', created_at: '2026-09-25T13:05:00Z' },
    { id: 'x2', name: 'Paula Ro***s', email: null },
  ], truncated: true } };
  const evidence = coworkJudgeEvidence([leads, { action: 'metrics.overview', input: '', result: { sent: 12 } }], { timeZone: 'America/Santiago' });
  const [list, metrics] = evidence as [{ resumen: unknown; datos: string }, string];
  assert.deepEqual(list.resumen, { elementos: 2, conCorreo: 1, truncado: true });
  // The coordinator read 10:05 in Santiago next to the stored time; the judge reads the same, without internal IDs.
  assert.match(list.datos, /"created_at_local":"25 [a-z]+ 2026, 10:05"/);
  assert.equal(list.datos.includes(id), false);
  assert.match(list.datos, /\[id\]/);
  assert.equal(metrics, JSON.stringify({ action: 'metrics.overview', input: '', result: { sent: 12 } }));
  // Many long reads share the budget: none is left out, each is cut, the total stays near it.
  const long = Array.from({ length: 8 }, (_, index) => ({ action: 'crm.search', input: String(index), result: 'x'.repeat(9000) }));
  const shared = coworkJudgeEvidence(long, { total: 24_000, timeZone: 'UTC' }) as string[];
  assert.equal(shared.length, 8);
  assert.ok(shared.every(text => text.endsWith('… [recortado]')));
  assert.ok(shared.reduce((sum, text) => sum + text.length, 0) < 24_000 + 8 * 20);
  // A short read keeps all of it and leaves its share to the long ones.
  const mixed = coworkJudgeEvidence([{ action: 'a', result: 'corto' }, { action: 'b', result: 'y'.repeat(30_000) }], { total: 10_000, each: 8_000, timeZone: 'UTC' }) as string[];
  assert.equal(mixed[0], JSON.stringify({ action: 'a', result: 'corto' }));
  assert.equal(mixed[1].length, 8_000 + '… [recortado]'.length);
  // The turn's prompt carries the work's date, in local time, and every read.
  const prompt = JSON.parse(coworkJudgeTurnPrompt({ request: '¿a quién le escribo?', history: [], userContext: null,
    observations: [leads, ...long], answer: { reply: 'A Felipe.', document: null }, now: new Date('2026-09-25T13:00:00Z') }));
  assert.match(prompt.ahora, /^25 [a-z]+ 2026, \d{2}:00$/);
  assert.equal(prompt.datosConsultados.length, 9);
});

test('the judge reads importing as the turn ran it: the person imports with the flag off, Cowork proposes it with the flag on', () => {
  // Off (the default), offline and in the turn, the rules read as before F4.
  assert.equal(coworkJudgeInstructions(), COWORK_JUDGE_INSTRUCTIONS);
  assert.equal(coworkJudgeInstructions({ inTurn: true }), COWORK_JUDGE_TURN_INSTRUCTIONS);
  const offRule = 'Cowork no crea contactos a partir de un correo: solo guarda personas encontradas con el proveedor, y un correo que no está guardado lo importa el usuario.';
  assert.ok(COWORK_JUDGE_INSTRUCTIONS.includes(offRule));
  // On, only that rule changes: Cowork imports the people of a file with its card, and sending the person to do it by hand is the miss.
  const on = coworkJudgeInstructions({ contactsImport: true });
  const [before, after] = COWORK_JUDGE_INSTRUCTIONS.split(offRule);
  assert.ok(on.startsWith(before) && on.endsWith(after));
  assert.doesNotMatch(on, /lo importa el usuario/);
  assert.match(on, /importa a las personas de un archivo subido \(CSV, Excel o lista JSON\) con una tarjeta de aprobación que muestra quiénes entran/);
  assert.match(on, /deja fuera sola a quienes ya estaban guardados/);
  // The card's figures are the server's, so a reply that says another figure is the one that is wrong.
  assert.match(on, /las calcula el servidor contra el archivo completo y los contactos guardados: son datos/);
  assert.match(on, /lo correcto es proponer esa importación, no mandarlo a hacerlo a mano; si solo pregunta qué trae el archivo o a quién escribir primero, lo correcto es responder eso/);
  const inTurn = coworkJudgeInstructions({ contactsImport: true, inTurn: true });
  assert.ok(inTurn.startsWith(on));
  // What the turn adds is the closing rule the coordinator follows, plus the date of the work.
  assert.match(inTurn, /Cómo debe cerrar una respuesta/);
  assert.match(inTurn, /ahora es la fecha y hora del trabajo/);
});

test('the judge reads replying in a thread as the turn ran it: a proposal with a card, never a send already done', () => {
  // Off, nothing about it: the rules read as before.
  assert.equal(coworkJudgeInstructions({ replyThread: false }), COWORK_JUDGE_INSTRUCTIONS);
  assert.doesNotMatch(COWORK_JUDGE_INSTRUCTIONS, /dentro del hilo original/);
  // On, one rule is added next to the import one, and the rest reads the same.
  const on = coworkJudgeInstructions({ replyThread: true });
  assert.match(on, /Cowork responde a quien escribió dentro del hilo original: lee su conversación \(replies\.thread\)/);
  assert.match(on, /propone la respuesta con una tarjeta de aprobación que muestra el texto exacto, y solo sale si el usuario la aprueba/);
  assert.match(on, /una propuesta no es un envío hecho, así que decir que ya se envió es un dato falso/);
  assert.match(on, /No se responde a quien pidió no recibir más mensajes, a un aviso automático, a quien ya tiene respuesta ni a quien dijo que no/);
  assert.match(on, /cada envío lleva su propia aprobación/);
  assert.match(on, /Cowork no crea contactos a partir de un correo: solo guarda personas encontradas con el proveedor/, 'the import rule stays as it was');
  // Both flags together keep both rules, and the turn rules still come after.
  const both = coworkJudgeInstructions({ contactsImport: true, replyThread: true, inTurn: true });
  assert.match(both, /importa a las personas de un archivo subido/);
  assert.match(both, /dentro del hilo original/);
  assert.ok(both.indexOf('Cómo debe cerrar una respuesta') > both.indexOf('dentro del hilo original'));
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

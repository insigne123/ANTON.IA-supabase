// «¿Qué toca hoy?» (scripts/fixtures/cowork-agenda-corpus.ts) played through the real loop with a scripted model: a good turn reads the
// agenda once and passes every check; a turn that answers without looking or without saying anything must not; and every check
// has been seen to fail on a good turn made one thing worse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { buildCoworkAgenda } from '../src/lib/cowork/agenda';
import { AGENDA_CORPUS } from './fixtures/cowork-agenda-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const read = (action: string) => coworkDecisionSchema.parse({ action, query: null, leadId: null, answer: null });
const table = (rows: string[][]) => ({ type: 'table', title: 'Lo que toca hoy', columns: ['#', 'Quién o qué', 'Qué pasó', 'Qué hago'], rows });
const answer = (reply: string, question: string, rows: string[][] | null) => coworkDecisionSchema.parse({
  action: 'answer', query: null, leadId: null,
  answer: { reply, document: null, suggestions: [{ label: 'Sí, prepáralas', message: 'Sí, prepara las respuestas' }], question, ...(rows ? { blocks: [table(rows)] } : {}) },
});
/** Reads the agenda on the first decision and answers on the next, like a good turn. */
const ideal = (reply: string, question: string, rows: string[][] | null): CorpusDecider => async context =>
  context.observations.length === 0 ? read('agenda.today') : answer(reply, question, rows);

const IDEAL: Record<string, CorpusDecider> = {
  'agenda-toca-hoy': ideal(
    'Hoy toca, en este orden: 3 interesados esperan respuesta (Marcela Rojas, de Servicios Norte, pidió reunión hace 4 días), hay 1 respuesta de Sofía Lira que nadie ha leído, 2 aprobaciones tuyas pendientes y 2 invitaciones de LinkedIn aceptadas sin mensaje. Iván Herrera (Servicios Integrales) lleva 24 días sin respuesta: hay que retomarlo, no solo responder.\nSalen solos 47 seguimientos de «Prospección construcción y RR. HH.», espaciados cada 30 minutos; otros 3 quedan retenidos porque esa empresa ya respondió. Hay 1 rebote por corregir (Rodrigo Pino, de Transportes Andes). Llegaron además 2 respuestas automáticas: van aparte y no cuentan como respuestas.',
    '¿Te preparo las respuestas a los 3 interesados?', [
      ['1', 'Marcela Rojas · Servicios Norte', 'Pidió reunión hace 4 días', 'Responderle con horarios'],
      ['2', 'Héctor Vidal · Casino Central', 'Interesado hace 3 días', 'Responderle'],
      ['3', 'Ana Ruiz · Alimentos del Valle', 'Interesada hace 2 días', 'Responderle'],
      ['4', '2 aprobaciones tuyas', 'Esperan tu visto bueno', 'Revisarlas'],
      ['5', 'Sofía Lira · Minera Norte', 'Respondió y nadie la ha leído', 'Leer qué dijo'],
      ['6', 'Iván Herrera · Servicios Integrales', '24 días sin respuesta', 'Retomar la conversación'],
      ['7', '2 invitaciones de LinkedIn', 'Aceptaron y no tienen mensaje', 'Escribirles'],
      ['8', '47 seguimientos', 'Salen solos hoy', 'Nada, salvo que quieras pausarlos']]),
  'agenda-fuente-caida': ideal(
    'Hoy esperan 3 interesados (Marcela Rojas pidió reunión hace 4 días), 1 respuesta de Sofía Lira que nadie ha leído y 2 aprobaciones tuyas. No pude revisar los seguimientos de tus campañas, así que no sé cuántos salen hoy y no los doy por cero. Iván Herrera lleva 24 días sin respuesta y hay 1 rebote por corregir (Rodrigo Pino).',
    '¿Te preparo las respuestas a los 3 interesados mientras vuelvo a revisar los seguimientos?', [
      ['1', 'Marcela Rojas · Servicios Norte', 'Pidió reunión hace 4 días', 'Responderle con horarios'],
      ['2', 'Héctor Vidal · Casino Central', 'Interesado hace 3 días', 'Responderle'],
      ['3', 'Ana Ruiz · Alimentos del Valle', 'Interesada hace 2 días', 'Responderle'],
      ['4', '2 aprobaciones tuyas', 'Esperan tu visto bueno', 'Revisarlas'],
      ['5', 'Sofía Lira · Minera Norte', 'Respondió y nadie la ha leído', 'Leer qué dijo'],
      ['6', 'Iván Herrera · Servicios Integrales', '24 días sin respuesta', 'Retomar la conversación'],
      ['7', 'Rodrigo Pino · Transportes Andes', '1 rebote', 'Corregir el correo']]),
  'agenda-dos-personas-una-empresa': ideal(
    'Hoy toca responder a 2 empresas, 3 personas en total: Servicios Norte, donde Marcela Rojas y Gerardo Paz escribieron (Gerardo pidió reunión), y Casino Central, donde Héctor Vidal espera hace 3 días.',
    '¿Te preparo las respuestas a las 2 empresas?', [
      ['1', 'Servicios Norte', 'Marcela Rojas y Gerardo Paz escribieron; uno pidió reunión', 'Responderles'],
      ['2', 'Casino Central', 'Héctor Vidal espera hace 3 días', 'Responderle']]),
};

const entry = (id: string) => AGENDA_CORPUS.find(item => item.id === id)!;
const failing = async (id: string, decide: CorpusDecider) =>
  (await runCorpusCase(entry(id), decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the agenda bank has one ideal turn for each of its cases', () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), AGENDA_CORPUS.map(item => item.id).sort());
  assert.equal(new Set(AGENDA_CORPUS.map(item => item.id)).size, AGENDA_CORPUS.length);
});

test('the world of each case is what the app reads: the real agenda, in the real order', async () => {
  for (const item of AGENDA_CORPUS) {
    const agenda = item.world!.read('agenda.today', '') as ReturnType<typeof buildCoworkAgenda>;
    assert.equal(agenda.scope, 'own_agenda_today', item.id);
    assert.deepEqual(agenda.items.map(row => row.rank), agenda.items.map((_, index) => index + 1), item.id);
  }
  const full = entry('agenda-toca-hoy').world!.read('agenda.today', '') as ReturnType<typeof buildCoworkAgenda>;
  assert.deepEqual(full.items.map(row => row.kind), ['meeting_request', 'interested_reply', 'interested_reply', 'approval', 'unclassified_reply',
    'cooled_lead', 'linkedin_accepted', 'followups_due', 'bounce']);
  assert.equal(full.counts.interestedAccounts, 3);
  assert.equal(full.counts.followupsReady, 47);
  assert.equal(full.counts.followupsHeld, 3);
  assert.equal(full.counts.autoReplies, 2);
  const broken = entry('agenda-fuente-caida').world!.read('agenda.today', '') as ReturnType<typeof buildCoworkAgenda>;
  assert.equal(broken.complete, false);
  assert.equal(broken.sources.followups, 'unavailable');
  const couple = entry('agenda-dos-personas-una-empresa').world!.read('agenda.today', '') as ReturnType<typeof buildCoworkAgenda>;
  assert.equal(couple.counts.interestedAccounts, 2);
  assert.equal(couple.counts.interestedPeople, 3);
});

for (const item of AGENDA_CORPUS) {
  test(`${item.id}: a good turn reads the agenda once and passes every check`, async () => {
    const outcome = await runCorpusCase(item, IDEAL[item.id]);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
    assert.deepEqual(outcome.result.actions, ['agenda.today']);
  });

  test(`${item.id}: answering without looking fails at least three checks`, async () => {
    const naive: CorpusDecider = async () => answer('Hoy puedes revisar tus campañas y tus contactos.', '¿Qué quieres hacer primero?', null);
    const missed = await failing(item.id, naive);
    assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
    assert.ok(missed.includes('consulta la lista del día en una sola lectura'));
  });

  test(`${item.id}: looking at the agenda and saying nothing fails at least three checks`, async () => {
    const vacuous: CorpusDecider = async context => context.observations.length === 0 ? read('agenda.today')
      : answer('Revisé tu día y hay varias cosas pendientes.', '¿Seguimos?', null);
    const missed = await failing(item.id, vacuous);
    assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

// A check nobody ever saw fail proves nothing: each of these makes one thing worse in a good turn and names the check that must notice.
const swap = (from: string, to: string) => (text: string) => { assert.ok(text.includes(from), `the good turn no longer says: ${from}`); return text.replace(from, to); };
const degrade = (decide: CorpusDecider, change: { reply?: (text: string) => string; question?: string; blocks?: null }): CorpusDecider => async (context, meta) => {
  const decision = await decide(context, meta);
  if (decision.action !== 'answer' || !decision.answer) return decision;
  return coworkDecisionSchema.parse({ ...decision, answer: { ...decision.answer,
    reply: change.reply ? change.reply(decision.answer.reply) : decision.answer.reply,
    question: change.question ?? decision.answer.question, ...(change.blocks === null ? { blocks: null } : {}) } });
};
const MUTATIONS: Array<{ id: string; what: string; change: Parameters<typeof degrade>[1]; notices: string }> = [
  { id: 'agenda-toca-hoy', what: 'counts the automatic replies as replies', notices: 'las autorrespuestas van aparte y no cuentan como respuestas',
    change: { reply: swap(' Llegaron además 2 respuestas automáticas: van aparte y no cuentan como respuestas.', ' Además llegaron 2 respuestas más.') } },
  { id: 'agenda-toca-hoy', what: 'postpones the follow-ups for an hour the person never gave', notices: 'no inventa una ventana horaria ni pospone por la hora',
    change: { reply: swap('espaciados cada 30 minutos', 'pero la ventana de envío es de martes a jueves, así que esperan hasta el martes') } },
  { id: 'agenda-toca-hoy', what: 'puts what leaves by itself before the people who answered', notices: 'las personas que respondieron van antes que los seguimientos que salen solos',
    change: { reply: text => { const [first, second] = text.split('\n'); return `${second}\n${first}`; }, blocks: null } },
  { id: 'agenda-toca-hoy', what: 'does not say that three follow-ups are held back', notices: 'dice que 3 seguimientos quedan retenidos porque esa empresa ya respondió',
    change: { reply: swap('; otros 3 quedan retenidos porque esa empresa ya respondió', '') } },
  { id: 'agenda-toca-hoy', what: 'forgets the lead that cooled', notices: 'el que se enfrió se retoma, no solo se responde',
    change: { reply: swap(' Iván Herrera (Servicios Integrales) lleva 24 días sin respuesta: hay que retomarlo, no solo responder.', ''), blocks: null } },
  { id: 'agenda-toca-hoy', what: 'gives the work back to the person', notices: 'no devuelve la pregunta al usuario',
    change: { question: '¿Qué quieres hacer primero?' } },
  { id: 'agenda-toca-hoy', what: 'rounds the numbers', notices: 'da las cifras exactas: 3 interesados, 47 seguimientos y 1 rebote',
    change: { reply: swap('Salen solos 47 seguimientos', 'Salen solos casi 50 seguimientos'), blocks: null } },
  { id: 'agenda-toca-hoy', what: 'does not name who asked for a meeting', notices: 'nombra al que pidió reunión y dice cuánto lleva esperando',
    change: { reply: swap(' (Marcela Rojas, de Servicios Norte, pidió reunión hace 4 días)', ''), blocks: null } },
  { id: 'agenda-toca-hoy', what: 'adds the meeting request to the three interested', notices: 'no suma la reunión pedida a los interesados: son 3, no 4',
    change: { reply: swap('3 interesados esperan respuesta', '4 interesados esperan respuesta'), blocks: null } },
  { id: 'agenda-toca-hoy', what: 'draws the table with vertical bars inside the reply', notices: 'no escribe la tabla con barras verticales en el texto',
    change: { reply: text => `${text}\n\n| # | Quién o qué | Qué hago |\n|---|---|---|\n| 1 | Marcela Rojas · Servicios Norte | Responderle |`, blocks: null } },
  { id: 'agenda-fuente-caida', what: 'draws the table with vertical bars inside the reply', notices: 'no escribe la tabla con barras verticales en el texto',
    change: { reply: text => `${text}\n\n| # | Quién o qué | Qué hago |\n|---|---|---|\n| 1 | Marcela Rojas · Servicios Norte | Responderle |`, blocks: null } },
  { id: 'agenda-fuente-caida', what: 'leaves the list out of a table', notices: 'entrega la lista como tabla, en orden',
    change: { blocks: null } },
  { id: 'agenda-fuente-caida', what: 'says there are no follow-ups instead of saying it could not look', notices: 'dice que no pudo revisar los seguimientos de las campañas',
    change: { reply: swap('No pude revisar los seguimientos de tus campañas, así que no sé cuántos salen hoy y no los doy por cero.', 'No hay seguimientos para hoy.') } },
  { id: 'agenda-fuente-caida', what: 'says the follow-ups «are 0» while admitting it could not look', notices: 'no da los seguimientos por cero ni por revisados',
    change: { reply: swap('así que no sé cuántos salen hoy y no los doy por cero', 'pero los seguimientos automáticos listados son 0') } },
  { id: 'agenda-fuente-caida', what: 'gives the follow-ups as zero', notices: 'no da los seguimientos por cero ni por revisados',
    change: { reply: swap('así que no sé cuántos salen hoy y no los doy por cero', 'pero hoy no salen seguimientos: hay 0 seguimientos') } },
  { id: 'agenda-dos-personas-una-empresa', what: 'gives Gerardo the five days Marcela has waited', notices: 'no le pone a Gerardo la espera de Marcela (5 días)',
    change: { reply: swap('(Gerardo pidió reunión)', '(Gerardo pidió reunión y espera hace 5 días)'), blocks: null } },
  { id: 'agenda-dos-personas-una-empresa', what: 'counts three companies for three people', notices: 'no cuenta 3 empresas',
    change: { reply: swap('responder a 2 empresas, 3 personas en total', 'responder a 3 empresas'), blocks: null } },
  { id: 'agenda-dos-personas-una-empresa', what: 'drops the table that puts the two colleagues in one row', notices: 'Servicios Norte va en una sola fila: 2 filas para 3 personas',
    change: { blocks: null } },
  { id: 'agenda-dos-personas-una-empresa', what: 'attributes the meeting to both colleagues', notices: 'atribuye la reunión a quien la pidió: Gerardo, no los dos',
    change: { reply: swap('(Gerardo pidió reunión)', '(los dos pidieron reunión)'), blocks: null } },
  { id: 'agenda-dos-personas-una-empresa', what: 'says both asked for the meeting', notices: 'no dice que los dos pidieron la reunión',
    change: { reply: swap('(Gerardo pidió reunión)', '(los dos pidieron reunión)'), blocks: null } },
  { id: 'agenda-dos-personas-una-empresa', what: 'talks about spaced sends when there are no follow-ups', notices: 'no habla de envíos espaciados que no existen: no hay seguimientos',
    change: { reply: swap('espera hace 3 días.', 'espera hace 3 días. Los envíos salen espaciados según la regla de una empresa por día.') } },
  { id: 'agenda-dos-personas-una-empresa', what: 'lists the company that did not ask for a meeting first', notices: 'la empresa que pidió reunión va antes',
    change: { reply: swap('Servicios Norte, donde Marcela Rojas y Gerardo Paz escribieron (Gerardo pidió reunión), y Casino Central, donde Héctor Vidal espera hace 3 días',
      'Casino Central, donde Héctor Vidal espera hace 3 días, y Servicios Norte, donde Marcela Rojas y Gerardo Paz escribieron (Gerardo pidió reunión)'), blocks: null } },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: ${mutation.what}, and a check notices`, async () => {
    const missed = await failing(mutation.id, degrade(IDEAL[mutation.id], mutation.change));
    assert.ok(missed.includes(mutation.notices), `«${mutation.notices}» did not fail; failing: ${missed.join(' | ') || 'none'}`);
  });
}

// The other side of a check: the same facts in other words are not a failure. These are the ways the real model put them.
test('agenda-toca-hoy: «no conté» says the automatic replies were kept apart as well as «no cuentan» does', async () => {
  const missed = await failing('agenda-toca-hoy', degrade(IDEAL['agenda-toca-hoy'],
    { reply: swap('van aparte y no cuentan como respuestas', 'que no conté como respuestas de personas') }));
  assert.deepEqual(missed, []);
});

const COUPLE_REPLY = 'Hoy hay 3 personas interesadas en 2 empresas que esperan respuesta. En Servicios Norte, Gerardo Paz pidió una reunión; Marcela Rojas también espera respuesta. Héctor Vidal espera respuesta en Casino Central.';
const COUPLE_QUESTION = '¿Preparo respuestas para las tres personas, atendiendo primero la solicitud de reunión de Gerardo?';
test('agenda-dos-personas-una-empresa: one row naming each colleague with their own wait and who asked is not a misattribution', async () => {
  const missed = await failing('agenda-dos-personas-una-empresa', ideal(COUPLE_REPLY, COUPLE_QUESTION, [
    ['1', 'Servicios Norte: Marcela Rojas y Gerardo Paz', 'Marcela espera hace 5 días; Gerardo pidió reunión y espera hace 2 días', 'Responder a ambos; atender primero la solicitud de reunión de Gerardo'],
    ['2', 'Casino Central: Héctor Vidal', 'Interesado; espera respuesta hace 3 días', 'Preparar respuesta']]));
  assert.deepEqual(missed, []);
});
test('agenda-dos-personas-una-empresa: a row for each person is three rows, not one per company', async () => {
  const missed = await failing('agenda-dos-personas-una-empresa', ideal(COUPLE_REPLY, COUPLE_QUESTION, [
    ['1', 'Gerardo Paz — Servicios Norte', 'Pidió reunión; espera 2 días', 'Responder y coordinar la reunión'],
    ['2', 'Marcela Rojas — Servicios Norte', 'Espera respuesta; 5 días', 'Responder por separado'],
    ['3', 'Héctor Vidal — Casino Central', 'Interesado; espera 3 días', 'Responder']]));
  assert.ok(missed.includes('Servicios Norte va en una sola fila: 2 filas para 3 personas'), `failing: ${missed.join(' | ') || 'none'}`);
  assert.deepEqual(missed.filter(label => label !== 'Servicios Norte va en una sola fila: 2 filas para 3 personas'), []);
});
test('agenda-dos-personas-una-empresa: a colleague that shares the wait in one row is still a misattribution', async () => {
  const missed = await failing('agenda-dos-personas-una-empresa', ideal(COUPLE_REPLY, COUPLE_QUESTION, [
    ['1', 'Servicios Norte', 'Gerardo Paz pidió reunión y espera hace 5 días', 'Responder a ambos'],
    ['2', 'Casino Central', 'Héctor Vidal espera hace 3 días', 'Preparar respuesta']]));
  assert.ok(missed.includes('no le pone a Gerardo la espera de Marcela (5 días)'), `failing: ${missed.join(' | ') || 'none'}`);
});

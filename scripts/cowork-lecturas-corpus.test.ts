// The reads that close gaps 6, 7 and 10 of the AXIS bank (scripts/fixtures/cowork-lecturas-corpus.ts) played through the real loop with a
// scripted model: a good turn reads once and passes every check; answering without reading, or reading and saying nothing, must not;
// and each check that guards a figure or a claim has been seen to fail on a good turn made one thing worse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { LECTURAS_CORPUS } from './fixtures/cowork-lecturas-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const read = (action: string, query: string | null) => coworkDecisionSchema.parse({ action, query, leadId: null, answer: null });
type Suggestion = { label: string; message: string };
const answer = (reply: string, question: string, suggestions: Suggestion[]) => coworkDecisionSchema.parse({
  action: 'answer', query: null, leadId: null, answer: { reply, document: null, suggestions, question } });
const ideal = (action: string, query: string | null, reply: string, question: string, suggestions: Suggestion[]): CorpusDecider => async context =>
  context.observations.length === 0 ? read(action, query) : answer(reply, question, suggestions);

const IDEAL: Record<string, CorpusDecider> = {
  'lectura-contar-segmento': ideal('leads.count', 'reclutador|recursos humanos|talent',
    'Tienes 214 contactos guardados que calzan con reclutamiento o recursos humanos, y 180 de ellos tienen correo. El conteo es exacto y se hace por texto en el cargo, la empresa y el sector.',
    '¿Te muestro a los primeros con correo?', [{ label: 'Sí, muéstramelos', message: 'Muéstrame los primeros contactos de reclutamiento con correo' }]),
  'lectura-cupo-pendientes': ideal('linkedin.quota', '',
    'Hoy tienes cupo: 4 pendientes en la cola y 18 enviadas en los últimos 7 días, de un límite operativo de 100. Además, al menos 61 de las que enviaste desde ANTON.IA siguen sin aceptar; las que enviaste directo en LinkedIn no las veo desde aquí.',
    '¿Cuántas pendientes ves tú en LinkedIn, para ajustar el cupo?', [{ label: 'Te lo digo', message: 'En LinkedIn veo 86 invitaciones pendientes' }]),
  'lectura-seguimiento-empresa': ideal('linkedin.followups', '',
    'Esta semana te conviene escribirle a Paula Ríos (Transportes del Sur) y a Sara Lira (Minera Norte): una por empresa. Hugo Mena es de la misma empresa que Paula y queda para otro día. De Tomás Vega no conozco la empresa y no la voy a adivinar.',
    '¿Te propongo el mensaje para Paula y Sara?', [{ label: 'Sí, propónlos', message: 'Propón el mensaje de LinkedIn para Paula Ríos y Sara Lira' }]),
  'lectura-saldo-creditos': ideal('credits.balance', '',
    'Te quedan 1.840 créditos de 2.500. Para buscar el correo de 120 contactos necesitas 120 créditos (uno por contacto), así que te alcanza de sobra. Revelar un teléfono cuesta diez créditos: con este saldo alcanzarían 184.',
    '¿Quieres que empecemos por los 120 contactos con más encaje?', [{ label: 'Sí, empecemos', message: 'Empieza a buscar el correo de los contactos con más encaje' }]),
};

const entry = (id: string) => LECTURAS_CORPUS.find(item => item.id === id)!;
const failing = async (id: string, decide: CorpusDecider) =>
  (await runCorpusCase(entry(id), decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the bank has one ideal turn for each case', () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), LECTURAS_CORPUS.map(item => item.id).sort());
});

for (const item of LECTURAS_CORPUS) {
  test(`${item.id}: a good turn reads once and passes every check`, async () => {
    const outcome = await runCorpusCase(item, IDEAL[item.id]);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
    assert.equal(outcome.result.actions.length, 1);
  });

  test(`${item.id}: answering without reading fails at least three checks`, async () => {
    const naive: CorpusDecider = async () => answer('Tienes varios, más o menos unos 20.', '¿Quieres que los revise?', [{ label: 'Sí', message: 'Sí, revísalos' }]);
    const missed = await failing(item.id, naive);
    assert.ok(missed.length >= 3, `only failed: ${missed.join(' | ') || 'nothing'}`);
  });

  test(`${item.id}: reading and saying nothing fails at least two checks`, async () => {
    const first = IDEAL[item.id];
    const vacuous: CorpusDecider = async (context, meta) => context.observations.length === 0 ? first(context, meta)
      : answer('Revisé los datos y hay cosas por ver.', '¿Seguimos?', [{ label: 'Sí, sigue', message: 'Sí, sigue' }]);
    const missed = await failing(item.id, vacuous);
    assert.ok(missed.length >= 2, `only failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

const swap = (from: string, to: string) => (text: string) => { assert.ok(text.includes(from), `the good turn no longer says: ${from}`); return text.replace(from, to); };
const degrade = (decide: CorpusDecider, change: (text: string) => string): CorpusDecider => async (context, meta) => {
  const decision = await decide(context, meta);
  if (decision.action !== 'answer' || !decision.answer) return decision;
  return coworkDecisionSchema.parse({ ...decision, answer: { ...decision.answer, reply: change(decision.answer.reply) } });
};
const MUTATIONS: Array<{ id: string; what: string; change: (text: string) => string; notices: string }> = [
  { id: 'lectura-saldo-creditos', what: 'says it does not reach', notices: 'no dice que no alcanza', change: swap('así que te alcanza de sobra', 'así que no te alcanza') },
  { id: 'lectura-saldo-creditos', what: 'forgets what a phone costs', notices: 'dice que revelar un teléfono cuesta diez', change: swap(' Revelar un teléfono cuesta diez créditos: con este saldo alcanzarían 184.', '') },
  { id: 'lectura-saldo-creditos', what: 'rounds the balance', notices: 'da el saldo tal cual: 1.840 créditos', change: swap('1.840 créditos de 2.500', 'casi 2.000 créditos') },
  { id: 'lectura-contar-segmento', what: 'rounds the exact count', notices: 'da el número exacto: 214, de los cuales 180 tienen correo', change: swap('214', 'unos 200') },
  { id: 'lectura-contar-segmento', what: 'gives the 20 that the search lists', notices: 'no dice que son 20 (lo que lista la búsqueda)', change: text => `${text} Son 20 contactos.` },
  { id: 'lectura-cupo-pendientes', what: 'merges pending and sent into one figure', notices: 'separa pendientes (4) y enviadas (18) sin mezclarlas', change: swap('4 pendientes en la cola y 18 enviadas', '22 usadas') },
  { id: 'lectura-cupo-pendientes', what: 'says the quota was used', notices: 'no dice «se usaron 22»', change: text => `${text} Se usaron 22 de 100.` },
  { id: 'lectura-cupo-pendientes', what: 'forgets what it cannot see', notices: 'dice que lo enviado directo en LinkedIn no lo ve', change: swap('; las que enviaste directo en LinkedIn no las veo desde aquí', '') },
  { id: 'lectura-seguimiento-empresa', what: 'proposes two people of the same company', notices: 'no propone a Hugo: es de la misma empresa que Paula',
    change: swap('Hugo Mena es de la misma empresa que Paula y queda para otro día.', 'Hugo Mena también es buena opción.') },
  { id: 'lectura-seguimiento-empresa', what: 'guesses the company of the one without', notices: 'dice que de Tomás no conoce la empresa y no la adivina',
    change: swap('De Tomás Vega no conozco la empresa y no la voy a adivinar.', 'Tomás Vega, de Minera Norte, también sirve.') },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: a good turn that ${mutation.what} is caught by «${mutation.notices}»`, async () => {
    const missed = await failing(mutation.id, degrade(IDEAL[mutation.id], mutation.change));
    assert.ok(missed.includes(mutation.notices), `the check did not notice; failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

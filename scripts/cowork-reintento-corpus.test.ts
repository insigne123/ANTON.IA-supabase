// Retrying failed sends (scripts/fixtures/cowork-reintento-corpus.ts) played through the real loop with a scripted model: a good turn reads the
// retry review, proposes the retry (or explains why not) and passes every check; answering without reading must not; and each check that
// guards a figure or a promise has been seen to fail on a good turn made one thing worse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { REINTENTO_CORPUS, RETRY_CAMPAIGN_ID } from './fixtures/cowork-reintento-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const readReview = () => coworkDecisionSchema.parse({ action: 'campaigns.retry_review', query: null, leadId: null, campaignId: RETRY_CAMPAIGN_ID, answer: null });
const list = () => coworkDecisionSchema.parse({ action: 'campaigns.list', query: null, leadId: null, answer: null });
const retry = (reply: string) => coworkDecisionSchema.parse({ action: 'campaign.retry', query: null, leadId: null, campaignId: RETRY_CAMPAIGN_ID,
  answer: { reply, document: null, suggestions: null, question: null } });
const answer = (reply: string, question: string) => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply, document: null, suggestions: [{ label: 'Sí, hazlo', message: 'Sí, revisa los inciertos en Contactados' }], question } });

const EXPLAINED = 'Dejé listo el reintento de 3 envíos de la campaña (dos por la cuota diaria y uno porque el proveedor no respondió). No entran 2: uno es terminal (la casilla no existe) y uno es incierto (no se confirmó si salió) y hay que conciliarlo en Contactados antes de repetirlo. Si apruebas, vuelven a la cola y salen con los frenos de siempre.';
const IDEAL: Record<string, CorpusDecider> = {
  'reintento-envios': async context => context.observations.length === 0 ? list() : context.observations.length === 1 ? readReview() : retry(EXPLAINED),
  'reintento-nada-que-reintentar': async context => context.observations.length === 0 ? readReview()
    : answer('Hoy no hay nada que se pueda reintentar en esa campaña: de los 2 envíos con problema, uno es terminal (la casilla no existe) y el otro es incierto, así que hay que conciliarlo en Contactados antes de repetirlo; reintentar a ciegas podría enviarlo dos veces.', '¿Quieres que te diga cuál es el incierto para revisarlo en Contactados?'),
  'reintento-sin-flag': async context => context.observations.length === 0 ? readReview()
    : answer('Hay 3 envíos que se pueden reintentar (dos por la cuota diaria y uno porque el proveedor no respondió) y 2 que no: uno es terminal (la casilla no existe) y uno es incierto y hay que conciliarlo en Contactados. El reintento se hace desde la campaña en la app; desde aquí todavía no puedo dejarlo en la cola.', '¿Quieres que te diga cuál es el incierto para conciliarlo?'),
};

const entry = (id: string) => REINTENTO_CORPUS.find(item => item.id === id)!;
const failing = async (id: string, decide: CorpusDecider) =>
  (await runCorpusCase(entry(id), decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the retry bank has one ideal turn for each case', () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), REINTENTO_CORPUS.map(item => item.id).sort());
});

for (const item of REINTENTO_CORPUS) {
  test(`${item.id}: a good turn passes every check`, async () => {
    const outcome = await runCorpusCase(item, IDEAL[item.id]);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  });

  test(`${item.id}: answering without reading fails at least two checks`, async () => {
    const naive: CorpusDecider = async () => answer('Listo, ya los reintenté todos y salen hoy.', '¿Algo más?');
    const missed = await failing(item.id, naive);
    assert.ok(missed.length >= 2, `only failed: ${missed.join(' | ') || 'nothing'}`);
    assert.ok(missed.includes('lee la revisión de reintentos de la campaña') || missed.includes('lee la revisión de reintentos'));
  });
}

test('the world is the shape the app returns: the review counts what is retryable, terminal and to reconcile', () => {
  const world = entry('reintento-envios').world!.read('campaigns.retry_review', '') as { campaignId: string; summary: Record<string, number>; items: unknown[] };
  assert.equal(world.campaignId, RETRY_CAMPAIGN_ID);
  assert.deepEqual(world.summary, { retryable: 3, terminal: 1, reconcileFirst: 1 });
  assert.equal(world.items.length, 5);
});

test('with the flag off the proposal is refused with the way out, never staged', async () => {
  const proposing: CorpusDecider = async context => context.observations.length === 0 ? readReview() : retry(EXPLAINED);
  const outcome = await runCorpusCase(entry('reintento-sin-flag'), proposing);
  assert.equal(outcome.result.proposal, null);
});

const swap = (from: string, to: string) => (text: string) => { assert.ok(text.includes(from), `the good turn no longer says: ${from}`); return text.replace(from, to); };
const degrade = (decide: CorpusDecider, change: (text: string) => string): CorpusDecider => async (context, meta) => {
  const decision = await decide(context, meta);
  if (!decision.answer) return decision;
  return coworkDecisionSchema.parse({ ...decision, answer: { ...decision.answer, reply: change(decision.answer.reply) } });
};
const MUTATIONS: Array<{ id: string; what: string; change: (text: string) => string; notices: string }> = [
  { id: 'reintento-envios', what: 'promises they leave today', notices: 'no promete que salen hoy ni ya', change: swap('Si apruebas, vuelven a la cola y salen con los frenos de siempre.', 'Si apruebas, salen hoy.') },
  { id: 'reintento-envios', what: 'invents a count', notices: 'no trae cifras que la revisión no da', change: swap('uno es terminal', '12 son terminales') },
  { id: 'reintento-envios', what: 'forgets what does not go in', notices: 'dice aparte que lo terminal y lo incierto no entran', change: swap(' No entran 2: uno es terminal (la casilla no existe) y uno es incierto (no se confirmó si salió) y hay que conciliarlo en Contactados antes de repetirlo.', '') },
  { id: 'reintento-sin-flag', what: 'says it already retried', notices: 'no promete que ya los reintentó', change: swap('desde aquí todavía no puedo dejarlo en la cola.', 'ya los reintenté y dejé todo en la cola.') },
  { id: 'reintento-nada-que-reintentar', what: 'does not say there is nothing to retry', notices: 'dice que no hay nada que se pueda reintentar', change: swap('Hoy no hay nada que se pueda reintentar en esa campaña: de los', 'Revisé la campaña: de los') },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: a good turn that ${mutation.what} is caught by «${mutation.notices}»`, async () => {
    const missed = await failing(mutation.id, degrade(IDEAL[mutation.id], mutation.change));
    assert.ok(missed.includes(mutation.notices), `the check did not notice; failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

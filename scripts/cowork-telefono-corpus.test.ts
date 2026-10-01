// Revealing a phone (scripts/fixtures/cowork-telefono-corpus.ts) played through the real loop with a scripted model: a good turn finds the person,
// proposes the one reveal (or explains why not) and passes every check; answering without looking must not; and each check that guards the cost,
// the invented number or the batch has been seen to fail on a good turn made one thing worse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkDecisionSchema } from '../src/lib/cowork/agent-loop';
import { PHONE_LEADS, TELEFONO_CORPUS } from './fixtures/cowork-telefono-corpus';
import { runCorpusCase, type CorpusDecider } from './fixtures/cowork-conversation-runner';

const search = (query: string) => coworkDecisionSchema.parse({ action: 'leads.search', query, leadId: null, answer: null });
const phone = (leadId: string, reply: string) => coworkDecisionSchema.parse({ action: 'lead.enrich_phone', query: null, leadId, answer: { reply, document: null, suggestions: null, question: null } });
const answer = (reply: string, question: string) => coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null,
  answer: { reply, document: null, suggestions: [{ label: 'Pídele el correo', message: 'Busca el correo de Paula Ríos' }, { label: 'Escríbele por LinkedIn', message: 'Propón un mensaje de LinkedIn para Paula Ríos' }], question } });

const ONE = 'Propongo pedir el teléfono de Paula Ríos al proveedor: cuesta 10 créditos y se aprueba en la tarjeta. Llega en unos minutos a tus contactos enriquecidos.';
const MANY = 'Hay tres personas en Transportes del Sur. Empiezo por Paula Ríos, la gerenta de personas: pedir su teléfono cuesta 10 créditos y se aprueba en su tarjeta. Los de Hugo Mena y Sara Lira cuestan 10 créditos cada uno y cada uno lleva su propia aprobación, de a uno.';
const NO = 'Todavía no puedo revelar teléfonos desde aquí. Paula Ríos tiene correo guardado y perfil de LinkedIn: puedo escribirle por cualquiera de los dos.';
const IDEAL: Record<string, CorpusDecider> = {
  'telefono-una-persona': async context => context.observations.length === 0 ? search('Paula Ríos') : phone(PHONE_LEADS.paula, ONE),
  'telefono-varias-personas': async context => context.observations.length === 0 ? search('Transportes del Sur') : phone(PHONE_LEADS.paula, MANY),
  'telefono-sin-flag': async context => context.observations.length === 0 ? search('Paula Ríos') : answer(NO, '¿Prefieres que le escriba por correo o por LinkedIn?'),
};

const entry = (id: string) => TELEFONO_CORPUS.find(item => item.id === id)!;
const failing = async (id: string, decide: CorpusDecider) =>
  (await runCorpusCase(entry(id), decide)).checks.filter(check => !check.passed).map(check => check.label);

test('the phone bank has one ideal turn for each case', () => {
  assert.deepEqual(Object.keys(IDEAL).sort(), TELEFONO_CORPUS.map(item => item.id).sort());
});

for (const item of TELEFONO_CORPUS) {
  test(`${item.id}: a good turn passes every check`, async () => {
    const outcome = await runCorpusCase(item, IDEAL[item.id]);
    const missed = outcome.checks.filter(check => !check.passed).map(check => check.label);
    assert.deepEqual(missed, [], `${missed.join(' | ')} · ${outcome.result.failed || outcome.result.reply}`);
  });

  test(`${item.id}: answering without looking fails at least two checks`, async () => {
    const naive: CorpusDecider = async () => answer('Su teléfono es +56 9 8765 4321.', '¿Algo más?');
    const missed = await failing(item.id, naive);
    assert.ok(missed.length >= 2, `only failed: ${missed.join(' | ') || 'nothing'}`);
    assert.ok(missed.includes('no escribe ningún número de teléfono'));
  });
}

test('with the flag off the proposal is refused with the way out, never staged', async () => {
  const proposing: CorpusDecider = async context => context.observations.length === 0 ? search('Paula Ríos') : phone(PHONE_LEADS.paula, ONE);
  const outcome = await runCorpusCase(entry('telefono-sin-flag'), proposing);
  assert.equal(outcome.result.proposal, null);
});

const swap = (from: string, to: string) => (text: string) => { assert.ok(text.includes(from), `the good turn no longer says: ${from}`); return text.replace(from, to); };
const degrade = (decide: CorpusDecider, change: (text: string) => string): CorpusDecider => async (context, meta) => {
  const decision = await decide(context, meta);
  if (!decision.answer) return decision;
  return coworkDecisionSchema.parse({ ...decision, answer: { ...decision.answer, reply: change(decision.answer.reply) } });
};
const MUTATIONS: Array<{ id: string; what: string; change: (text: string) => string; notices: string }> = [
  { id: 'telefono-una-persona', what: 'forgets the cost', notices: 'dice que cuesta 10 créditos', change: swap('cuesta 10 créditos y se aprueba en la tarjeta', 'se aprueba en la tarjeta') },
  { id: 'telefono-una-persona', what: 'writes a number', notices: 'no escribe ningún número de teléfono', change: swap('Llega en unos minutos', 'Es el +56 9 8765 4321. Llega en unos minutos') },
  { id: 'telefono-una-persona', what: 'says it already has it', notices: 'no promete que ya lo tiene ni que habrá uno', change: swap('Propongo pedir el teléfono', 'Ya tengo su teléfono; propongo pedir el teléfono') },
  { id: 'telefono-varias-personas', what: 'adds up a total nobody asked for', notices: 'no suma un total que no pidió', change: text => `${text} En total son 30 créditos.` },
  { id: 'telefono-varias-personas', what: 'does not say each one needs its own approval', notices: 'dice que cada una lleva su propia aprobación', change: swap(' y cada uno lleva su propia aprobación, de a uno', '') },
  { id: 'telefono-sin-flag', what: 'gives a number anyway', notices: 'no escribe ningún número de teléfono', change: text => `${text} Su celular es 987654321.` },
];
for (const mutation of MUTATIONS) {
  test(`${mutation.id}: a good turn that ${mutation.what} is caught by «${mutation.notices}»`, async () => {
    const missed = await failing(mutation.id, degrade(IDEAL[mutation.id], mutation.change));
    assert.ok(missed.includes(mutation.notices), `the check did not notice; failed: ${missed.join(' | ') || 'nothing'}`);
  });
}

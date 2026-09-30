import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkCorrectionVerdict, coworkFigures } from './correction-guard';

test('the figures a person could check: percentages, decimals and numbers from 10, as written', () => {
  assert.deepEqual(coworkFigures('Tienes 4 contactos, 12 envíos y 1.618 sin cargo; abrió el 33 % y respondió el 1,2 %.'), ['12', '1618', '33', '1.2']);
  // Years and small counts are left out: they rarely carry an invented fact.
  assert.deepEqual(coworkFigures('En 2026 le escribiste a 3 personas.'), []);
  assert.deepEqual(coworkFigures('Sin cifras.'), []);
  // The same figure written two ways is one.
  assert.deepEqual(coworkFigures('1.000 contactos, es decir 1000.'), ['1000']);
});

test('a correction is kept only when it is one: not empty, not the same answer, no figures without support', () => {
  const first = { reply: 'Tienes 4 contactos de RR. HH. ¿Quieres que revise a quiénes ya les escribiste?', question: null };
  const evidence = [{ action: 'contacted.search', result: { sent: 12, opened: 5 } }];
  // It did what was asked, with figures from the data.
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: 'Tienes 4 contactos de RR. HH.; ya les escribiste 12 correos y 5 se abrieron.' }, evidence),
    { keep: 'correction', reason: 'improved' });
  // Empty, or the same words again (spacing, case and punctuation do not count): the first stands.
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: '  ' }, evidence), { keep: 'first', reason: 'empty' });
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: 'tienes 4 contactos de RR HH ¿Quieres que revise a quiénes ya les escribiste' }, evidence),
    { keep: 'first', reason: 'unchanged' });
  // A figure that is neither in the first answer nor in what Cowork consulted: the first stands, and says why.
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: 'Tienes 4 contactos; 37 % abrió tus correos.' }, evidence),
    { keep: 'first', reason: 'new_figures', figures: ['37'] });
  // Figures from the person's own profile or the history are supported too.
  const profile = { proofPoints: ['Reduce 70 % el tiempo de verificación'] };
  assert.equal(coworkCorrectionVerdict(first, { reply: 'AXIS reduce 70 % el tiempo de verificación.' }, [evidence, [], profile]).keep, 'correction');
  // Cards count: a card-only correction is not empty, and figures inside cards are checked.
  const card = { type: 'metrics' as const, title: 'Envíos', period: null, items: [{ label: 'Abiertos', value: '55', detail: null }] };
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: '', blocks: [card] }, evidence), { keep: 'first', reason: 'new_figures', figures: ['55'] });
  assert.equal(coworkCorrectionVerdict(first, { reply: '', blocks: [{ ...card, items: [{ label: 'Abiertos', value: '12', detail: null }] }] }, evidence).keep, 'correction');
});

test('a local hour the coordinator read next to its UTC time is supported by the data', () => {
  const first = { reply: 'Ana respondió ayer.' };
  const evidence = [{ action: 'replies.attention', result: { items: [{ name: 'Ana', received_at: '2026-09-25T19:40:00Z' }] } }];
  // 19:40 UTC is 16:40 in Santiago: the coordinator read «16:40» beside it and may write it.
  assert.equal(coworkCorrectionVerdict(first, { reply: 'Ana respondió ayer a las 16:40.' }, evidence).keep, 'correction');
  // A time nobody read is still a figure without support.
  assert.deepEqual(coworkCorrectionVerdict(first, { reply: 'Ana respondió ayer a las 17:55.' }, evidence),
    { keep: 'first', reason: 'new_figures', figures: ['17', '55'] });
});

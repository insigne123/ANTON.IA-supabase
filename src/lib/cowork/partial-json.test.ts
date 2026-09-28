import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkLiveDraft, coworkParsePartialJson, coworkRepairJson } from './partial-json';

test('a JSON prefix closes into something that parses, whatever the cut', () => {
  const full = JSON.stringify({
    action: 'answer', query: null, leadId: null,
    answer: { reply: 'Hola Felipe,\n«AXIS» revisa \\ antecedentes 😀 al 100%', document: null, question: '¿Creo la campaña?', blocks: [
      { type: 'sequence', title: 'Secuencia', steps: [{ day: 1, subject: 'Hola', body: 'Uno' }, { day: 4, subject: 'Seguimiento', body: 'Dos' }] },
    ], suggestions: [{ label: 'Sí', message: 'Sí, créala' }], ok: true, n: -12.5e3 },
  });
  // Every cut, including the middle of escapes, keys, literals and numbers, reads without throwing.
  for (let cut = 1; cut <= full.length; cut++) {
    const repaired = coworkRepairJson(full.slice(0, cut));
    if (repaired === null) continue;
    assert.doesNotThrow(() => JSON.parse(repaired), `cut ${cut}: ${full.slice(0, cut)}`);
  }
  assert.deepEqual(coworkParsePartialJson(full), JSON.parse(full));
});

test('half-written strings, keys, literals and numbers are dropped or closed', () => {
  assert.deepEqual(coworkParsePartialJson('{"action":"ans'), { action: 'ans' });
  assert.deepEqual(coworkParsePartialJson('{"action":"answer","ans'), { action: 'answer' });
  assert.deepEqual(coworkParsePartialJson('{"action":"answer","answer":'), { action: 'answer' });
  assert.deepEqual(coworkParsePartialJson('{"a":tru'), {});
  assert.deepEqual(coworkParsePartialJson('{"a":[1,2,'), { a: [1, 2] });
  assert.deepEqual(coworkParsePartialJson('{"a":-'), {});
  assert.deepEqual(coworkParsePartialJson('{"a":"x\\'), { a: 'x' });
  assert.deepEqual(coworkParsePartialJson('{"a":"x\\u00e'), { a: 'x' });
  assert.deepEqual(coworkParsePartialJson('{"a":"x\\u00e1'), { a: 'xá' });
  assert.equal(coworkParsePartialJson(''), null);
});

test('the live draft shows only an answer, with its text and how far each card got', () => {
  // A read or a proposal shows nothing, even while its fields stream.
  assert.equal(coworkLiveDraft('{"action":"leads.search","query":"RRHH'), null);
  assert.equal(coworkLiveDraft('{"action":"campaign.create","answer":null'), null);
  // Until the reply has text there is nothing to show.
  assert.equal(coworkLiveDraft('{"action":"answer","query":null,"answer":{"reply":"'), null);
  assert.deepEqual(coworkLiveDraft('{"action":"answer","query":null,"answer":{"reply":"Tus 3 contactos de RR. HH. tie'),
    { reply: 'Tus 3 contactos de RR. HH. tie', cards: [] });
  const writing = '{"action":"answer","answer":{"reply":"Listo.","document":null,"question":null,"blocks":[{"type":"sequence","title":"Secuencia AXIS","steps":[{"day":1,"subject":"Hola","body":"Uno"},{"day":4,"subj';
  assert.deepEqual(coworkLiveDraft(writing), { reply: 'Listo.', cards: [{ type: 'sequence', title: 'Secuencia AXIS', parts: 2 }] });
  const table = '{"action":"answer","answer":{"reply":"Te dejo la tabla.","blocks":[{"type":"table","title":"A quién","columns":["Contacto"],"rows":[["Felipe"],["Cam';
  assert.deepEqual(coworkLiveDraft(table)?.cards, [{ type: 'table', title: 'A quién', parts: 2 }]);
  // Unknown card types are not shown.
  assert.deepEqual(coworkLiveDraft('{"action":"answer","answer":{"reply":"x","blocks":[{"type":"chart","title":"y"}]}}')?.cards, []);
  // The text reads like the final answer: no internal codes, no IDs in parentheses.
  assert.equal(coworkLiveDraft('{"action":"answer","answer":{"reply":"Miré *last_30_days* y a Jose (c517a22f-d087-45ae-b450-045f2abc60e1) le fal')?.reply,
    'Miré últimos 30 días y a Jose le fal');
  assert.equal(coworkLiveDraft('{"action":"answer","answer":{"reply":" (c517a22f-d087-45ae-b450-045f2abc60e1)'), null);
});

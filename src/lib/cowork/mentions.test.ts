import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coworkComposerToken, coworkInsertMention, coworkMentionName, coworkMentionSegments, coworkMessageMentions, coworkTemplateBlank, coworkTemplates,
  coworkWithMentions,
} from './mentions';
import { coworkDisplayMessage } from './presentation';

const MARCELA = { id: '00000000-0000-4000-8000-000000000101', name: 'Marcela Rojas' };
const FELIPE = { id: '00000000-0000-4000-8000-000000000102', name: 'Felipe Muñoz' };

test('«@» opens after a space or at the start, and «/» only as the whole message so far', () => {
  assert.deepEqual(coworkComposerToken('@mar', 4), { kind: 'mention', start: 0, end: 4, query: 'mar' });
  assert.deepEqual(coworkComposerToken('escríbele a @Mar', 16), { kind: 'mention', start: 12, end: 16, query: 'Mar' });
  assert.deepEqual(coworkComposerToken('hola @', 6), { kind: 'mention', start: 5, end: 6, query: '' });
  // An email address is not a mention, and a space ends one.
  assert.equal(coworkComposerToken('mrojas@sodexo', 13), null);
  assert.equal(coworkComposerToken('@Marcela Rojas ', 15), null);
  // Only what is before the caret counts.
  assert.deepEqual(coworkComposerToken('hola @fe y más', 8), { kind: 'mention', start: 5, end: 8, query: 'fe' });
  assert.deepEqual(coworkComposerToken('/', 1), { kind: 'template', start: 0, end: 1, query: '' });
  assert.deepEqual(coworkComposerToken('/mej', 4), { kind: 'template', start: 0, end: 4, query: 'mej' });
  assert.equal(coworkComposerToken('/mej algo', 9), null);
  assert.equal(coworkComposerToken('hola /mej', 9), null);
  assert.equal(coworkComposerToken('/mej', 2 /* text after the caret */), null);
});

test('picking a contact writes its name in place of what was typed and leaves the caret after it', () => {
  const token = coworkComposerToken('escríbele a @mar por linkedin', 16)!;
  assert.deepEqual(coworkInsertMention('escríbele a @mar por linkedin', token, 'Marcela Rojas'),
    { text: 'escríbele a @Marcela Rojas por linkedin', caret: 27 });
  assert.equal(coworkMentionName(' Ana (RR. HH.): Pérez\n'), 'Ana RR. HH. Pérez');
});

test('the message carries one reference per mentioned person still in the text, and reads them back', () => {
  const text = 'escríbele a @Marcela Rojas y a @Felipe Muñoz';
  const sent = coworkWithMentions(text, [MARCELA, FELIPE, MARCELA, { id: '00000000-0000-4000-8000-000000000103', name: 'Andrea Vega' }]);
  assert.equal(sent, `${text}\n\n(ID de Marcela Rojas: ${MARCELA.id})\n(ID de Felipe Muñoz: ${FELIPE.id})`);
  // Sending twice adds nothing, and a mention deleted from the text travels no more.
  assert.equal(coworkWithMentions(sent, [MARCELA, FELIPE]), sent);
  assert.equal(coworkWithMentions('escríbele a Marcela', [MARCELA]), 'escríbele a Marcela');
  const editedName = 'escríbele a @Marcela RojasX';
  assert.equal(coworkWithMentions(editedName, [MARCELA]), editedName, 'a partial name cannot silently carry another person’s ID');
  assert.deepEqual(coworkMentionSegments(editedName, [MARCELA]), [{ text: editedName, mention: null }]);
  assert.equal(coworkWithMentions('mrojas@Marcela Rojas', [MARCELA]), 'mrojas@Marcela Rojas');
  const punctuated = 'escríbele a @Marcela Rojas, por favor';
  assert.equal(coworkWithMentions(punctuated, [MARCELA]), `${punctuated}\n\n(ID de Marcela Rojas: ${MARCELA.id})`);
  assert.deepEqual(coworkMessageMentions(sent), [MARCELA, FELIPE]);
  // The bubble shows the text without the references, with each mention apart.
  const shown = coworkDisplayMessage(sent);
  assert.equal(shown, text);
  assert.deepEqual(coworkMentionSegments(shown, coworkMessageMentions(sent)).map(segment => [segment.text, segment.mention?.name ?? null]), [
    ['escríbele a ', null], ['@Marcela Rojas', 'Marcela Rojas'], [' y a ', null], ['@Felipe Muñoz', 'Felipe Muñoz'],
  ]);
});

test('«/» lists the home templates, narrowed by name without accents, and a template\'s blank is selected', () => {
  assert.equal(coworkTemplates('').length, 6);
  assert.deepEqual(coworkTemplates('mej').map(starter => starter.id), ['mejorar']);
  assert.deepEqual(coworkTemplates('como').map(starter => starter.id), ['como-voy']);
  assert.deepEqual(coworkTemplates('zzz'), []);
  const improve = coworkTemplates('mejorar')[0].prompt;
  const blank = coworkTemplateBlank(improve)!;
  assert.equal(improve.slice(blank.start, blank.end), '[pega aquí tu correo]');
  assert.equal(coworkTemplateBlank('Sin espacios por completar.'), null);
});

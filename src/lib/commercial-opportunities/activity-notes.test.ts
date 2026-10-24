import assert from 'node:assert/strict';
import test from 'node:test';
import { insertMention, isEditableNote, mentionAt, mentionedPeople, mentionMatches, mentionParts } from './activity-notes';

const PEOPLE = [
  { user_id: 'diego', name: 'Diego Fuentes' }, { user_id: 'diego2', name: 'Diego Araya' }, { user_id: 'maria', name: 'María José Pérez' },
  { user_id: 'ana', name: 'Ana' }, { user_id: 'ana-maria', name: 'Ana María Soto' },
];

test('the box suggests names while one is typed after «@», but not inside an e-mail, across lines or after two spaces', () => {
  assert.deepEqual(mentionAt('Hola @die', 9), { start: 5, query: 'die' });
  assert.deepEqual(mentionAt('@', 1), { start: 0, query: '' });
  assert.deepEqual(mentionAt('Hola @Diego F', 13), { start: 5, query: 'Diego F' }, 'a full name has a space');
  assert.equal(mentionAt('escribe a diego@empresa.cl', 26), null);
  assert.equal(mentionAt('Hola @die\nmañana', 16), null);
  assert.equal(mentionAt('Hola @diego  ya', 15), null);
  assert.equal(mentionAt('Hola @ die', 10), null);
});

test('who matches: the start of the name or of any of its words, without minding accents', () => {
  assert.deepEqual(mentionMatches(PEOPLE, 'die').map(person => person.user_id), ['diego', 'diego2']);
  assert.deepEqual(mentionMatches(PEOPLE, 'perez').map(person => person.user_id), ['maria']);
  assert.deepEqual(mentionMatches(PEOPLE, 'Mari').map(person => person.user_id), ['maria', 'ana-maria']);
  assert.equal(mentionMatches(PEOPLE, '').length, 5);
  assert.equal(mentionMatches(PEOPLE, 'zz').length, 0);
  assert.deepEqual(mentionMatches(PEOPLE, 'Diego Fuentes '), [], 'a whole name and a space: the mention is made');
  assert.deepEqual(mentionMatches(PEOPLE, 'Ana ').map(person => person.user_id), [], '«Ana» is someone');
  assert.deepEqual(mentionMatches(PEOPLE, 'Ana M').map(person => person.user_id), ['ana-maria'], 'and going on finds «Ana María Soto»');
});

test('the chosen name goes in whole, followed by a space to go on writing, and the caret after it', () => {
  assert.deepEqual(insertMention('@ma', { start: 0, query: 'ma' }, 'María José Pérez'), { text: '@María José Pérez ', caret: 18 });
  assert.deepEqual(insertMention('Hola @die, revisa', { start: 5, query: 'die' }, 'Diego Fuentes'), { text: 'Hola @Diego Fuentes, revisa', caret: 19 }, 'a comma follows the name');
  assert.deepEqual(insertMention('Hola @die mañana', { start: 5, query: 'die' }, 'Diego Fuentes'), { text: 'Hola @Diego Fuentes mañana', caret: 20 }, 'the space already there is kept');
});

test('a note names people by their whole name after «@», the longest first, each once, however it is accented', () => {
  const text = '@Diego Fuentes y @ana maría soto: revisen. Ojo @Ana, y @Diego Fuentes otra vez; diego@empresa.cl no cuenta; @Diegote tampoco.';
  assert.deepEqual(mentionedPeople(text, PEOPLE), ['diego', 'ana-maria', 'ana']);
  assert.deepEqual(mentionParts('Hola @María José Pérez, mira.', PEOPLE), [{ text: 'Hola ' }, { text: '@María José Pérez', userId: 'maria' }, { text: ', mira.' }]);
  assert.deepEqual(mentionParts('Sin menciones.', PEOPLE), [{ text: 'Sin menciones.' }]);
  assert.deepEqual(mentionParts('', PEOPLE), []);
});

test('a person edits and deletes only their own notes, never what the app or a decision wrote', () => {
  assert.equal(isEditableNote({ kind: 'note', actor_id: 'diego' }, 'diego'), true);
  assert.equal(isEditableNote({ kind: 'progress', actor_id: 'diego' }, 'diego'), true);
  assert.equal(isEditableNote({ kind: 'note', actor_id: 'maria' }, 'diego'), false);
  assert.equal(isEditableNote({ kind: 'decision', actor_id: 'diego' }, 'diego'), false);
  assert.equal(isEditableNote({ kind: 'note', actor_id: null }, null), false);
});

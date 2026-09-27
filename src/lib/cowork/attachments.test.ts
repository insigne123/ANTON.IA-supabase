import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkMessageAttachments, coworkWithAttachments } from './attachments';

test('attached files travel as the last lines of the message and come back apart', () => {
  const message = coworkWithAttachments('  ¿A quién le escribo primero?  ', ['asistentes-feria.csv', 'notas, feria.md', 'asistentes-feria.csv']);
  assert.equal(message, '¿A quién le escribo primero?\n\nAdjuntos:\n- asistentes-feria.csv\n- notas, feria.md');
  assert.deepEqual(coworkMessageAttachments(message), { text: '¿A quién le escribo primero?', files: ['asistentes-feria.csv', 'notas, feria.md'] });
});

test('a message with files only, or with none', () => {
  const only = coworkWithAttachments('', ['prospectos.xlsx']);
  assert.equal(only, 'Adjuntos:\n- prospectos.xlsx');
  assert.deepEqual(coworkMessageAttachments(only), { text: '', files: ['prospectos.xlsx'] });
  assert.equal(coworkWithAttachments('Hola', []), 'Hola');
  assert.deepEqual(coworkMessageAttachments('Hola'), { text: 'Hola', files: [] });
});

test('a list the person wrote in the middle of the text is not an attachment', () => {
  const text = 'Adjuntos:\n- uno\n\nY después te cuento más.';
  assert.deepEqual(coworkMessageAttachments(text), { text, files: [] });
});

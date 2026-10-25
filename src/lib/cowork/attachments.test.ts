import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkMessageAttachments, coworkPastedImages, coworkWithAttachments } from './attachments';

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

test('a pasted screenshot is attached with a name of its own; a paste with text stays text (COW-11)', async () => {
  const clipboard = (files: File[], text = '') => ({ files: files as unknown as FileList, getData: (type: string) => (type === 'text/plain' ? text : '') });
  const now = new Date(2026, 9, 25, 2, 15, 30);
  const shot = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
  const [pasted] = coworkPastedImages(clipboard([shot]), now);
  assert.equal(pasted.name, 'captura-20261025-021530.png');
  assert.equal(pasted.type, 'image/png');
  assert.equal(pasted.size, 3);
  // Two at once get a number each, so the second does not replace the first; a JPG keeps its kind.
  const photo = new File([new Uint8Array([4])], 'image.jpeg', { type: 'image/jpeg' });
  assert.deepEqual(coworkPastedImages(clipboard([shot, photo]), now).map(file => file.name), ['captura-20261025-021530-1.png', 'captura-20261025-021530-2.jpg']);
  // Cells copied from Excel bring a picture of themselves: that paste is the cells.
  assert.deepEqual(coworkPastedImages(clipboard([shot], 'Marcela\tSodexo'), now), []);
  // A GIF or a document copied from the file manager is not a screenshot; nothing pasted, nothing attached.
  assert.deepEqual(coworkPastedImages(clipboard([new File(['x'], 'a.gif', { type: 'image/gif' }), new File(['x'], 'a.pdf', { type: 'application/pdf' })]), now), []);
  assert.deepEqual(coworkPastedImages(null, now), []);
});

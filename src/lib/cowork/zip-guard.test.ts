import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDocx, makeXlsx, zipDirectory } from '@/lib/server/cowork/office-fixtures';
import { coworkZipGuard } from './zip-guard';

test('the Excel and Word files that are really written pass, and it says what they hold', async () => {
  const xlsx = coworkZipGuard(makeXlsx({ Prospectos: [['Nombre'], ['Ana']] }));
  assert.equal(xlsx.ok, true);
  const docx = coworkZipGuard(await makeDocx(['Hola']));
  assert.equal(docx.ok, true);
  if (xlsx.ok) assert.ok(xlsx.entries >= 3 && xlsx.expandedBytes > 0 && xlsx.xmlBytes > 0 && xlsx.xmlBytes <= xlsx.expandedBytes);
});

test('it says how much of what a file expands to is XML, apart from images and the rest', () => {
  const verdict = coworkZipGuard(zipDirectory([{ name: 'word/document.xml', size: 3_000 }, { name: 'word/media/foto.png', size: 40_000 }, { name: 'WORD/STYLES.XML', size: 2_000 }, { name: '[Content_Types].xml', size: 500 }], { padding: 1_000 }));
  assert.deepEqual(verdict, { ok: true, entries: 4, expandedBytes: 45_500, xmlBytes: 5_500 });
});

test('a file that is not a ZIP, or is cut short, is refused', () => {
  assert.deepEqual(coworkZipGuard(new TextEncoder().encode('Nombre;Correo\nAna;a@b.cl')), { ok: false, reason: 'No es un archivo ZIP válido.' });
  assert.deepEqual(coworkZipGuard(new Uint8Array(0)), { ok: false, reason: 'No es un archivo ZIP válido.' });
  const whole = zipDirectory([{ name: 'a.xml', size: 10 }, { name: 'b.xml', size: 10 }]);
  // The end record is there but the directory before it is not what it declares.
  const cut = new Uint8Array([...whole.slice(20)]);
  assert.equal(coworkZipGuard(cut).ok, false);
});

test('a file that would expand far beyond its size, or holds too many parts, is refused', () => {
  const small = zipDirectory([{ name: 'a.xml', size: 4_000 }]);
  assert.equal(coworkZipGuard(small).ok, true);
  // Declares 200 MB inside a few dozen bytes.
  assert.deepEqual(coworkZipGuard(zipDirectory([{ name: 'bomba.xml', size: 200 * 1024 * 1024 }])), { ok: false, reason: 'El archivo es demasiado grande al abrirlo.', large: true });
  // Under the total but far past what its own size explains (a ratio over 200).
  assert.deepEqual(coworkZipGuard(zipDirectory([{ name: 'a.xml', size: 20_000 }])), { ok: false, reason: 'El archivo es demasiado grande al abrirlo.', large: true });
  const many = zipDirectory(Array.from({ length: 30 }, (_, index) => ({ name: `p${index}.xml`, size: 10 })));
  assert.deepEqual(coworkZipGuard(many, { entries: 20, expandedBytes: 1_000_000, ratio: 1_000 }), { ok: false, reason: 'El archivo tiene demasiadas partes.', large: true });
  assert.equal(coworkZipGuard(many, { entries: 30, expandedBytes: 1_000_000, ratio: 1_000 }).ok, true);
});

test('a ZIP64 file is refused instead of read wrongly', () => {
  assert.deepEqual(coworkZipGuard(zipDirectory([{ name: 'a.xml', size: 10 }], { zip64: true })), { ok: false, reason: 'El archivo usa un formato ZIP que no se abre.', large: true });
});

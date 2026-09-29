import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_FILE_READ_LIMITS, coworkDecodeFile, coworkFileKind, coworkFileMissing, coworkFilePreview, coworkFilesByWords, coworkHeaderRow, coworkRowText } from './file-read';

test('a CSV keeps its columns and rows, with the delimiter detected and blank lines dropped', () => {
  const csv = '﻿Nombre;Empresa;Correo\n"Rojas, Marcela";Sodexo;mrojas@sodexo.cl\n\n;;\nFelipe Muñoz;Securitas;\n';
  const preview = coworkFilePreview('Leads-Feria.CSV', csv.replace(/^﻿/, ''));
  assert.deepEqual(preview, { kind: 'table', columns: ['Nombre', 'Empresa', 'Correo'],
    rows: [['Rojas, Marcela', 'Sodexo', 'mrojas@sodexo.cl'], ['Felipe Muñoz', 'Securitas', '']], totalRows: 2, returnedRows: 2, truncated: false,
    filledByColumn: { Nombre: 2, Empresa: 2, Correo: 1 } });
});

test('headers are named and unique, and long cells are clipped', () => {
  const preview = coworkFilePreview('a.csv', `Nombre,,Nombre\nAna,x,${'y'.repeat(500)}`);
  assert.equal(preview?.kind, 'table');
  if (preview?.kind !== 'table') return;
  assert.deepEqual(preview.columns, ['Nombre', 'Columna 2', 'Nombre (2)']);
  assert.equal(preview.rows[0][2].length, COWORK_FILE_READ_LIMITS.cellChars);
  assert.ok(preview.rows[0][2].endsWith('…'));
});

test('a long or wide file keeps fewer rows and says it was cut', () => {
  const rows = Array.from({ length: 300 }, (_, index) => `Persona ${index},Empresa ${index},${'dato '.repeat(30)}`);
  const preview = coworkFilePreview('muchos.csv', ['Nombre,Empresa,Nota', ...rows].join('\n'));
  assert.equal(preview?.kind, 'table');
  if (preview?.kind !== 'table') return;
  assert.equal(preview.totalRows, 300);
  assert.ok(preview.returnedRows <= COWORK_FILE_READ_LIMITS.rows);
  assert.equal(preview.truncated, true);
  assert.ok(JSON.stringify(preview.rows).length <= COWORK_FILE_READ_LIMITS.chars);
  // The counts cover the whole file, not only the rows shown.
  assert.deepEqual(preview.filledByColumn, { Nombre: 300, Empresa: 300, Nota: 300 });
});

test('a JSON list reads as a table; anything else as text', () => {
  const list = coworkFilePreview('contactos.json', JSON.stringify([{ nombre: 'Ana', empresa: 'Adecco' }, { nombre: 'Luis', cargo: 'Gerente' }]));
  assert.deepEqual(list, { kind: 'table', columns: ['nombre', 'empresa', 'cargo'],
    rows: [['Ana', 'Adecco', ''], ['Luis', '', 'Gerente']], totalRows: 2, returnedRows: 2, truncated: false,
    filledByColumn: { nombre: 2, empresa: 1, cargo: 1 } });
  assert.equal(coworkFilePreview('config.json', '{"a": 1}')?.kind, 'text');
  assert.equal(coworkFilePreview('roto.json', '{no es json')?.kind, 'text');
});

test('text is kept up to its limit, and the formats opened on the server are not read here', () => {
  const long = coworkFilePreview('brief.md', `# Brief\n\n\n\n${'palabra '.repeat(3000)}`);
  assert.equal(long?.kind, 'text');
  if (long?.kind !== 'text') return;
  assert.equal(long.truncated, true);
  assert.ok(long.text.startsWith('# Brief\n\npalabra'));
  assert.ok(long.text.length <= COWORK_FILE_READ_LIMITS.textChars + 1);
  assert.equal(coworkFileKind('prospectos.xlsx'), 'excel');
  assert.equal(coworkFileKind('Brief.PDF'), 'pdf');
  assert.equal(coworkFileKind('propuesta.docx'), 'docx');
  assert.equal(coworkFileKind('foto.png'), 'other');
  // Excel, PDF and Word are opened on the server (file-binary.ts), not from text.
  for (const name of ['prospectos.xlsx', 'brief.pdf', 'propuesta.docx']) assert.equal(coworkFilePreview(name, 'PK...'), null);
  assert.equal(coworkFilePreview('foto.png', 'x'), null);
});

test('a file exported from Excel in Windows-1252 decodes with its accents', () => {
  // «Campaña» in Windows-1252: ñ is a single byte (0xF1), invalid in UTF-8.
  const bytes = Uint8Array.from([0x43, 0x61, 0x6d, 0x70, 0x61, 0xf1, 0x61]);
  assert.equal(coworkDecodeFile(bytes), 'Campaña');
  assert.equal(coworkDecodeFile(new TextEncoder().encode('﻿Área')), 'Área');
});

test('words the person used find the upload they mean', () => {
  const names = ['asistentes-feria-rrhh.csv', 'prospectos.xlsx', 'feria-2025.csv'];
  assert.deepEqual(coworkFilesByWords('la de rrhh', names), ['asistentes-feria-rrhh.csv']);
  assert.deepEqual(coworkFilesByWords('la lista de la feria de rrhh', names), ['asistentes-feria-rrhh.csv']);
  assert.deepEqual(coworkFilesByWords('la lista', names), []);
  assert.deepEqual(coworkFilesByWords('feria rrhh', names), ['asistentes-feria-rrhh.csv']);
  assert.deepEqual(coworkFilesByWords('Feria', names), ['asistentes-feria-rrhh.csv', 'feria-2025.csv']);
  assert.deepEqual(coworkFilesByWords('prospectos.xlsx', names), ['prospectos.xlsx']);
  assert.deepEqual(coworkFilesByWords('asistentes', names), ['asistentes-feria-rrhh.csv']);
  assert.deepEqual(coworkFilesByWords('   ', names), []);
});

test('a missing file asks for the upload; several matches ask which one', () => {
  const missing = coworkFileMissing('clientes.csv', Array.from({ length: 30 }, (_, index) => `f${index}.csv`), []);
  assert.equal(missing.available.length, 20);
  assert.equal('candidates' in missing, false);
  assert.match(missing.nextStep, /pide que lo suba con el clip «Adjuntar archivos»/);
  const several = coworkFileMissing('feria', ['a-feria.csv', 'feria-2.csv'], ['a-feria.csv', 'feria-2.csv']);
  assert.deepEqual('candidates' in several && several.candidates, ['a-feria.csv', 'feria-2.csv']);
  assert.match(several.nextStep, /pregunta cuál es/);
});

test('the header is the first row, unless a title or a note stands above a wider table', () => {
  const header = ['Nombre', 'Empresa', 'Correo', 'Cargo'];
  const person = ['Ana', 'Entel', 'a@entel.cl', 'Gerente'];
  // A table that starts with its columns, and one so narrow that nothing can be told apart.
  assert.equal(coworkHeaderRow([header, person]), 0);
  assert.equal(coworkHeaderRow([['Lista de correos', ''], ['a@b.cl', 'x'], ['c@d.cl', 'y']]), 0);
  // One or two rows with a single cell, then the columns.
  assert.equal(coworkHeaderRow([['Resumen de septiembre'], header, person]), 1);
  assert.equal(coworkHeaderRow([['Reporte'], ['Septiembre 2026'], header, person]), 2);
  assert.equal(coworkHeaderRow([['Fuente:', 'CRM'], ['', '', '', '', '', ''].map((_, index) => `Col${index}`), ['a', 'b', 'c', 'd', 'e', 'f']]), 1);
  // A header with only a few of its columns named is still the header: the rows below it are wider.
  assert.equal(coworkHeaderRow([['Nombre', 'Correo', 'Empresa', '', '', '', '', '', '', ''], ['Ana', 'a@b.cl', 'Entel', 1, 2, 3, 4, 5, 6, 7]]), 0);
  // Never more than three rows above, and never the last row.
  assert.equal(coworkHeaderRow([['a'], ['b'], ['c'], ['d'], header, person]), 3);
  assert.equal(coworkHeaderRow([['Solo un título']]), 0);
  assert.equal(coworkHeaderRow([]), 0);
});

test('a row of a sheet reads as one line of its filled cells', () => {
  assert.equal(coworkRowText(['Fuente:', '', 'CRM', null, 4]), 'Fuente: · CRM · 4');
  assert.equal(coworkRowText(['', '  ']), '');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_FILE_READ_LIMITS, coworkDecodeFile, coworkFileKind, coworkFileMissing, coworkFilePreview, coworkFilesByWords } from './file-read';

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

test('text is kept up to its limit, and Excel is not read yet', () => {
  const long = coworkFilePreview('brief.md', `# Brief\n\n\n\n${'palabra '.repeat(3000)}`);
  assert.equal(long?.kind, 'text');
  if (long?.kind !== 'text') return;
  assert.equal(long.truncated, true);
  assert.ok(long.text.startsWith('# Brief\n\npalabra'));
  assert.ok(long.text.length <= COWORK_FILE_READ_LIMITS.textChars + 1);
  assert.equal(coworkFileKind('prospectos.xlsx'), 'excel');
  assert.equal(coworkFilePreview('prospectos.xlsx', 'PK...'), null);
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

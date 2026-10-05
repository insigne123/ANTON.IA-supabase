import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { guessMapping, rowsFromMapping } from './csv-import-utils';
import { SpreadsheetError, isExcelFile, isOldExcelFile, readSpreadsheet } from './spreadsheet-import';

/** An .xlsx in memory, one array of rows per sheet. */
function workbook(sheets: Record<string, unknown[][]>) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

test('an Excel list reads like a CSV: headers from the first row with data, trimmed cells, empty rows skipped', () => {
  const bytes = workbook({
    Contactos: [
      [],
      ['Nombre', 'Correo electrónico', 'Empresa', 'Cargo', 'Teléfono'],
      ['  Ana   Pérez ', 'ANA.PEREZ@empresa.cl', 'Empresa SpA', 'Gerenta de Personas', 56912345678],
      ['', '', '', '', ''],
      ['Jorge Soto', '', 'Otra', 'Jefe de Operaciones', ''],
    ],
  });
  const [sheet, ...rest] = readSpreadsheet(bytes, { maxRows: 2000 });
  assert.equal(rest.length, 0);
  assert.equal(sheet.name, 'Contactos');
  assert.deepEqual(sheet.headers, ['Nombre', 'Correo electrónico', 'Empresa', 'Cargo', 'Teléfono']);
  assert.equal(sheet.total, 2);
  assert.deepEqual(sheet.rows[0], { Nombre: 'Ana Pérez', 'Correo electrónico': 'ANA.PEREZ@empresa.cl', Empresa: 'Empresa SpA', Cargo: 'Gerenta de Personas', 'Teléfono': '56912345678' });
  // The rest of the import is the CSV one: the columns are guessed the same way and the email is lower-cased.
  const contacts = rowsFromMapping(sheet.rows, guessMapping(sheet.headers));
  assert.equal(contacts[0].email, 'ana.perez@empresa.cl');
  assert.equal(contacts[0].phone, '56912345678');
  assert.equal(contacts[1].name, 'Jorge Soto');
});

test('every sheet with data is offered; empty sheets and repeated or blank headers do not lose columns', () => {
  const bytes = workbook({
    Portada: [['Lista de prospectos 2026']],
    Vacía: [],
    Clientes: [['Nombre', 'Nombre', ''], ['Luis', 'Luis Soto', 'nota']],
    Prospectos: [['name', 'email'], ['Ana', 'ana@x.cl'], ['Eva', 'eva@x.cl']],
  });
  const sheets = readSpreadsheet(bytes, { maxRows: 2000 });
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Clientes', 'Prospectos'], 'a title-only sheet and an empty one are left out');
  assert.deepEqual(sheets[0].headers, ['Nombre', 'Nombre (2)', 'Columna 3']);
  assert.equal(sheets[1].total, 2);
  const report = readSpreadsheet(workbook({ Reporte: [['Prospectos exportados del CRM'], [], ['Nombre', 'Correo'], ['Ana', 'ana@x.cl']] }), { maxRows: 10 });
  assert.deepEqual(report[0].headers, ['Nombre', 'Correo'], 'a title above the table is not taken as the headers');
});

test('a long sheet says it is too long, and a broken or empty file explains itself', () => {
  const rows = [['nombre', 'correo'], ...Array.from({ length: 30 }, (_, index) => [`Persona ${index}`, `p${index}@x.cl`])];
  const [sheet] = readSpreadsheet(workbook({ Lista: rows }), { maxRows: 10 });
  assert.equal(sheet.rows.length, 10, 'only what can be imported is kept');
  assert.ok(sheet.total > 10, 'but it knows there were more');
  assert.throws(() => readSpreadsheet(new Uint8Array([1, 2, 3, 4]), { maxRows: 10 }), (error: unknown) => error instanceof SpreadsheetError);
  assert.throws(() => readSpreadsheet(workbook({ Hoja1: [['solo encabezado']] }), { maxRows: 10 }), /no tiene filas con datos/);
  assert.equal(isExcelFile('Lista.XLSX'), true);
  assert.equal(isOldExcelFile('lista.xls'), true);
  assert.equal(isExcelFile('lista.csv'), false);
});

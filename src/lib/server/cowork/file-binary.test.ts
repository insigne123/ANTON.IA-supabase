import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_FILE_READ_LIMITS } from '@/lib/cowork/file-read';
import { COWORK_BINARY_LIMITS, coworkBinaryPreview } from './file-binary';
import { makeDocx, makePdf, makeXlsx, zipDirectory } from './office-fixtures';

const prospects = [
  ['Nombre', 'Empresa', 'Correo', 'Contactar el'],
  ['Paula Herrera', 'Entel', 'pherrera@entel.cl', new Date(Date.UTC(2026, 8, 25, 12))],
  ['Matías Contreras', 'LATAM', '', new Date(Date.UTC(2026, 8, 26, 12))],
  [],
  ['Ricardo Salinas', 'Codelco', 'rsalinas@codelco.cl', ''],
];

test('an Excel reads as a table: the first sheet with data, its columns, its rows without blanks, and what each column holds', async () => {
  const result = await coworkBinaryPreview('prospectos.xlsx', makeXlsx({ Vacía: [], Prospectos: prospects, Descartados: [['Nombre'], ['Ana'], ['Luis']] }));
  assert.ok(result && 'preview' in result);
  const preview = result.preview;
  assert.equal(preview.kind, 'table');
  if (preview.kind !== 'table') return;
  assert.equal(preview.sheet, 'Prospectos');
  assert.deepEqual(preview.columns, ['Nombre', 'Empresa', 'Correo', 'Contactar el']);
  assert.deepEqual(preview.rows, [
    ['Paula Herrera', 'Entel', 'pherrera@entel.cl', '2026-09-25'], ['Matías Contreras', 'LATAM', '', '2026-09-26'], ['Ricardo Salinas', 'Codelco', 'rsalinas@codelco.cl', '']]);
  assert.equal(preview.totalRows, 3);
  assert.deepEqual(preview.filledByColumn, { Nombre: 3, Empresa: 3, Correo: 2, 'Contactar el': 2 });
  // Every sheet is listed, with what it holds, so the other one can be asked for.
  assert.deepEqual(preview.sheets, [{ name: 'Vacía', rows: 0 }, { name: 'Prospectos', rows: 3 }, { name: 'Descartados', rows: 2 }]);
  assert.equal(preview.truncated, false);
  assert.equal(preview.capped, undefined);
});

test('another sheet is asked for by its name, in any case or by its start, and a wrong name keeps the first', async () => {
  const bytes = makeXlsx({ Prospectos: prospects, Descartados: [['Nombre', 'Motivo'], ['Ana', 'Sin correo'], ['Luis', 'Ya cliente']] });
  const sheetOf = async (asked: string) => {
    const result = await coworkBinaryPreview('prospectos.xlsx', bytes, { sheet: asked });
    return result && 'preview' in result && result.preview.kind === 'table' ? result.preview : null;
  };
  const byName = await sheetOf('descartados');
  assert.equal(byName?.sheet, 'Descartados');
  assert.deepEqual(byName?.rows, [['Ana', 'Sin correo'], ['Luis', 'Ya cliente']]);
  assert.equal((await sheetOf('desc'))?.sheet, 'Descartados');
  assert.equal((await sheetOf('Hoja inexistente'))?.sheet, 'Prospectos');
});

test('a wide or long sheet keeps to the limits of a CSV, and formulas give their value, never run', async () => {
  const rows: unknown[][] = [['Numero', 'Doble'], ...Array.from({ length: 300 }, (_, index) => [index + 1, { t: 'n', v: (index + 1) * 2, f: `A${index + 2}*2` }])];
  const result = await coworkBinaryPreview('numeros.xlsx', makeXlsx({ Hoja1: rows }));
  assert.ok(result && 'preview' in result && result.preview.kind === 'table');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'table' }>;
  assert.equal(preview.totalRows, 300);
  assert.equal(preview.returnedRows, COWORK_FILE_READ_LIMITS.rows);
  assert.equal(preview.truncated, true);
  assert.deepEqual(preview.rows[2], ['3', '6']);
});

test('dates read as year-month-day whatever the cell format, with the time only where the cell shows it, and an error shows its text', async () => {
  const day = (Date.UTC(2026, 3, 3) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const rows: unknown[][] = [['Formato', 'Valor'],
    ['día/mes/año', { t: 'n', v: day, z: 'dd/mm/yyyy' }],
    ['mes/día/año', { t: 'n', v: day, z: 'mm/dd/yyyy' }],
    ['con hora', { t: 'n', v: day + 9.5 / 24, z: 'dd/mm/yyyy hh:mm' }],
    ['hora que la celda no muestra', { t: 'n', v: day + 0.5, z: 'dd/mm/yyyy' }],
    ['solo hora', { t: 'n', v: 0.5, z: 'h:mm' }],
    ['duración', { t: 'n', v: 1.5, z: '[h]:mm' }],
    ['número', { t: 'n', v: 1250000, z: '#,##0' }],
    ['división por cero', { t: 'e', v: 7 }]];
  const result = await coworkBinaryPreview('formatos.xlsx', makeXlsx({ Hoja1: rows }));
  assert.ok(result && 'preview' in result && result.preview.kind === 'table');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'table' }>;
  assert.deepEqual(preview.rows.map(row => row[1]), ['2026-04-03', '2026-04-03', '2026-04-03 09:30', '2026-04-03', '12:00', '36:00', '1,250,000', '#DIV/0!']);
  assert.equal(preview.filledByColumn.Valor, 8, 'an error is a value the person can see, not an empty cell');
});

test('a title or a note above the header is kept apart, and the header is the row of columns', async () => {
  const oneTitle = await coworkBinaryPreview('resumen.xlsx', makeXlsx({ Resumen: [['Resumen de septiembre'], [], ['Etapa', 'Personas', 'Notas'], ['Nuevo', 4, 'Primera línea']] }));
  assert.ok(oneTitle && 'preview' in oneTitle && oneTitle.preview.kind === 'table');
  const single = oneTitle.preview as Extract<typeof oneTitle.preview, { kind: 'table' }>;
  assert.deepEqual(single.columns, ['Etapa', 'Personas', 'Notas']);
  assert.deepEqual(single.above, ['Resumen de septiembre']);
  assert.deepEqual(single.rows, [['Nuevo', '4', 'Primera línea']]);
  assert.equal(single.totalRows, 1);
  const two = await coworkBinaryPreview('reporte.xlsx', makeXlsx({ Reporte: [['Reporte de prospectos'], ['Septiembre 2026'], ['Nombre', 'Empresa', 'Correo', 'Cargo', 'Estado'], ['Ana', 'Entel', 'a@entel.cl', 'Gerente', 'Nuevo']] }));
  assert.ok(two && 'preview' in two && two.preview.kind === 'table');
  const double = two.preview as Extract<typeof two.preview, { kind: 'table' }>;
  assert.deepEqual(double.above, ['Reporte de prospectos', 'Septiembre 2026']);
  assert.deepEqual(double.columns, ['Nombre', 'Empresa', 'Correo', 'Cargo', 'Estado']);
  // A sheet that starts with its columns has nothing above.
  const plain = await coworkBinaryPreview('lista.xlsx', makeXlsx({ Lista: [['Nombre', 'Correo'], ['Ana', 'a@b.cl']] }));
  assert.ok(plain && 'preview' in plain && plain.preview.kind === 'table');
  assert.equal((plain.preview as Extract<typeof plain.preview, { kind: 'table' }>).above, undefined);
});

test('a sheet with more rows than are counted says so: its total is a floor', async () => {
  const rows: unknown[][] = [['Numero'], ...Array.from({ length: COWORK_BINARY_LIMITS.rows + 50 }, (_, index) => [index + 1])];
  const result = await coworkBinaryPreview('enorme.xlsx', makeXlsx({ Hoja1: rows }));
  assert.ok(result && 'preview' in result && result.preview.kind === 'table');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'table' }>;
  assert.equal(preview.capped, true);
  assert.equal(preview.totalRows, COWORK_BINARY_LIMITS.rows);
  assert.equal(preview.returnedRows, COWORK_FILE_READ_LIMITS.rows);
  assert.deepEqual(preview.sheets, [{ name: 'Hoja1', rows: COWORK_BINARY_LIMITS.rows }]);
});

test('a wide sheet keeps fewer rows, so the cells held at once stay within the limit', async () => {
  const rows: unknown[][] = [Array.from({ length: 20 }, (_, index) => `Columna ${index}`), ...Array.from({ length: 500 }, (_, row) => Array.from({ length: 20 }, (_, index) => row * 20 + index))];
  const bytes = makeXlsx({ Ancha: rows });
  // 500 rows of 20 columns fit in 20 000 cells (1 000 rows): all of them are read.
  const whole = await coworkBinaryPreview('ancha.xlsx', bytes, { cells: 20_000 });
  assert.ok(whole && 'preview' in whole && whole.preview.kind === 'table');
  assert.equal(whole.preview.totalRows, 500);
  assert.equal(whole.preview.capped, undefined);
  // With 4 000 cells they do not: 200 rows, and it says there are more.
  const cut = await coworkBinaryPreview('ancha.xlsx', bytes, { cells: 4_000 });
  assert.ok(cut && 'preview' in cut && cut.preview.kind === 'table');
  assert.equal(cut.preview.totalRows, 200);
  assert.equal(cut.preview.capped, true);
  assert.equal(cut.preview.columns.length, 20);
});

test('what is not a real Excel, or is an old .xls, is not opened, and a file that opens into far too much says it is too large', async () => {
  assert.deepEqual(await coworkBinaryPreview('roto.xlsx', new TextEncoder().encode('esto no es un excel')), { unreadable: 'damaged' });
  assert.deepEqual(await coworkBinaryPreview('bomba.xlsx', zipDirectory([{ name: 'xl/worksheets/sheet1.xml', size: 300 * 1024 * 1024 }])), { unreadable: 'large' });
  // Inside the limits of a ZIP, but more XML than an Excel is read from.
  assert.deepEqual(await coworkBinaryPreview('enorme.xlsx', zipDirectory([{ name: 'xl/worksheets/sheet1.xml', size: 70 * 1024 * 1024 }], { padding: 500_000 })), { unreadable: 'large' });
  assert.deepEqual(await coworkBinaryPreview('antiguo.xls', makeXlsx({ A: [['x']] })), { unreadable: 'xls' });
  assert.equal(await coworkBinaryPreview('datos.csv', new Uint8Array([65])), null);
  assert.equal(await coworkBinaryPreview('foto.png', new Uint8Array([65])), null);
});

test('a PDF reads as text, with the pages read of the pages it has, and a scan or a damaged file says so', async () => {
  const result = await coworkBinaryPreview('brief.pdf', await makePdf(['Brief comercial AXIS', 'Segmento: RR. HH. y minería. Oferta: una demostración de 15 minutos.']));
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'text' }>;
  assert.match(preview.text, /Brief comercial AXIS/);
  assert.match(preview.text, /demostración de 15 minutos/);
  assert.deepEqual(preview.pages, { read: 2, total: 2 });
  assert.equal(preview.truncated, false);
  assert.deepEqual(await coworkBinaryPreview('escaneo.pdf', await makePdf(['', ''])), { unreadable: 'scan' });
  assert.deepEqual(await coworkBinaryPreview('roto.pdf', new TextEncoder().encode('%PDF-1.4 roto')), { unreadable: 'damaged' });
});

test('a long PDF is read up to what the model uses, and says how many pages that was', async () => {
  const page = Array.from({ length: 60 }, (_, index) => `Línea ${index + 1} del contrato con texto de relleno suficiente para ocupar el ancho.`).join('\n');
  const result = await coworkBinaryPreview('largo.pdf', await makePdf(Array.from({ length: 30 }, () => page)));
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'text' }>;
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.length <= COWORK_FILE_READ_LIMITS.textChars + 1);
  assert.equal(preview.pages?.total, 30);
  assert.ok((preview.pages?.read ?? 0) < 30, 'it stopped once the text was enough');
});

test('a Word document reads as its text, and a file that is not one says it is damaged', async () => {
  const result = await coworkBinaryPreview('propuesta.docx', await makeDocx(['Propuesta para Entel', 'Incluye la demostración y el registro de consultas.']));
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'text' }>;
  assert.equal(preview.text, 'Propuesta para Entel\n\nIncluye la demostración y el registro de consultas.');
  assert.equal(preview.pages, undefined);
  assert.deepEqual(await coworkBinaryPreview('roto.docx', new TextEncoder().encode('no es un docx')), { unreadable: 'damaged' });
  assert.deepEqual(await coworkBinaryPreview('bomba.docx', zipDirectory([{ name: 'word/document.xml', size: 400 * 1024 * 1024 }])), { unreadable: 'large' });
  // A Word document is parsed whole: more XML than it can hold in memory is not opened, however well it compresses.
  assert.deepEqual(await coworkBinaryPreview('inmenso.docx', zipDirectory([{ name: 'word/document.xml', size: 12 * 1024 * 1024 }], { padding: 100_000 })), { unreadable: 'large' });
});

test('a Word table reads with one row per line and its cells apart, and what the text says is kept as it was written', async () => {
  const result = await coworkBinaryPreview('condiciones.docx', await makeDocx([
    'Condiciones',
    [['Concepto', 'Detalle', 'Valor'], ['Piloto', '30 días', '$450.000'], ['Licencia', 'Consultas & más <ilimitadas> &lt;', '$4.800.000']],
    'Fin.']));
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  assert.equal(result.preview.text, 'Condiciones\n\nConcepto | Detalle | Valor\nPiloto | 30 días | $450.000\nLicencia | Consultas & más <ilimitadas> &lt; | $4.800.000\n\nFin.');
});

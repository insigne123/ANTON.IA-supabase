import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import type { CoworkBlock } from '@/lib/cowork/contracts';
import { COWORK_BLOCK_FORMATS } from '@/lib/cowork/export-formats';
import { COWORK_EXPORT_BODY_LIMIT, buildCoworkBlockFile, coworkBlockExportRequest } from './block-export';
import { coworkBinaryPreview } from './file-binary';

type Of<T extends CoworkBlock['type']> = Extract<CoworkBlock, { type: T }>;

const table: Of<'table'> = { type: 'table', title: 'Prospectos: «RR. HH.»', columns: ['Nombre', 'Empresa', 'Correo'],
  rows: [['Paula Herrera', 'Entel', 'pherrera@entel.cl'], ['=HYPERLINK("https://malo.example")', 'Compañía Ñ', ''], ['00123', 'LATAM', 'a@latam.com']] };
const chart: Of<'chart'> = { type: 'chart', title: 'Correos enviados y lo que volvió', kind: 'bar', period: 'Últimos 7 y 30 días', unit: 'envíos',
  labels: ['Enviados', 'Respuestas', 'Rebotes'], series: [{ name: '7 días', values: [40, 6, 1] }, { name: '30 días', values: [240, 31.5, 4] }] };
const metrics: Of<'metrics'> = { type: 'metrics', title: 'Cifras de la semana', period: 'Últimos 7 días',
  items: [{ label: 'Enviados', value: '40', detail: 'de 3 campañas' }, { label: 'Respuestas', value: '15 %', detail: null }] };
const email: Of<'email_draft'> = { type: 'email_draft', title: 'Correo para Entel', to: ['Paula Herrera', 'Luis Soto'], subject: 'Una demostración de 15 minutos',
  body: 'Hola *Paula*,\n\nTe cuento cómo AXIS revisa antecedentes en minutos.\n\n- punto uno\n- punto dos\n\nSaludos,\nNicolás' };
const sequence: Of<'sequence'> = { type: 'sequence', title: 'Secuencia AXIS RR. HH.', steps: [
  { day: 1, subject: 'Primer contacto', body: 'Hola Ana,\n\nQuería presentarme.' },
  { day: 4, subject: 'Seguimiento', body: 'Ana, ¿pudiste ver mi correo?' },
  { day: 9, subject: 'Cierre', body: 'Último mensaje por ahora.' }] };

const request = (format: string, block: unknown) => JSON.stringify({ format, block });
async function textOf(name: string, bytes: Uint8Array) {
  const result = await coworkBinaryPreview(name, bytes);
  assert.ok(result && 'preview' in result && result.preview.kind === 'text', `${name} reads back as text`);
  return (result.preview as Extract<typeof result.preview, { kind: 'text' }>).text;
}

test('a request says which card and which file, and anything else is refused with a reason', () => {
  assert.deepEqual(coworkBlockExportRequest(request('xlsx', table)), { format: 'xlsx', block: table });
  assert.throws(() => coworkBlockExportRequest('esto no es JSON'), { status: 400 });
  assert.throws(() => coworkBlockExportRequest(request('xlsx', { ...table, extra: 1 })), { status: 400 });
  assert.throws(() => coworkBlockExportRequest(request('xlsx', { type: 'code', title: 'x' })), { status: 400 });
  assert.throws(() => coworkBlockExportRequest(JSON.stringify({ format: 'md', block: table })), { status: 400 });
  assert.throws(() => coworkBlockExportRequest(JSON.stringify({ format: 'xlsx', block: table, extra: true })), { status: 400 });
  // Each card is offered only what it can be: an email is not a spreadsheet, a table is not a letter.
  assert.throws(() => coworkBlockExportRequest(request('xlsx', email)), /formato/);
  assert.throws(() => coworkBlockExportRequest(request('docx', table)), /formato/);
  assert.throws(() => coworkBlockExportRequest(request('pdf', chart)), /formato/);
  assert.throws(() => coworkBlockExportRequest(request('csv', sequence)), /formato/);
  assert.throws(() => coworkBlockExportRequest(' '.repeat(COWORK_EXPORT_BODY_LIMIT + 1)), { status: 413 });
});

test('a table becomes an Excel that reads back the same, with text kept as text', async () => {
  const file = await buildCoworkBlockFile(table, 'xlsx');
  assert.equal(file.filename, 'prospectos-rr-hh.xlsx');
  assert.equal(file.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const result = await coworkBinaryPreview(file.filename, file.bytes);
  assert.ok(result && 'preview' in result && result.preview.kind === 'table');
  const preview = result.preview as Extract<typeof result.preview, { kind: 'table' }>;
  assert.deepEqual(preview.columns, table.columns);
  assert.deepEqual(preview.rows, table.rows);
  const book = XLSX.read(file.bytes, { type: 'array' });
  assert.deepEqual(book.SheetNames, ['Prospectos «RR. HH.»'], 'the sheet is named after the card, without the characters Excel forbids');
  const sheet = book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.A3.t, 's');
  assert.equal(sheet.A3.f, undefined, 'a value that looks like a formula is data, not a formula');
  assert.equal(sheet.A4.v, '00123', 'a code with leading zeros stays a code');
  assert.deepEqual(sheet['!autofilter'], { ref: 'A1:C4' });
});

test('a table as CSV opens in a spreadsheet: BOM, quotes and formulas neutralized', async () => {
  const file = await buildCoworkBlockFile(table, 'csv');
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes);
  assert.equal(file.mime, 'text/csv; charset=utf-8');
  assert.deepEqual([...file.bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'the BOM makes Excel read the accents');
  assert.ok(text.startsWith('\uFEFF"Nombre","Empresa","Correo"\r\n'));
  assert.match(text, /"'=HYPERLINK\(""https:\/\/malo\.example""\)"/);
});

test('a chart becomes a sheet with its figures as numbers, and its unit and period say what they count', async () => {
  const file = await buildCoworkBlockFile(chart, 'xlsx');
  assert.equal(file.filename, 'correos-enviados-y-lo-que-volvio.xlsx');
  const book = XLSX.read(file.bytes, { type: 'array' });
  assert.deepEqual(book.SheetNames, ['Correos enviados y lo que volvi'], 'an Excel sheet name holds 31 characters at most');
  const sheet = book.Sheets[book.SheetNames[0]];
  assert.equal(sheet.A1.v, 'Correos enviados y lo que volvió (Últimos 7 y 30 días)');
  assert.equal(sheet.B1.v, '7 días (envíos)');
  assert.equal(sheet.C1.v, '30 días (envíos)');
  assert.deepEqual([sheet.B2.t, sheet.B2.v, sheet.C3.v], ['n', 40, 31.5]);
  assert.equal(sheet.A4.v, 'Rebotes');
  const csv = new TextDecoder().decode((await buildCoworkBlockFile(chart, 'csv')).bytes);
  assert.match(csv, /"Enviados","40","240"/);
});

test('figures become rows with their period, as a sheet or as CSV', async () => {
  const sheet = XLSX.read((await buildCoworkBlockFile(metrics, 'xlsx')).bytes, { type: 'array' }).Sheets['Cifras de la semana'];
  assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [['Cifra', 'Valor', 'Detalle', 'Período'], ['Enviados', '40', 'de 3 campañas', 'Últimos 7 días'], ['Respuestas', '15 %', '', 'Últimos 7 días']]);
  const csv = new TextDecoder().decode((await buildCoworkBlockFile(metrics, 'csv')).bytes);
  assert.match(csv, /"Respuestas","15 %","","Últimos 7 días"/);
});

test('an email becomes a Word or a PDF with its recipients, subject and body, and its text is never read as Markdown', async () => {
  const word = await buildCoworkBlockFile(email, 'docx');
  assert.equal(word.filename, 'correo-para-entel.docx');
  const wordText = await textOf(word.filename, word.bytes);
  assert.match(wordText, /^Correo para Entel\n\nPara: Paula Herrera, Luis Soto\n\nAsunto: Una demostración de 15 minutos\n\nHola \*Paula\*,/);
  assert.match(wordText, /Te cuento cómo AXIS revisa antecedentes en minutos\./);
  assert.match(wordText, /- punto uno\n- punto dos/, 'a dash in an email stays a dash: it is not turned into a list');
  assert.match(wordText, /Saludos,\nNicolás$/);
  const pdf = await buildCoworkBlockFile(email, 'pdf');
  assert.equal(pdf.mime, 'application/pdf');
  const pdfText = await textOf(pdf.filename, pdf.bytes);
  assert.match(pdfText, /Correo para Entel/);
  assert.match(pdfText, /Para: Paula Herrera, Luis Soto/);
  assert.match(pdfText, /Asunto: Una demostración de 15 minutos/);
  assert.match(pdfText, /Hola \*Paula\*,/);
  assert.match(pdfText, /Saludos,\s*Nicolás/);
});

test('a sequence becomes a Word or a PDF with one section per email and the day it goes out', async () => {
  const word = await buildCoworkBlockFile(sequence, 'docx');
  const text = await textOf(word.filename, word.bytes);
  assert.equal(word.filename, 'secuencia-axis-rr-hh.docx');
  assert.match(text, /Correo 1 · día 1\n\nAsunto: Primer contacto\n\nHola Ana,\n\nQuería presentarme\./);
  assert.match(text, /Correo 2 · día 4\n\nAsunto: Seguimiento/);
  assert.match(text, /Correo 3 · día 9\n\nAsunto: Cierre\n\nÚltimo mensaje por ahora\.$/);
  const pdfText = await textOf('s.pdf', (await buildCoworkBlockFile(sequence, 'pdf')).bytes);
  assert.match(pdfText, /Correo 2 · día 4/);
});

test('the version the person edited is the one that comes out, and the PDF says when its fonts cannot hold what the text has', async () => {
  const edited: Of<'email_draft'> = { ...email, subject: 'Asunto que edité yo', body: 'Cuerpo que edité yo 🌍' };
  const word = await buildCoworkBlockFile(edited, 'docx');
  const text = await textOf(word.filename, word.bytes);
  assert.match(text, /Asunto: Asunto que edité yo/);
  assert.match(text, /Cuerpo que edité yo 🌍/);
  await assert.rejects(buildCoworkBlockFile(edited, 'pdf'), (error: Error & { status?: number }) => error.status === 422 && /Word/.test(error.message));
});

test('every card offers exactly the files the server can make, and an empty title still gets a name', async () => {
  const cards: Record<CoworkBlock['type'], CoworkBlock> = { table, chart, metrics, email_draft: email, sequence };
  for (const [type, formats] of Object.entries(COWORK_BLOCK_FORMATS)) {
    for (const format of formats) {
      const file = await buildCoworkBlockFile({ ...cards[type as CoworkBlock['type']], title: '' } as CoworkBlock, format);
      assert.ok(file.bytes.length > 100, `${type} as ${format}`);
      assert.match(file.filename, new RegExp(`^cowork-[a-z]+\\.${format}$`));
    }
  }
  await assert.rejects(buildCoworkBlockFile(email, 'xlsx'), { status: 400 });
});

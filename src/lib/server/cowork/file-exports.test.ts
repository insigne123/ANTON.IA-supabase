import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { buildCoworkFile, normalizeCoworkPdfText } from './file-exports';
import type { CoworkEvent } from '@/lib/cowork/contracts';

const id = '00000000-0000-4000-8000-000000000001';
const event = (kind: string, payload: Record<string, unknown>): CoworkEvent => ({ sequence: 1, created_at: '2026-09-15T00:00:00Z', kind, payload });

test('Excel preserves actual rows, accents and formula-like strings without formulas', async () => {
  const observation = event('tool.completed', { action: 'leads.search', result: { scope: 'own_saved_contacts', items: [
    { id, name: '=HYPERLINK("https://bad")', company: 'Compañía Ñ', email: 'test@example.com', secret: 'private' },
  ] } });
  const file = await buildCoworkFile([observation, observation], 'xlsx');
  const book = XLSX.read(file.bytes, { type: 'array' });
  const sheet = book.Sheets.Contactos;
  assert.deepEqual(book.SheetNames, ['Contactos']);
  assert.equal(sheet.B2.t, 's');
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.B2.v, '=HYPERLINK("https://bad")');
  assert.equal(sheet.D2.v, 'Compañía Ñ');
  assert.equal(sheet.A2.v, id);
  assert.equal(XLSX.utils.sheet_to_json(sheet).length, 1);
  assert.equal(JSON.stringify(sheet).includes('private'), false);
});

test('PDF produces a valid cross-reference and paginates long document content', async () => {
  const content = '# Resumen\n' + Array.from({ length: 350 }, (_, i) => `Línea ${i}: Investigación comercial en Chile.`).join('\n');
  const file = await buildCoworkFile([event('run.completed', { reply: 'Listo', document: { title: 'Informe', content }, telemetry: [] })], 'pdf');
  const pdf = Buffer.from(file.bytes).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  const xref = /startxref\s+(\d+)\s+%%EOF/.exec(pdf);
  assert.ok(xref);
  assert.equal(pdf.slice(Number(xref[1]), Number(xref[1]) + 4), 'xref');
  const pages = pdf.match(/\/Type \/Page\b/g) || [];
  assert.ok(pages.length > 5);
  // Independently inflate content streams to check the final paragraph was retained.
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match => inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')).join('\n');
  assert.match(streams, /349/);
  assert.match(streams, /ANTON.IA Cowork/);
});

test('unsupported PDF characters are not silently corrupted; Markdown preserves them', async () => {
  const events = [event('run.completed', { reply: 'Listo', document: { title: '日本語', content: '🌍 Investigación' } })];
  await assert.rejects(buildCoworkFile(events, 'pdf'), /Markdown/);
  const md = await buildCoworkFile(events, 'md');
  assert.equal(new TextDecoder().decode(md.bytes), '🌍 Investigación');
  assert.equal(normalizeCoworkPdfText('“Acción”—sí…'), '"Acción"-sí...');
});

test('missing or fabricated results cannot become exports', async () => {
  await assert.rejects(buildCoworkFile([], 'xlsx'), /contactos/);
  await assert.rejects(buildCoworkFile([event('run.completed', { reply: 'Texto', document: null })], 'pdf'), /documento/);
  await assert.rejects(buildCoworkFile([event('run.completed', { action: 'leads.search', result: { scope: 'own_saved_contacts', items: [{ id }] } })], 'csv'), /contactos/);
});

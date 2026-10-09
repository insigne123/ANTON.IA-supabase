// Open the actual generated formats with independent parsers. No model, database, env loading or providers.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const bundled = await build({ entryPoints: ['src/lib/server/cowork/marketing-deliverables.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' });
const loaded = { exports: {} }; new Function('require','module','exports',bundled.outputFiles[0].text)(require,loaded,loaded.exports);
const id = '00000000-0000-4000-8000-000000000001';
const items = Array.from({ length: 45 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12,'0')}`, name: `Contacto demo ${i + 1}`,
  title: 'Selección', company: `Empresa demo ${i + 1}`, email: i < 30 ? `demo${i}@example.test` : null }));
const kit = await loaded.exports.buildCoworkMarketingReport([{ sequence: 1,kind: 'tool.completed',created_at: '2026-10-09T00:00:00Z',payload: { action: 'leads.search',result: { scope: 'own_saved_contacts',items } } }], {runId:id,userId:id,organizationId:id});
const file = extension => kit.files.find(file => file.filename.endsWith(extension));
const XLSX = require('xlsx');
const book = XLSX.read(file('.xlsx').bytes, { type: 'array' });
const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
assert.equal(rows.length,46);
assert.equal(rows.slice(1).filter(row => row[4]).length,30);
const mammoth = require('mammoth');
const docx = await mammoth.extractRawText({ buffer: Buffer.from(file('.docx').bytes) });
assert.match(docx.value,/Contactos observados: 45/); assert.match(docx.value,/Con correo registrado: 30/); assert.match(docx.value,/Contacto demo 45/);
const { extractText } = await import('unpdf');
const pdf = await extractText(new Uint8Array(file('.pdf').bytes), { mergePages: true });
assert.match(pdf.text,/Contactos observados: 45/); assert.match(pdf.text,/Con correo registrado: 30/); assert.match(pdf.text,/Contacto demo 45/);
assert.ok(file('.html')); assert.match(new TextDecoder().decode(file('.html').bytes),/45 contactos observados/);
assert.equal(kit.manifest.files.length,5); assert.equal(kit.manifest.data.observedRows,45);
console.log('PASS: independent PDF/Word/Excel parsers open all 45 rows; 30 emails match; HTML and manifest share the same observed population.');

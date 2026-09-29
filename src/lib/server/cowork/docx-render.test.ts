import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseMarkdown } from '@/lib/cowork/markdown';
import { coworkBinaryPreview } from './file-binary';
import { renderCoworkDocx } from './docx-render';

const MARKDOWN = [
  '# Informe de prospección',
  'Resumen con **negrita**, *cursiva*, ~~tachado~~, `código` y un [vínculo](https://axis.example.cl/demo) y otro [interno](/campaigns).',
  '## Lista',
  '- Primero\n- Segundo con **énfasis**\n  - Anidado uno\n  - Anidado dos',
  '- [x] Hecho\n- [ ] Pendiente',
  '> Una cita importante\n> con dos líneas',
  '```\nconst x = 1;\nif (x) { return "ñandú"; }\n```',
  '| Concepto | Valor | Nota |\n|:--|--:|:-:|\n| Piloto | $450.000 | 30 días |\n| Licencia | $4.800.000 | Anual |',
  '---',
  'Cierre con tildes áéíóúñ, emoji 🌍 y caracteres de control \u0001\u000B que no pueden viajar.',
].join('\n\n');

async function entries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => zip.file(name)?.async('string') ?? '';
  return { zip, read };
}

test('the Word keeps headings, text, lists, tasks, quotes, code and tables, and reads back through the same reader Cowork uses', async () => {
  const bytes = await renderCoworkDocx('Informe · septiembre', parseMarkdown(MARKDOWN));
  const result = await coworkBinaryPreview('informe.docx', bytes);
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  const { text } = result.preview as Extract<typeof result.preview, { kind: 'text' }>;
  assert.match(text, /^Informe · septiembre\n\nInforme de prospección\n\nResumen con negrita, cursiva, tachado, código y un vínculo y otro interno\./);
  assert.match(text, /Lista\n\n• Primero\n• Segundo con énfasis\n• Anidado uno\n• Anidado dos/);
  assert.match(text, /☑\s*Hecho/);
  assert.match(text, /☐\s*Pendiente/);
  assert.match(text, /Una cita importante\ncon dos líneas/);
  assert.match(text, /const x = 1;\n+if \(x\) \{ return "ñandú"; \}/);
  assert.match(text, /Concepto \| Valor \| Nota\nPiloto \| \$450\.000 \| 30 días\nLicencia \| \$4\.800\.000 \| Anual/);
  // Accents and emoji stay; what a .docx cannot hold does not travel.
  assert.match(text, /Cierre con tildes áéíóúñ, emoji 🌍 y caracteres de control  que no pueden viajar\./);
});

test('the file is a well-formed Word: title, author, footer with page numbers, headings as styles and a link only where it can be followed', async () => {
  const { read, zip } = await entries(await renderCoworkDocx('Informe · septiembre', parseMarkdown(MARKDOWN)));
  assert.ok(zip.file('[Content_Types].xml') && zip.file('word/document.xml') && zip.file('word/styles.xml') && zip.file('word/numbering.xml'));
  const core = await read('docProps/core.xml');
  assert.match(core, /<dc:title>Informe · septiembre<\/dc:title>/);
  assert.match(core, /<dc:creator>ANTON\.IA Cowork<\/dc:creator>/);
  const document = await read('word/document.xml');
  assert.match(document, /<w:pStyle w:val="Title"\/>/);
  assert.match(document, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(document, /<w:pStyle w:val="Heading2"\/>/);
  assert.equal((document.match(/<w:hyperlink /g) || []).length, 1, 'only the https link is a link; «/campaigns» means nothing outside the app');
  assert.equal((document.match(/<w:tbl>/g) || []).length, 1);
  assert.match(document, /<w:tblHeader\/>/);
  assert.doesNotMatch(document, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  const footers = (await Promise.all(Object.keys(zip.files).filter(name => /^word\/footer\d*\.xml$/.test(name)).map(read))).join('');
  assert.match(footers, /ANTON\.IA Cowork · página /);
  assert.match(footers, /PAGE/);
  assert.match(footers, /NUMPAGES/);
  // The page numbers are fields: they take the footer's look from its style, so they match the text around them.
  assert.match(footers, /<w:pStyle w:val="Footer"\/>/);
  assert.doesNotMatch(footers, /<w:r><w:rPr>/, 'no run carries its own look: all of it comes from the style');
  const styles = await read('word/styles.xml');
  const footerStyle = /<w:style w:type="paragraph" w:styleId="Footer">([\s\S]*?)<\/w:style>/.exec(styles)?.[1] ?? '';
  assert.match(footerStyle, /<w:sz w:val="17"\/>/);
  assert.match(styles, /w:lang w:val="es-CL"/);
});

test('a numbered list starts where it says and each list restarts', async () => {
  const bytes = await renderCoworkDocx('Pasos', parseMarkdown('5. Cinco\n6. Seis\n\nUn párrafo en medio.\n\n1. Uno\n2. Dos'));
  const { read } = await entries(bytes);
  const numbering = await read('word/numbering.xml');
  assert.match(numbering, /w:start w:val="5"/);
  const document = await read('word/document.xml');
  const ids = [...document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map(match => match[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids.slice(0, 2)).size, 1);
  assert.equal(new Set(ids.slice(2)).size, 1);
  assert.notEqual(ids[0], ids[2], 'the second list is another list, so it restarts');
});

test('a long document with a wide table still comes out as one readable file', async () => {
  const header = Array.from({ length: 12 }, (_, index) => `Columna ${index + 1}`);
  const rows = Array.from({ length: 150 }, (_, row) => Array.from({ length: 12 }, (_, column) => `valor ${row}-${column}`));
  const table = [header, header.map(() => '---'), ...rows].map(row => `| ${row.join(' | ')} |`).join('\n');
  const paragraphs = Array.from({ length: 400 }, (_, index) => `Párrafo ${index} con texto suficiente para llenar la línea del documento.`).join('\n\n');
  const bytes = await renderCoworkDocx('Largo', parseMarkdown(`${paragraphs}\n\n${table}`));
  const result = await coworkBinaryPreview('largo.docx', bytes);
  assert.ok(result && 'preview' in result && result.preview.kind === 'text');
  assert.match((result.preview as Extract<typeof result.preview, { kind: 'text' }>).text, /^Largo\n\nPárrafo 0 con texto/);
  assert.ok(bytes.length < 400 * 1024);
});

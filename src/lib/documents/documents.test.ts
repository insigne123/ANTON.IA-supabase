import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import test from 'node:test';
import JSZip from 'jszip';
import { call, reply, ScriptedModel } from '@/lib/agent-harness/scripted';
import { ToolRegistry } from '@/lib/agent-harness/tools';
import { runAgent } from '@/lib/agent-harness/loop';
import { parseMarkdown } from '@/lib/cowork/markdown';
import { improveLayout, inspectLayout } from './inspect';
import { bodyHeight, layoutDocument, type Layout, type Measure } from './layout';
import { produceDocument } from './pipeline';
import { pdfSafeText, renderPdf } from './render-pdf';
import { renderDocx } from './render-docx';
import { layoutSvgs } from './render-svg';
import { documentInputSchema, runsOf, specFromInput, specFromMarkdown, type DocumentSpec } from './spec';
import { contrast, THEMES, themePairs } from './theme';
import { documentTool, DOCUMENT_ATTEMPTS } from './tool';
import { drawsText, rasterizePages, reviewDocumentPages } from './vision';

/** A measure without a font: width proportional to the text, so layouts are the same everywhere. */
const measure: Measure = (text, font, size) => text.length * size * 0.19 * (font.bold ? 1.06 : 1) * (font.family === 'courier' ? 1.15 : 1);
const sentence = 'Una frase de ejemplo con palabras de largo normal para llenar la línea y provocar saltos. ';
const para = (times: number) => ({ type: 'paragraph' as const, runs: runsOf(sentence.repeat(times)) });

// ─── Design ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('every text and background pair of every theme reads at 4.5:1 or better', () => {
  for (const theme of Object.values(THEMES)) {
    for (const pair of themePairs(theme)) assert.ok(contrast(pair.text, pair.background) >= 4.5, `${theme.name}: ${pair.name} is ${contrast(pair.text, pair.background).toFixed(2)}`);
  }
  assert.ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 0.01);
});

// ─── Spec ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the model writes light Markdown inline and the spec carries styled runs', () => {
  assert.deepEqual(runsOf('Un **dato** y *énfasis* con `código` y [enlace](https://a.cl).'), [
    { text: 'Un ' }, { text: 'dato', bold: true }, { text: ' y ' }, { text: 'énfasis', italic: true }, { text: ' con ' }, { text: 'código', code: true }, { text: ' y ' }, { text: 'enlace', href: 'https://a.cl/' }, { text: '.' },
  ]);
  const spec = specFromInput(documentInputSchema.parse({
    title: 'Informe', blocks: [{ type: 'table', columns: ['A', 'B', 'C'], rows: [['1', '2']] }, { type: 'list', items: ['uno', 'dos'] }, { type: 'figures', items: [{ value: '5', label: 'Cinco' }] }],
  }), { theme: 'cowork' });
  assert.equal(spec.theme, 'cowork');
  const table = spec.blocks[0];
  assert.equal(table.type === 'table' && table.rows[0].length, 3, 'a short row is padded to the columns');
  assert.equal(documentInputSchema.safeParse({ title: 'x', blocks: [] }).success, false);
  assert.equal(documentInputSchema.safeParse({ title: 'x', blocks: [{ type: 'figures', items: [] }] }).success, false);
});

test('a Cowork document becomes a spec: a quote that opens with «Nota:» is a callout, the repeated title goes, lists nest and tables keep their alignment', () => {
  const markdown = '# Informe de métricas\n\n## Resumen\n\nTexto **claro**.\n\n> Nota: las cifras son de los últimos 30 días.\n\n> Una cita sin etiqueta.\n\n- uno\n  - sub uno\n- dos\n\n| Canal | Envíos |\n| :-- | --: |\n| Correo | 120 |\n\n---';
  const spec = specFromMarkdown('Informe de métricas', parseMarkdown(markdown), { theme: 'cowork' });
  assert.deepEqual(spec.blocks.map(block => block.type), ['heading', 'paragraph', 'callout', 'quote', 'list', 'table', 'divider']);
  const callout = spec.blocks[2];
  assert.equal(callout.type === 'callout' && callout.title, 'Nota');
  assert.equal(callout.type === 'callout' && callout.runs.map(run => run.text).join(''), 'las cifras son de los últimos 30 días.');
  const list = spec.blocks[4];
  assert.equal(list.type === 'list' && list.items[0].sub?.[0].runs[0].text, 'sub uno');
  const table = spec.blocks[5];
  assert.deepEqual(table.type === 'table' && table.columns.map(column => column.align), ['left', 'right']);
});

// ─── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const doc = (blocks: DocumentSpec['blocks'], extra: Partial<DocumentSpec> = {}): DocumentSpec => ({ title: 'Documento de prueba', blocks, ...extra });

test('a heading always keeps company: it never ends a page, however the blocks fall', () => {
  for (let filler = 1; filler <= 40; filler++) {
    const spec = doc([para(filler), { type: 'heading', level: 1, runs: runsOf('Título que no puede quedar solo') }, para(2)]);
    const layout = layoutDocument(spec, measure);
    const issues = inspectLayout(layout).filter(issue => issue.kind === 'orphan-heading');
    assert.deepEqual(issues, [], `filler ${filler}`);
  }
});

test('a paragraph never leaves one line alone on either side of a page break', () => {
  for (let lines = 8; lines <= 30; lines++) {
    const spec = doc([{ type: 'paragraph', runs: runsOf(`${'palabra '.repeat(24 * lines)}`) }, { type: 'paragraph', runs: runsOf(`${'otra '.repeat(24 * 3)}`) }]);
    const layout = layoutDocument(spec, measure);
    for (const page of layout.pages) {
      const rows = new Set(page.ops.filter(op => op.t === 'text' && op.tag === 'p').map(op => (op.t === 'text' ? Math.round(op.y * 10) : 0)));
      assert.ok(rows.size === 0 || rows.size >= 2, `lines ${lines}: a page holds ${rows.size} line of a paragraph`);
    }
  }
});

test('a table repeats its header on each page, keeps rows whole, and aligns numbers to the right', () => {
  const rows = Array.from({ length: 70 }, (_, index) => [{ text: `Fila ${index}` }].map(run => [run]).concat([[{ text: String(1000 + index) }]]));
  const spec = doc([{ type: 'table', columns: [{ header: runsOf('Nombre') }, { header: runsOf('Total') }], rows }]);
  const layout = layoutDocument(spec, measure);
  assert.ok(layout.pages.length >= 2);
  const headers = layout.pages.map(page => page.ops.filter(op => op.t === 'rect' && op.fill?.join() === layout.theme.accentDark.join()).length);
  assert.ok(headers.every(count => count === 1), `header per page: ${headers}`);
  const left = layout.theme.page.left;
  const width = layout.theme.page.width - left - layout.theme.page.right;
  const numbers = layout.pages[0].ops.filter(op => op.t === 'text' && op.tag === 'td' && /^\d{4}$/.test(op.text));
  assert.ok(numbers.length > 5);
  for (const number of numbers) if (number.t === 'text') assert.ok(Math.abs(number.x + number.w - (left + width - 2)) < 0.5, 'numbers end at the right edge of their cell');
  assert.deepEqual(layout.issues, []);
});

test('a row taller than the page is reported, and a wide text column makes room by wrapping', () => {
  const spec = doc([{ type: 'table', columns: [{ header: runsOf('Texto') }], rows: [[runsOf('palabra '.repeat(4000))]] }]);
  assert.ok(layoutDocument(spec, measure).issues.some(issue => issue.kind === 'table-row-too-tall' && issue.severity === 'error'));
});

test('a last page with a few lines is pulled back by tightening the spacing, and a stranded heading by a page break', () => {
  // Find a filler where the last page is sparse, then let the inspector fix it.
  let found: { filler: number; before: number; after: number } | null = null;
  for (let filler = 20; filler <= 80 && !found; filler++) {
    const spec = doc([para(filler), { type: 'heading', level: 2, runs: runsOf('Cierre') }, para(1)]);
    const layout = layoutDocument(spec, measure);
    if (inspectLayout(layout).some(issue => issue.kind === 'sparse-last-page')) {
      const improved = improveLayout(spec, measure);
      found = { filler, before: layout.pages.length, after: improved.layout.pages.length };
    }
  }
  assert.ok(found, 'a sparse last page came up in the sweep');
  assert.ok(found.after <= found.before);
});

test('a cover is its own page without header or footer, the body numbers its pages out of the total, and the running title heads each body page after the first', () => {
  const spec = doc([para(30), { type: 'pageBreak' }, para(2)], { cover: true, kicker: 'Informe', subtitle: 'Un subtítulo', meta: [{ label: 'Para', value: 'Una empresa' }], runningTitle: 'Título corrido' });
  const layout = layoutDocument(spec, measure, { date: '1 de enero' });
  assert.equal(layout.pages[0].kind, 'cover');
  const texts = (index: number) => layout.pages[index].ops.filter(op => op.t === 'text').map(op => (op.t === 'text' ? op.text : ''));
  assert.ok(!texts(0).some(text => text.startsWith('Página')));
  assert.ok(texts(0).includes('1 de enero'));
  assert.ok(texts(1).includes(`Página 2 de ${layout.pages.length}`));
  assert.ok(texts(2).includes('Título corrido'));
});

// ─── Inspector ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the inspector finds text outside the margins and type too small to read', () => {
  const layout = layoutDocument(doc([para(1)]), measure);
  const font = { family: 'helvetica' as const };
  const broken: Layout = { ...layout, pages: [{ ...layout.pages[0], ops: [...layout.pages[0].ops,
    { t: 'text', x: 5, y: 50, text: 'fuera del margen', font, size: 10, color: layout.theme.ink, w: 30, tag: 'p' },
    { t: 'text', x: 30, y: 60, text: 'diminuto', font, size: 6, color: layout.theme.ink, w: 10, tag: 'p' }] }] };
  const kinds = inspectLayout(broken).map(issue => issue.kind);
  assert.ok(kinds.includes('outside-margin'));
  assert.ok(kinds.includes('tiny-text'));
});

test('a section with nothing under it is called out', () => {
  const layout = layoutDocument(doc([{ type: 'heading', level: 1, runs: runsOf('Vacía') }, { type: 'heading', level: 1, runs: runsOf('Con contenido') }, para(1)]), measure);
  assert.ok(inspectLayout(layout).some(issue => issue.kind === 'empty-section' && /Vacía/.test(issue.message)));
});

// ─── Outputs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('characters the PDF cannot draw are replaced and counted, and the Word keeps them', async () => {
  assert.deepEqual(pdfSafeText('“Acción”—sí… → ok'), { text: '"Acción"-sí... -> ok', lost: 0 });
  assert.deepEqual(pdfSafeText('日本'), { text: '??', lost: 2 });
  const spec = doc([{ type: 'paragraph', runs: runsOf('Hola 日本 mundo') }], { title: 'Informe 日' });
  const produced = await produceDocument(spec, { formats: ['pdf', 'docx'] });
  assert.equal(produced.lost, 3);
  assert.ok(produced.issues.some(issue => issue.kind === 'unsupported-glyph' && /3 caracteres/.test(issue.message)));
  const zip = await JSZip.loadAsync(produced.docx!);
  assert.match(await zip.file('word/document.xml')!.async('string'), /日本/);
});

test('the PDF is valid, has as many pages as the layout, numbers them, and carries the brand of its footer', async () => {
  const spec = doc([...Array.from({ length: 12 }, () => para(14))], { brand: 'ANTON.IA Cowork', theme: 'cowork' });
  const { bytes, layout } = await renderPdf(spec);
  const pdf = Buffer.from(bytes).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, layout.pages.length);
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')).join('\n');
  assert.match(streams, /ANTON\.IA Cowork/);
  assert.match(streams, new RegExp(`P.gina ${layout.pages.length} de ${layout.pages.length}`));
  assert.ok(layout.pages.length >= 3);
});

test('the preview is the same pages as SVG, with text escaped', () => {
  const layout = layoutDocument(doc([{ type: 'paragraph', runs: runsOf('a < b & c') }, { type: 'bars', items: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] }]), measure);
  const [svg] = layoutSvgs(layout);
  assert.match(svg, /^<svg /);
  assert.match(svg, /a &lt; b &amp; c/);
  assert.match(svg, /<rect /);
  assert.equal(layoutSvgs(layout).length, layout.pages.length);
});

test('the Word has real headings and lists, a header row that repeats, rows that do not split, and a footer that numbers the pages', async () => {
  const spec = specFromInput(documentInputSchema.parse({
    title: 'Propuesta', cover: true, kicker: 'Comercial', meta: [{ label: 'Para', value: 'Una empresa' }],
    blocks: [{ type: 'heading', level: 1, text: 'Alcance' }, { type: 'list', items: ['uno', 'dos'] }, { type: 'list', ordered: true, items: ['a', 'b'] },
      { type: 'table', columns: ['Servicio', 'Valor'], rows: [['Base', '$ 1.000'], ['Total', '$ 1.000']] },
      { type: 'callout', tone: 'warning', title: 'Ojo', text: 'Algo importante' }, { type: 'figures', items: [{ value: '5', label: 'Cinco' }] },
      { type: 'quote', text: 'Una cita' }, { type: 'bars', items: [{ label: 'A', value: 3 }, { label: 'B', value: 1 }] }, { type: 'divider' }, { type: 'pageBreak' }, { type: 'paragraph', text: 'Fin' }],
  }));
  const zip = await JSZip.loadAsync(await renderDocx(spec, { date: '1 de enero' }));
  const document = await zip.file('word/document.xml')!.async('string');
  assert.match(document, /w:pStyle w:val="Heading1"/);
  assert.match(document, /<w:tblHeader\/>/);
  assert.ok((document.match(/<w:cantSplit\/>/g) || []).length >= 3);
  assert.match(document, /w:numId/);
  assert.match(document, /w:titlePg\/>/);
  const files = Object.keys(zip.files);
  const footer = await Promise.all(files.filter(name => /word\/footer\d+\.xml$/.test(name)).map(name => zip.file(name)!.async('string')));
  assert.ok(footer.some(xml => /PAGE/.test(xml) && /NUMPAGES/.test(xml)));
  const numbering = await zip.file('word/numbering.xml')!.async('string');
  assert.match(numbering, /bullet/);
  assert.match(numbering, /decimal/);
});

test('the circuit gives back the PDF, the Word, the previews and what the inspector found', async () => {
  const spec = doc([{ type: 'heading', level: 1, runs: runsOf('Uno') }, para(3)]);
  const produced = await produceDocument(spec, { formats: ['pdf', 'docx'], date: '1 de enero' });
  assert.ok(produced.pdf && produced.docx);
  assert.equal(produced.svgs.length, produced.pages);
  assert.deepEqual(produced.issues, []);
  assert.equal((await produceDocument(spec)).docx, null);
});

// ─── The tool an agent uses ────────────────────────────────────────────────────────────────────────────────────────────────

const toolInput = { title: 'Resumen de la semana', blocks: [{ type: 'heading', level: 1, text: 'Lo importante' }, { type: 'paragraph', text: 'Se enviaron **128 correos**.' }] };

test('the tool lays the document out, stores each format and says what it made', async () => {
  const stored: Array<{ filename: string; mime: string; size: number }> = [];
  const tool = documentTool({ store: async file => { stored.push({ filename: file.filename, mime: file.mime, size: file.bytes.byteLength }); return { id: `f${stored.length}` }; }, theme: 'cowork', brand: 'ANTON.IA Cowork', date: () => '1 de enero' });
  const outcome = await tool.run({ ...toolInput, formatos: ['pdf', 'docx'] } as never, { signal: new AbortController().signal, round: 1, depth: 0, state: new Map(), note: () => undefined });
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(stored.map(file => file.filename), ['resumen-de-la-semana.pdf', 'resumen-de-la-semana.docx']);
  assert.equal(stored[0].mime, 'application/pdf');
  assert.match((outcome as { text: string }).text, /Documento creado: resumen-de-la-semana\.pdf, resumen-de-la-semana\.docx/);
});

test('a problem that changes how it reads goes back to the agent twice, then the document is delivered with what is left said', async () => {
  const huge = { title: 'Con fila enorme', blocks: [{ type: 'table', columns: ['Texto'], rows: [['palabra '.repeat(2400)]] }] };
  const state = new Map<string, unknown>();
  const tool = documentTool({ store: async () => ({}) });
  const context = { signal: new AbortController().signal, round: 1, depth: 0, state, note: () => undefined };
  const first = await tool.run(huge as never, context);
  assert.equal(first.status, 'error');
  assert.match((first as { message: string }).message, /Corrige el contenido/);
  assert.equal((await tool.run(huge as never, context)).status, 'error');
  const third = await tool.run(huge as never, context);
  assert.equal(third.status, 'ok');
  assert.match((third as { text: string }).text, /Quedó sin resolver/);
  assert.equal(state.get(DOCUMENT_ATTEMPTS), 3);
});

test('inside an agent run the document is corrected by the agent: error, new content, delivered', async () => {
  const huge = { title: 'Informe', blocks: [{ type: 'table', columns: ['Texto'], rows: [['palabra '.repeat(2400)]] }] };
  const fixed = { title: 'Informe', blocks: [{ type: 'table', columns: ['Texto'], rows: [['Una fila razonable'], ['Otra fila razonable']] }] };
  const model = new ScriptedModel([reply([call('crear_documento', huge)]), reply([call('crear_documento', fixed)]), reply('Listo, el informe está creado.')]);
  const files: string[] = [];
  const run = await runAgent({ model, system: 's', messages: [{ role: 'user', content: 'haz un informe' }], registry: new ToolRegistry([documentTool({ store: async file => { files.push(file.filename); return {}; } })]), limits: { maxRounds: 4 }, signal: new AbortController().signal });
  assert.equal(run.text, 'Listo, el informe está creado.');
  assert.deepEqual(files, ['informe.pdf']);
  const seen = model.requests[1].messages[2].content as Array<{ is_error?: boolean; content: string }>;
  assert.equal(seen[0].is_error, true);
});

// ─── The reviewer that looks ───────────────────────────────────────────────────────────────────────────────────────────────

test('the reviewer reads the page images and says where and how to fix; with no images it says it did not look', async () => {
  const model = new ScriptedModel([reply([call('entregar', { verdict: 'fix', issues: [{ page: 2, problem: 'La tabla tiene texto diminuto', fix: 'Pasar dos columnas a una lista debajo' }] })])]);
  const result = await reviewDocumentPages({ model, title: 'Informe', pages: [new Uint8Array([137, 80, 78, 71]), new Uint8Array([137, 80, 78, 71])], signal: new AbortController().signal });
  assert.equal(result.status, 'reviewed');
  assert.equal(result.status === 'reviewed' && result.review.issues[0].page, 2);
  const content = model.requests[0].messages[0].content as Array<{ type: string }>;
  assert.deepEqual(content.map(block => block.type), ['image', 'image', 'text']);
  assert.deepEqual(await reviewDocumentPages({ model, title: 'x', pages: null, signal: new AbortController().signal }), { status: 'skipped', reason: 'Este entorno no puede convertir el documento en imágenes.' });
});

test('the pages are rasterized from the PDF when the machine has pdftoppm', { skip: !existsSync('/usr/bin/pdftoppm') }, async () => {
  const produced = await produceDocument(doc([para(40)]), { formats: ['pdf'] });
  const pages = await rasterizePages({ pdf: produced.pdf, svgs: produced.svgs });
  assert.ok(pages && pages.length === produced.pages);
  assert.deepEqual([...pages![0].slice(0, 4)], [137, 80, 78, 71]);
  assert.ok(bodyHeight(THEMES.antonia) > 200);
});

test('a machine that draws no text is told apart from one that does, so pages with no words are never given to the reviewer', async () => {
  assert.equal(await drawsText(async () => new Uint8Array(4_800).fill(255)), false);
  assert.equal(await drawsText(async () => Uint8Array.from({ length: 4_800 }, (_, index) => (index % 7 === 0 ? 0 : 255))), true);
  assert.equal(await drawsText(async () => { throw new Error('sharp is not installed'); }), false);
});

test('the pages are rasterized from the SVG previews when there is no PDF rasterizer, on a machine that draws text', { skip: !await drawsText() }, async () => {
  const produced = await produceDocument(doc([para(40)]), { formats: ['pdf'] });
  const pages = await rasterizePages({ svgs: produced.svgs });
  assert.ok(pages && pages.length === produced.pages);
  assert.deepEqual([...pages![0].slice(0, 4)], [137, 80, 78, 71]);
});

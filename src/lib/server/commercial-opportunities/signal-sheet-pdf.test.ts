import assert from 'node:assert/strict';
import test from 'node:test';
import { SECTION_TITLES, buildSignalSheet, sheetSections, type SignalSheet } from '@/lib/commercial-opportunities/signal-sheet';
import { NOW, brief, hiringItem, postItem, report } from '@/lib/commercial-opportunities/signal-sheet-fixtures';
import { normalizeCoworkPdfText } from '@/lib/server/cowork/file-exports';
import { drawSignalSheet, signalSheetPdf, type Pen, type SheetPdfOptions } from './signal-sheet-pdf';

type Text = { value: string; x: number; y: number; size: number; bold: boolean; align: string; page: number; link?: string };
type Rect = { x: number; y: number; w: number; h: number; fill?: number[]; page: number };

/** A pen that only remembers what was drawn, with a width for text close to Helvetica's (a little wide, so a fit here is a fit on paper). */
function recorder() {
  const texts: Text[] = [], rects: Rect[] = [], links: string[] = [];
  const MM = 0.3528;
  const widthOf = (value: string, size: number, bold: boolean) => value.length * size * MM * (bold ? 0.56 : 0.52);
  const pen: Pen = {
    left: 16, right: 194, top: 18, bottom: 280, width: 178, y: 18, page: 1,
    wrap: (value, size, bold, width) => {
      const lines: string[] = [];
      for (const paragraph of value.split('\n')) {
        let line = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
          const next = line ? `${line} ${word}` : word;
          if (line && widthOf(next, size, bold) > width) { lines.push(line); line = word; } else line = next;
        }
        lines.push(line);
      }
      return lines;
    },
    text: (value, x, y, o = {}) => { texts.push({ value, x, y, size: o.size ?? 10, bold: Boolean(o.bold), align: o.align ?? 'left', page: pen.page, link: o.link }); if (o.link) links.push(o.link); },
    rect: (x, y, w, h, o = {}) => { rects.push({ x, y, w, h, fill: o.fill, page: pen.page }); },
    line: () => {}, dot: () => {}, link: (_x, _y, _w, _h, url) => { links.push(url); },
    newPage: () => { pen.page++; },
  };
  const span = (text: Text) => {
    const width = widthOf(text.value, text.size, text.bold);
    return text.align === 'right' ? [text.x - width, text.x] : text.align === 'center' ? [text.x - width / 2, text.x + width / 2] : [text.x, text.x + width];
  };
  return { pen, texts, rects, links, span, widthOf, get drawn() { return texts.map(text => text.value).join(' ').replace(/\s+/g, ' '); } };
}

const sheetOf = (extra: Record<string, unknown> = {}) => buildSignalSheet({ item: hiringItem(), report: report(), now: NOW, contactsCount: 0, ...extra })!;
const draw = (sheet: SignalSheet, options?: SheetPdfOptions) => { const r = recorder(); drawSignalSheet(r.pen, sheet, options); return r; };
const seen = (drawn: string, value: string) => drawn.includes(normalizeCoworkPdfText(value).replace(/\s+/g, ' ').trim());

test('everything on the sheet of a company that is hiring is on the PDF', () => {
  const sheet = sheetOf();
  const { drawn } = draw(sheet);
  const expected = [
    sheet.title, sheet.kindLabel, sheet.relation!.label, sheet.decision!.label, sheet.headline, sheet.executive!, ...sheet.whyNow, ...sheet.nextSteps, ...sheet.warnings,
    ...sheet.pulse.kpis.flatMap(kpi => [kpi.value, kpi.label, ...(kpi.note ? [kpi.note] : [])]),
    ...(sheet.pulse.kind === 'hiring' ? [...sheet.pulse.roles.map(bar => bar.label), ...sheet.pulse.regions.map(bar => bar.label), sheet.pulse.window] : []),
    ...sheet.fit.services.flatMap(service => [service.service, service.why]), ...sheet.fit.gaps,
    sheet.company.summary!, ...sheet.company.facts.flatMap(fact => [fact.label, fact.value]),
    ...sheet.buyers.flatMap(buyer => [buyer.title, buyer.why]),
    sheet.approach!.angle, ...sheet.approach!.hooks, ...sheet.approach!.avoid,
    ...sheet.messages.flatMap(message => [message.channelLabel, message.subject, ...message.body.split('\n').filter(Boolean)]),
    ...sheet.cadence.map(step => step.action), ...sheet.objections.flatMap(item => [item.objection, item.answer]),
    ...sheet.validate.map(item => item.title), ...sheet.plan.map(item => item.title), ...sheet.risks.flatMap(risk => [risk.title, risk.mitigation]), ...sheet.questions,
    ...sheet.sample.map(ad => ad.title),
  ].filter(Boolean);
  for (const value of expected) assert.ok(seen(drawn, value), `missing from the PDF: ${value.slice(0, 80)}`);
  for (const id of sheetSections(sheet).filter(entry => entry !== 'summary')) assert.ok(seen(drawn, SECTION_TITLES[id]), `section title missing: ${id}`);
});

test('the sections come in the order the page shows them, one title each', () => {
  const sheet = sheetOf();
  const { texts } = draw(sheet);
  const known = new Set<string>(Object.values(SECTION_TITLES));
  const titles = texts.filter(text => text.size === 13 && text.bold && known.has(text.value)).map(text => text.value);
  assert.deepEqual(titles, sheetSections(sheet).filter(id => id !== 'summary').map(id => SECTION_TITLES[id]));
});

test('nothing is drawn outside the margins or past the foot of the page', () => {
  for (const sheet of [sheetOf(), sheetOf({ report: null }), buildSignalSheet({ item: postItem(), report: report(), now: NOW })!, buildSignalSheet({ item: postItem(), now: NOW })!]) {
    const { texts, span, pen } = draw(sheet);
    for (const text of texts) {
      const [from, to] = span(text);
      assert.ok(from >= pen.left - 0.5 && to <= pen.right + 0.5, `text outside the margins (${from.toFixed(1)}-${to.toFixed(1)}): ${text.value.slice(0, 60)}`);
      assert.ok(text.y >= 0 && text.y + text.size * 0.3528 <= pen.bottom + 0.5, `text past the foot of page ${text.page}: ${text.value.slice(0, 60)}`);
    }
  }
});

test('a title is never left alone at the foot of a page, wherever the page breaks fall', () => {
  const titles = new Set<string>(Object.values(SECTION_TITLES));
  const sheets = (padding: number) => {
    const extra = Array.from({ length: padding }, () => 'Un dato más para mover el salto de página.').join(' ');
    return [sheetOf(), sheetOf({ report: null }), buildSignalSheet({ item: postItem(), report: report(), now: NOW })!].map(sheet => ({ ...sheet, executive: `${sheet.executive ?? ''} ${extra}`.trim() }));
  };
  for (let padding = 0; padding <= 60; padding += 3) {
    for (const sheet of sheets(padding)) {
      const { texts } = draw(sheet);
      texts.forEach((text, index) => {
        if (text.size === 13 && text.bold && titles.has(text.value)) assert.equal(texts[index + 1]?.page, text.page, `«${text.value}» is the last thing on its page (padding ${padding})`);
      });
    }
  }
});

test('the PDF draws the team ticks and notes and the links the page has', () => {
  const sheet = sheetOf();
  const ticked = draw(sheet, { done: (kind, text) => kind === 'step' && text === sheet.nextSteps[0], notes: [{ label: 'Primer contacto', note: 'Llamar el lunes', by: 'Ana' }] });
  const plain = draw(sheet);
  const GREEN = (rect: Rect) => rect.fill?.join() === '5,150,105';
  assert.equal(ticked.rects.filter(GREEN).length - plain.rects.filter(GREEN).length, 1, 'one box ticked');
  assert.ok(seen(ticked.drawn, 'Notas del equipo') && seen(ticked.drawn, 'Llamar el lunes') && seen(ticked.drawn, 'Ana'));
  assert.ok(!seen(plain.drawn, 'Notas del equipo'));
  assert.ok(plain.links.some(url => url.startsWith('https://www.linkedin.com/search/results/people/')), 'a LinkedIn search for each buyer');
  assert.ok(plain.links.includes(sheet.links[0].url) && plain.links.includes(sheet.sample[0].url!));
});

test('before the report is written the PDF is the pulse and says what is missing', () => {
  const sheet = sheetOf({ report: null });
  const { drawn } = draw(sheet, { radarDate: '20 oct 2026' });
  assert.ok(seen(drawn, 'Datos del radar al 20 oct 2026'));
  assert.ok(seen(drawn, SECTION_TITLES.pending));
  for (const item of sheet.completeness.items.filter(entry => !entry.done)) assert.ok(seen(drawn, item.label));
  assert.ok(!seen(drawn, SECTION_TITLES.messages));
});

test('the sheet of a LinkedIn post draws the post as a quote', () => {
  const sheet = buildSignalSheet({ item: postItem(), report: report(), now: NOW })!;
  const { drawn, texts } = draw(sheet);
  assert.ok(seen(drawn, sheet.pulse.kind === 'post' ? sheet.pulse.post.text : ''));
  assert.ok(texts.some(text => text.value.includes(sheet.title) && text.size === 8.5 && text.bold), 'who wrote it, when');
});

test('a long text runs over pages without leaving the margins, and a bigger sheet takes more pages', () => {
  const base = sheetOf();
  const long: SignalSheet = { ...base, messages: [{ channel: 'email', channelLabel: 'Correo', subject: 'Largo', body: Array.from({ length: 60 }, (_, index) => `Línea ${index + 1} de un correo muy largo que sigue y sigue.`).join('\n') }] };
  const small = draw(base), big = draw(long);
  assert.ok(big.pen.page > small.pen.page);
  assert.ok(seen(big.drawn, 'Línea 60 de un correo muy largo'));
  for (const text of big.texts) assert.ok(text.y + text.size * 0.3528 <= big.pen.bottom + 0.5, `past the foot: ${text.value.slice(0, 40)}`);
});

test('emoji and symbols the font cannot print are left out instead of failing the download', async () => {
  const base = buildSignalSheet({ item: { ...postItem(), data: { ...postItem().data, description: '🚀 Buscamos conductores ✅ clase A4 — urgente… 📍Quilicura' } }, now: NOW })!;
  const { drawn } = draw(base);
  assert.ok(seen(drawn, 'Buscamos conductores clase A4 - urgente... Quilicura'));
  const bytes = await signalSheetPdf(base);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('the real PDF is a PDF with a footer on every page, for a sheet with and without the written plan', async () => {
  for (const sheet of [sheetOf(), sheetOf({ report: null }), buildSignalSheet({ item: postItem(), now: NOW })!]) {
    const bytes = await signalSheetPdf(sheet);
    const text = new TextDecoder('latin1').decode(bytes);
    assert.equal(text.slice(0, 5), '%PDF-');
    const pages = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
    assert.ok(pages >= 1);
    assert.equal((text.match(/gina \d+ de \d+/g) ?? []).length, pages, 'a footer on every page');
    assert.ok(bytes.length > 4000);
  }
  void brief;
});

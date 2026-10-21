// The PDF backend: the pages the layout engine laid out, written with jsPDF (standard fonts, so the file is small and opens everywhere).
// jsPDF also measures the text for the layout, so a line breaks where it is drawn. The standard fonts cover Western European text: the
// characters outside them are replaced by their plain equivalent (a typographic quote, an arrow) or, if there is none, by «?», and each
// replacement is reported so the document can say what it lost.
import { layoutDocument, type Font, type Layout, type LayoutOptions, type Measure } from './layout';
import type { DocBlock, DocumentSpec, ListItem, Run } from './spec';
import type { RGB } from './theme';

type Pdf = InstanceType<typeof import('jspdf').jsPDF>;

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[‘’′]/g, "'"], [/[“”″]/g, '"'], [/[–—−‑]/g, '-'], [/…/g, '...'], [/[•▪●]/g, '-'], [/\t/g, '    '],
  [/[→⇒➜➔]/g, '->'], [/←/g, '<-'], [/≥/g, '>='], [/≤/g, '<='], [/≠/g, '!='], [/≈/g, '~'], [/€/g, 'EUR'], [/[✓✔☑]/g, 'ok'], [/[✗✘☒]/g, 'x'],
  [/[​﻿‌‍]/g, ''], [/ /g, ' '],
];

/** Text the standard fonts can draw, and how many characters had no equivalent. */
export function pdfSafeText(value: string): { text: string; lost: number } {
  let text = value.normalize('NFC');
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  let lost = 0;
  text = text.replace(/[^\x20-\x7e\xa0-\xff\n\r]/gu, () => { lost += 1; return '?'; });
  return { text, lost };
}

const safeRuns = (runs: Run[], counter: { lost: number }): Run[] => runs.map(run => { const { text, lost } = pdfSafeText(run.text); counter.lost += lost; return { ...run, text }; });
const safeItems = (items: ListItem[], counter: { lost: number }): ListItem[] => items.map(item => ({ runs: safeRuns(item.runs, counter), sub: item.sub && safeItems(item.sub, counter) }));
const safeString = (value: string | undefined, counter: { lost: number }) => { if (value === undefined) return undefined; const { text, lost } = pdfSafeText(value); counter.lost += lost; return text; };

/** The spec with every text the PDF can draw, and the number of characters replaced by «?». */
export function pdfSafeSpec(spec: DocumentSpec): { spec: DocumentSpec; lost: number } {
  const counter = { lost: 0 };
  const blocks = spec.blocks.map((block): DocBlock => {
    switch (block.type) {
      case 'heading': case 'paragraph': return { ...block, runs: safeRuns(block.runs, counter) };
      case 'quote': return { ...block, runs: safeRuns(block.runs, counter), cite: safeString(block.cite, counter) };
      case 'list': return { ...block, items: safeItems(block.items, counter) };
      case 'table': return { ...block, caption: safeString(block.caption, counter), columns: block.columns.map(column => ({ ...column, header: safeRuns(column.header, counter) })), rows: block.rows.map(row => row.map(cell => safeRuns(cell, counter))) };
      case 'callout': return { ...block, title: safeString(block.title, counter), runs: safeRuns(block.runs, counter) };
      case 'figures': return { ...block, items: block.items.map(item => ({ value: safeString(item.value, counter)!, label: safeString(item.label, counter)!, detail: safeString(item.detail, counter) })) };
      case 'code': return { ...block, text: safeString(block.text, counter)! };
      case 'bars': return { ...block, title: safeString(block.title, counter), unit: safeString(block.unit, counter), items: block.items.map(item => ({ ...item, label: safeString(item.label, counter)! })) };
      default: return block;
    }
  });
  const safe: DocumentSpec = {
    ...spec, title: safeString(spec.title, counter)!, subtitle: safeString(spec.subtitle, counter), kicker: safeString(spec.kicker, counter),
    runningTitle: safeString(spec.runningTitle, counter), brand: safeString(spec.brand, counter),
    meta: spec.meta?.map(item => ({ label: safeString(item.label, counter)!, value: safeString(item.value, counter)! })), blocks,
  };
  return { spec: safe, lost: counter.lost };
}

const styleOf = (font: Font) => (font.bold && font.italic ? 'bolditalic' : font.bold ? 'bold' : font.italic ? 'italic' : 'normal');

export async function createPdfMeasurer(): Promise<{ pdf: Pdf; measure: Measure }> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const measure: Measure = (text, font, size) => {
    pdf.setFont(font.family, styleOf(font));
    pdf.setFontSize(size);
    return pdf.getTextWidth(text);
  };
  return { pdf, measure };
}

const color = (target: (r: number, g: number, b: number) => unknown, value: RGB) => target(value[0], value[1], value[2]);

/** Writes the laid out pages into a PDF. */
export function writePdf(pdf: Pdf, layout: Layout): Uint8Array {
  pdf.setProperties({ title: layout.spec.title, creator: layout.spec.brand || 'ANTON.IA', subject: layout.spec.subtitle || '' });
  layout.pages.forEach((page, index) => {
    if (index > 0) pdf.addPage();
    for (const op of page.ops) {
      if (op.t === 'rect') {
        if (op.fill) color(pdf.setFillColor.bind(pdf), op.fill);
        if (op.stroke) { color(pdf.setDrawColor.bind(pdf), op.stroke); pdf.setLineWidth(op.lineWidth ?? 0.2); }
        const mode = op.fill && op.stroke ? 'FD' : op.fill ? 'F' : 'S';
        if (op.radius) pdf.roundedRect(op.x, op.y, op.w, op.h, op.radius, op.radius, mode); else pdf.rect(op.x, op.y, op.w, op.h, mode);
      } else if (op.t === 'line') {
        color(pdf.setDrawColor.bind(pdf), op.color);
        pdf.setLineWidth(op.width);
        pdf.line(op.x1, op.y1, op.x2, op.y2);
      } else if (op.t === 'circle') {
        color(pdf.setFillColor.bind(pdf), op.fill);
        pdf.circle(op.x, op.y, op.r, 'F');
      } else {
        pdf.setFont(op.font.family, styleOf(op.font));
        pdf.setFontSize(op.size);
        color(pdf.setTextColor.bind(pdf), op.color);
        pdf.text(op.text, op.x, op.y);
        const width = pdf.getTextWidth(op.text);
        if (op.underline) { color(pdf.setDrawColor.bind(pdf), op.color); pdf.setLineWidth(0.15); pdf.line(op.x, op.y + 0.6, op.x + width, op.y + 0.6); }
        if (op.href) pdf.link(op.x, op.y - op.size * 0.3528, width, op.size * 0.3528 * 1.25, { url: op.href });
      }
    }
  });
  return new Uint8Array(pdf.output('arraybuffer'));
}

/** Lays the spec out and writes it, in one go (no inspection: see pipeline.ts for the whole circuit). */
export async function renderPdf(spec: DocumentSpec, options: LayoutOptions = {}): Promise<{ bytes: Uint8Array; layout: Layout; lost: number }> {
  const safe = pdfSafeSpec(spec);
  const { pdf, measure } = await createPdfMeasurer();
  const layout = layoutDocument(safe.spec, measure, options);
  return { bytes: writePdf(pdf, layout), layout, lost: safe.lost };
}

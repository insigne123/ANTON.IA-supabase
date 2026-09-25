import { z } from 'zod';
import { coworkDocumentSchema, type CoworkEvent } from '@/lib/cowork/contracts';
import { buildCoworkLeadCsv, collectCoworkLeadRows, coworkLeadColumns } from '@/lib/cowork/lead-export';
import { markdownInlineText, parseMarkdown, type MdBlock, type MdInline } from '@/lib/cowork/markdown';

export const coworkExportFormat = z.enum(['csv', 'xlsx', 'pdf', 'md']);
export type CoworkExportFormat = z.infer<typeof coworkExportFormat>;
export class CoworkExportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function getDocument(events: CoworkEvent[]) {
  const payload = events.slice().reverse().find(event => event.kind === 'run.completed')?.payload;
  const parsed = coworkDocumentSchema.safeParse(payload ? { reply: payload.reply, document: payload.document } : null);
  if (!parsed.success || !parsed.data.document) throw new CoworkExportError('Este trabajo no tiene un documento para descargar.', 404);
  return parsed.data.document;
}

/** Core PDF fonts support Western European text. Fail explicitly on unsupported glyphs. */
export function normalizeCoworkPdfText(text: string) {
  const normalized = text.normalize('NFC').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
    .replace(/[–—−‑]/g, '-').replace(/…/g, '...').replace(/•/g, '-').replace(/\t/g, '    ')
    .replace(/[→⇒➜]/g, '->').replace(/←/g, '<-').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '!=')
    .replace(/≈/g, '~').replace(/€/g, 'EUR').replace(/[✓✔]/g, '-').replace(/[✗✘]/g, 'x').replace(/​|﻿/g, '');
  if (/[^\x20-\x7e\xa0-\xff\n\r]/.test(normalized)) {
    throw new CoworkExportError('Este documento contiene caracteres que todavía no admite el PDF. Descárgalo en Markdown para conservarlos.', 422);
  }
  return normalized;
}

/** Download name from the document title: «Informe de métricas» -> informe-de-metricas. */
export function coworkExportFilename(title: string, extension: string) {
  const slug = String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return `${slug || 'cowork-documento'}.${extension}`;
}

type PdfRun = { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean; href?: string };
type PdfPiece = { text: string; run: PdfRun; width: number };
type JsPdf = InstanceType<typeof import('jspdf').jsPDF>;

function pdfRuns(nodes: MdInline[], style: Omit<PdfRun, 'text'> = {}): PdfRun[] {
  const runs: PdfRun[] = [];
  for (const node of nodes) {
    if (node.type === 'text') runs.push({ ...style, text: node.value });
    else if (node.type === 'code') runs.push({ ...style, code: true, text: node.value });
    else if (node.type === 'br') runs.push({ ...style, text: '\n' });
    else if (node.type === 'strong') runs.push(...pdfRuns(node.children, { ...style, bold: true }));
    else if (node.type === 'em') runs.push(...pdfRuns(node.children, { ...style, italic: true }));
    else if (node.type === 'del') runs.push(...pdfRuns(node.children, { ...style, strike: true }));
    else if (node.type === 'link') runs.push(...pdfRuns(node.children, { ...style, href: node.href }));
  }
  return runs;
}

/** Renders the same Markdown AST the workspace shows: headings, lists, quotes, code and tables. */
function renderCoworkPdf(pdf: JsPdf, title: string, blocks: MdBlock[]) {
  const left = 20;
  const width = 170;
  const top = 22;
  const bottom = 276;
  const pt = 0.3528;
  let y = top;
  const ink = [31, 29, 26] as const;
  const muted = [106, 101, 92] as const;
  const accent = [164, 80, 31] as const;

  const setFont = (run: PdfRun, size: number) => {
    const style = run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal';
    pdf.setFont(run.code ? 'courier' : 'helvetica', run.code ? (run.bold ? 'bold' : 'normal') : style);
    pdf.setFontSize(run.code ? size * 0.92 : size);
  };
  const ensure = (height: number) => {
    if (y + height > bottom) { pdf.addPage(); y = top; return true; }
    return false;
  };
  const layout = (runs: PdfRun[], size: number, maxWidth: number): PdfPiece[][] => {
    const lines: PdfPiece[][] = [[]];
    let lineWidth = 0;
    const push = (piece: PdfPiece) => { lines[lines.length - 1].push(piece); lineWidth += piece.width; };
    const newline = () => { lines.push([]); lineWidth = 0; };
    for (const run of runs) {
      run.text.split('\n').forEach((segment, index) => {
        if (index > 0) newline();
        setFont(run, size);
        for (const token of segment.match(/\S+\s*|\s+/g) || []) {
          const tokenWidth = pdf.getTextWidth(token);
          if (lineWidth + tokenWidth > maxWidth && lineWidth > 0) {
            newline();
            if (!token.trim()) continue;
          }
          if (tokenWidth <= maxWidth) { push({ text: token, run, width: tokenWidth }); continue; }
          let chunk = '';
          for (const char of token) {
            if (pdf.getTextWidth(chunk + char) > maxWidth && chunk) {
              push({ text: chunk, run, width: pdf.getTextWidth(chunk) });
              newline();
              chunk = char;
            } else chunk += char;
          }
          if (chunk) push({ text: chunk, run, width: pdf.getTextWidth(chunk) });
        }
      });
    }
    return lines;
  };
  const drawLine = (line: PdfPiece[], x: number, baseline: number, size: number, color: readonly number[]) => {
    let cursor = x;
    for (const piece of line) {
      setFont(piece.run, size);
      const tone = piece.run.href ? accent : color;
      pdf.setTextColor(tone[0], tone[1], tone[2]);
      pdf.text(piece.text, cursor, baseline);
      const visible = piece.text.trimEnd();
      const visibleWidth = visible === piece.text ? piece.width : pdf.getTextWidth(visible);
      if (piece.run.strike) {
        pdf.setDrawColor(tone[0], tone[1], tone[2]);
        pdf.line(cursor, baseline - size * pt * 0.3, cursor + visibleWidth, baseline - size * pt * 0.3);
      }
      if (piece.run.href && visible) pdf.link(cursor, baseline - size * pt * 0.8, visibleWidth, size * pt, { url: piece.run.href });
      cursor += piece.width;
    }
  };
  const paragraph = (runs: PdfRun[], options: { size?: number; indent?: number; color?: readonly number[]; after?: number } = {}) => {
    const size = options.size ?? 10.5;
    const indent = options.indent ?? 0;
    const lineHeight = size * pt * 1.5;
    for (const line of layout(runs, size, width - indent)) {
      ensure(lineHeight);
      drawLine(line, left + indent, y + size * pt, size, options.color ?? ink);
      y += lineHeight;
    }
    y += options.after ?? 2.2;
  };

  const drawTable = (block: Extract<MdBlock, { type: 'table' }>, indent: number) => {
    const columns = block.header.length;
    const size = 8.8;
    const pad = 1.8;
    const available = width - indent;
    const natural = Array.from({ length: columns }, () => 12);
    const measure = (cells: MdInline[][], bold: boolean) => cells.forEach((cell, column) => {
      const text = markdownInlineText(cell).split('\n').reduce((longest, part) => part.length > longest.length ? part : longest, '');
      setFont({ text, bold }, size);
      natural[column] = Math.max(natural[column], Math.min(pdf.getTextWidth(text) + pad * 2, 90));
    });
    measure(block.header, true);
    block.rows.forEach(row => measure(row, false));
    const total = natural.reduce((sum, value) => sum + value, 0);
    let widths = natural.map(value => value * available / total);
    if (total > available) {
      widths = natural.map(value => Math.max(16, value * available / total));
      const scale = available / widths.reduce((sum, value) => sum + value, 0);
      widths = widths.map(value => value * scale);
    }
    const lineHeight = size * pt * 1.35;
    const drawRow = (cells: MdInline[][], header: boolean): void => {
      const layouts = cells.map((cell, column) => layout(pdfRuns(cell, header ? { bold: true } : {}), size, widths[column] - pad * 2).slice(0, 30));
      const height = Math.max(1, ...layouts.map(lines => lines.length)) * lineHeight + pad * 2;
      if (ensure(height) && !header) drawRow(block.header, true);
      if (header) {
        pdf.setFillColor(243, 240, 233);
        pdf.rect(left + indent, y, available, height, 'F');
      }
      let x = left + indent;
      layouts.forEach((lines, column) => {
        let baseline = y + pad + size * pt;
        for (const line of lines) {
          const lineWidth = line.reduce((sum, piece) => sum + piece.width, 0);
          const offset = block.align[column] === 'right' ? widths[column] - pad * 2 - lineWidth
            : block.align[column] === 'center' ? (widths[column] - pad * 2 - lineWidth) / 2 : 0;
          drawLine(line, x + pad + Math.max(0, offset), baseline, size, header ? ink : ink);
          baseline += lineHeight;
        }
        x += widths[column];
      });
      pdf.setDrawColor(224, 219, 208);
      pdf.setLineWidth(header ? 0.35 : 0.2);
      pdf.line(left + indent, y + height, left + indent + available, y + height);
      y += height;
    };
    y += 1;
    drawRow(block.header, true);
    block.rows.forEach(row => drawRow(row, false));
    y += 4;
  };

  const renderBlocks = (items: MdBlock[], indent: number, color: readonly number[] = ink) => {
    for (const block of items) {
      if (block.type === 'heading') {
        const size = block.level === 1 ? 16 : block.level === 2 ? 13.5 : block.level === 3 ? 12 : 11;
        y += block.level <= 2 ? 3 : 2;
        ensure(size * pt * 3);
        paragraph(pdfRuns(block.children, { bold: true }), { size, indent, color: ink, after: block.level <= 2 ? 1.6 : 1 });
      } else if (block.type === 'paragraph') {
        paragraph(pdfRuns(block.children), { indent, color });
      } else if (block.type === 'list') {
        block.items.forEach((item, position) => {
          const markerIndent = indent + 1.5;
          const contentIndent = indent + 7;
          const [first, ...rest] = item.children;
          const firstRuns = first && (first.type === 'paragraph' || first.type === 'heading') ? pdfRuns(first.children) : [];
          const size = 10.5;
          ensure(size * pt * 1.5);
          const markerBaseline = y + size * pt;
          pdf.setTextColor(color[0], color[1], color[2]);
          if (item.checked !== null) {
            pdf.setDrawColor(muted[0], muted[1], muted[2]);
            pdf.setLineWidth(0.25);
            pdf.rect(left + markerIndent, markerBaseline - 2.8, 3, 3);
            if (item.checked) {
              pdf.line(left + markerIndent + 0.6, markerBaseline - 1.3, left + markerIndent + 1.3, markerBaseline - 0.5);
              pdf.line(left + markerIndent + 1.3, markerBaseline - 0.5, left + markerIndent + 2.5, markerBaseline - 2.4);
            }
          } else if (block.ordered) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(size);
            pdf.text(`${block.start + position}.`, left + markerIndent, markerBaseline);
          } else {
            pdf.setFillColor(color[0], color[1], color[2]);
            pdf.circle(left + markerIndent + 1.1, markerBaseline - 1.2, 0.55, 'F');
          }
          if (firstRuns.length) paragraph(firstRuns, { indent: contentIndent, color, after: 0.8 });
          else if (first) renderBlocks([first], contentIndent, color);
          if (rest.length) renderBlocks(rest, contentIndent, color);
        });
        y += 1.4;
      } else if (block.type === 'blockquote') {
        const start = y;
        const startPage = pdf.getNumberOfPages();
        renderBlocks(block.children, indent + 5, muted);
        if (pdf.getNumberOfPages() === startPage) {
          pdf.setFillColor(214, 208, 194);
          pdf.rect(left + indent + 1, start, 0.8, Math.max(2, y - start - 2), 'F');
        }
      } else if (block.type === 'code') {
        const size = 8.6;
        const lineHeight = size * pt * 1.45;
        const lines = layout([{ text: block.value, code: true }], size, width - indent - 6);
        y += 1;
        for (const line of lines) {
          ensure(lineHeight + 1);
          pdf.setFillColor(245, 243, 238);
          pdf.rect(left + indent, y, width - indent, lineHeight + 0.6, 'F');
          drawLine(line, left + indent + 3, y + size * pt + 0.4, size, ink);
          y += lineHeight;
        }
        y += 4;
      } else if (block.type === 'table') {
        drawTable(block, indent);
      } else if (block.type === 'hr') {
        ensure(6);
        pdf.setDrawColor(224, 219, 208);
        pdf.setLineWidth(0.3);
        pdf.line(left + indent, y + 2, left + width, y + 2);
        y += 6;
      }
    }
  };

  paragraph([{ text: title, bold: true }], { size: 19, color: ink, after: 1.5 });
  pdf.setDrawColor(accent[0], accent[1], accent[2]);
  pdf.setLineWidth(0.6);
  pdf.line(left, y, left + 18, y);
  y += 7;
  renderBlocks(blocks, 0);

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(muted[0], muted[1], muted[2]);
    pdf.text(`ANTON.IA Cowork | ${page} / ${pages}`, left, 287);
  }
}

export async function buildCoworkFile(events: CoworkEvent[], format: CoworkExportFormat) {
  const observations = events.filter(event => event.kind === 'tool.completed').map(event => event.payload);
  if (format === 'csv') {
    const csv = buildCoworkLeadCsv(observations);
    if (!csv) throw new CoworkExportError('Este trabajo no tiene contactos para exportar.', 404);
    return { bytes: new TextEncoder().encode(csv), mime: 'text/csv; charset=utf-8', filename: 'cowork-contactos.csv' };
  }
  if (format === 'xlsx') {
    const rows = collectCoworkLeadRows(observations);
    if (!rows.length) throw new CoworkExportError('Este trabajo no tiene contactos para exportar.', 404);
    const XLSX = await import('xlsx');
    // Explicit string cells preserve IDs, phones and formula-looking text as data.
    const data = [coworkLeadColumns.map(String), ...rows.map(row => coworkLeadColumns.map(column => String(row[column] ?? '')))];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet['!cols'] = coworkLeadColumns.map(column => ({ wch: column === 'id' ? 38 : column === 'email' ? 36 : 26 }));
    sheet['!autofilter'] = { ref: sheet['!ref']! };
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Contactos');
    return { bytes: new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true })),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'cowork-contactos.xlsx' };
  }

  const document = getDocument(events);
  if (format === 'md') return { bytes: new TextEncoder().encode(document.content), mime: 'text/markdown; charset=utf-8', filename: coworkExportFilename(document.title, 'md') };
  const title = normalizeCoworkPdfText(document.title);
  const content = normalizeCoworkPdfText(document.content).replace(/\r\n?/g, '\n');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title, creator: 'ANTON.IA Cowork' });
  renderCoworkPdf(pdf, title, parseMarkdown(content));
  return { bytes: new Uint8Array(pdf.output('arraybuffer')), mime: 'application/pdf', filename: coworkExportFilename(document.title, 'pdf') };
}

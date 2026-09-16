import { z } from 'zod';
import { coworkDocumentSchema, type CoworkEvent } from '@/lib/cowork/contracts';
import { buildCoworkLeadCsv, collectCoworkLeadRows, coworkLeadColumns } from '@/lib/cowork/lead-export';

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
  const normalized = text.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/•/g, '-').replace(/\t/g, '    ');
  if (/[^\x20-\x7e\xa0-\xff\n\r]/.test(normalized)) {
    throw new CoworkExportError('Este documento contiene caracteres que todavía no admite el PDF. Descárgalo en Markdown para conservarlos.', 422);
  }
  return normalized;
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
  if (format === 'md') return { bytes: new TextEncoder().encode(document.content), mime: 'text/markdown; charset=utf-8', filename: 'cowork-documento.md' };
  const title = normalizeCoworkPdfText(document.title);
  const content = normalizeCoworkPdfText(document.content).replace(/\r\n?/g, '\n');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title, creator: 'ANTON.IA Cowork' });
  let y = 22;
  const bottom = 275;
  function print(text: string, size: number, bold = false) {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(text || ' ', 170);
    const height = size * 0.3528 * 1.45;
    for (const line of lines) {
      if (y + height > bottom) { pdf.addPage(); y = 22; }
      pdf.text(line, 20, y);
      y += height;
    }
  }
  print(title, 18, true); y += 5;
  for (const line of content.split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { y += 2; print(heading[2], heading[1].length < 3 ? 14 : 12, true); }
    else print(line, 11);
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text(`ANTON.IA Cowork | ${page} / ${pages}`, 20, 287);
  }
  return { bytes: new Uint8Array(pdf.output('arraybuffer')), mime: 'application/pdf', filename: 'cowork-documento.pdf' };
}

import { z } from 'zod';
import { coworkChartCsv, coworkChartRows, coworkMetricsCsv, coworkMetricsRows, coworkTableCsv } from '@/lib/cowork/blocks';
import { coworkBlockSchema, type CoworkBlock } from '@/lib/cowork/contracts';
import { COWORK_BLOCK_FORMATS, type CoworkFileFormat } from '@/lib/cowork/export-formats';
import type { MdBlock, MdInline } from '@/lib/cowork/markdown';
import { COWORK_MIME, CoworkExportError, coworkExportFilename, coworkPdfBytes, mapCoworkMarkdownText, normalizeCoworkPdfText } from './file-exports';

/**
 * A card of the chat as a file (plan 2, F3): a table, a chart or a set of figures as a spreadsheet,
 * an email or a sequence as Word or PDF. The card comes from the page, as the person sees it (an
 * edited email is the edited one), and goes back as a file: nothing is read from the database and
 * nothing is stored. The card is checked with the same schema the answers use, so its size is
 * already bounded; the request is bounded too.
 */

export const COWORK_EXPORT_BODY_LIMIT = 2 * 1024 * 1024;

const requestSchema = z.object({ format: z.enum(['xlsx', 'csv', 'docx', 'pdf']), block: coworkBlockSchema }).strict();

/** The body of a download request, checked: the card and the format it is asked in. */
export function coworkBlockExportRequest(text: string): { format: Exclude<CoworkFileFormat, 'md'>; block: CoworkBlock } {
  if (text.length > COWORK_EXPORT_BODY_LIMIT) throw new CoworkExportError('El contenido es demasiado grande para descargarlo.', 413);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new CoworkExportError('La solicitud no es válida.', 400); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new CoworkExportError('La solicitud no es válida.', 400);
  const { format, block } = parsed.data;
  if (!COWORK_BLOCK_FORMATS[block.type].includes(format)) throw new CoworkExportError('Este resultado no se puede descargar en ese formato.', 400);
  return { format, block };
}

type Cell = string | number;

const FALLBACK_NAME: Record<CoworkBlock['type'], string> = {
  table: 'cowork-tabla', chart: 'cowork-grafico', metrics: 'cowork-cifras', email_draft: 'cowork-correo', sequence: 'cowork-secuencia',
};

/** An Excel sheet name: at most 31 characters and none of `\ / ? * [ ] :`. */
function sheetName(title: string, fallback: string) {
  return title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31).trim() || fallback;
}

/** What a card holds as rows: text stays text (so a code or a formula-looking value is data), figures of a chart stay numbers. */
function sheetRows(block: Extract<CoworkBlock, { type: 'table' | 'chart' | 'metrics' }>): Cell[][] {
  if (block.type === 'table') return [block.columns, ...block.rows];
  if (block.type === 'metrics') return coworkMetricsRows(block);
  return [[block.period ? `${block.title} (${block.period})` : block.title, ...block.series.map(series => block.unit ? `${series.name} (${block.unit})` : series.name)],
    ...coworkChartRows(block).map(row => row.map(value => typeof value === 'number' ? value : String(value ?? '')))];
}

async function spreadsheetBytes(block: Extract<CoworkBlock, { type: 'table' | 'chart' | 'metrics' }>) {
  const rows = sheetRows(block);
  const XLSX = await import('xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const columns = Math.max(0, ...rows.map(row => row.length));
  sheet['!cols'] = Array.from({ length: columns }, (_, column) => ({
    wch: Math.min(60, Math.max(10, ...rows.map(row => String(row[column] ?? '').length + 2))),
  }));
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName(block.title, 'Hoja1'));
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }));
}

const text = (value: string): MdInline => ({ type: 'text', value });
const lines = (value: string): MdInline[] => value.replace(/\r\n?/g, '\n').split('\n').flatMap((line, index): MdInline[] => index ? [{ type: 'br' }, text(line)] : [text(line)]);
/** An email is plain text: a blank line separates paragraphs and nothing in it is read as Markdown. */
const paragraphs = (value: string): MdBlock[] => value.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  .map(part => ({ type: 'paragraph', children: lines(part) }));
const labeled = (label: string, value: string): MdBlock => ({ type: 'paragraph', children: [{ type: 'strong', children: [text(`${label}: `)] }, ...lines(value)] });

function emailBlocks(step: { subject: string; body: string }, to: string[] | null = null): MdBlock[] {
  return [...(to?.length ? [labeled('Para', to.join(', '))] : []), labeled('Asunto', step.subject), ...paragraphs(step.body)];
}

/** The written card as a title and the blocks under it. */
function writtenBlocks(block: Extract<CoworkBlock, { type: 'email_draft' | 'sequence' }>): MdBlock[] {
  if (block.type === 'email_draft') return emailBlocks(block, block.to);
  return block.steps.flatMap((step, index): MdBlock[] => [
    { type: 'heading', level: 2, children: [text(`Correo ${index + 1} · día ${step.day}`)] }, ...emailBlocks(step)]);
}

const TEXT_TYPES = new Set<CoworkBlock['type']>(['email_draft', 'sequence']);

/** The card as a file in `format` (one of those its type offers, see COWORK_BLOCK_FORMATS). */
export async function buildCoworkBlockFile(block: CoworkBlock, format: CoworkFileFormat) {
  if (!COWORK_BLOCK_FORMATS[block.type].includes(format)) throw new CoworkExportError('Este resultado no se puede descargar en ese formato.', 400);
  const filename = coworkExportFilename(block.title, format, FALLBACK_NAME[block.type]);
  if (block.type === 'table' || block.type === 'chart' || block.type === 'metrics') {
    if (format === 'csv') {
      const csv = block.type === 'table' ? coworkTableCsv(block) : block.type === 'chart' ? coworkChartCsv(block) : coworkMetricsCsv(block);
      return { bytes: new TextEncoder().encode(csv), mime: COWORK_MIME.csv, filename };
    }
    return { bytes: await spreadsheetBytes(block), mime: COWORK_MIME.xlsx, filename };
  }
  if (!TEXT_TYPES.has(block.type)) throw new CoworkExportError('Este resultado no se puede descargar en ese formato.', 400);
  const blocks = writtenBlocks(block);
  if (format === 'docx') {
    const { renderCoworkDocx } = await import('./docx-render');
    return { bytes: await renderCoworkDocx(block.title, blocks), mime: COWORK_MIME.docx, filename };
  }
  // The PDF fonts hold Western European text only; say so instead of drawing something else.
  const title = normalizeCoworkPdfText(block.title, 'Word');
  return { bytes: await coworkPdfBytes(title, mapCoworkMarkdownText(blocks, value => normalizeCoworkPdfText(value, 'Word'))), mime: COWORK_MIME.pdf, filename };
}

import {
  COWORK_FILE_READ_LIMITS, COWORK_FILE_UNREADABLE, coworkBlankRow, coworkHeaderRow, coworkRowText, coworkTableHeaders, coworkTablePreview, coworkTextPreview,
  type CoworkFilePreview,
} from '@/lib/cowork/file-read';
import { coworkZipGuard } from '@/lib/cowork/zip-guard';

/**
 * Opens the files Cowork reads that are not plain text (plan 2, F1 and F2): an Excel (.xlsx), a PDF
 * or a Word (.docx) the person uploaded. Nothing runs from them: no macros, no formulas (the
 * calculated value is read), no scripts. What comes out has the same shape as a CSV or a text
 * file (file-read.ts), trimmed to what the model reads in one decision, and the content is data,
 * never instructions. The ZIP formats are checked before they are unpacked (zip-guard.ts).
 */

export type CoworkBinaryResult = { preview: CoworkFilePreview } | { unreadable: keyof typeof COWORK_FILE_UNREADABLE };

/**
 * What one file may cost. Excel: rows counted per sheet (fewer when the sheets are wide: the cells
 * held at once stay within `cells`, checked with a first look at the sheets when the file could hold
 * more, at 22 bytes of XML a cell at the least), sheets listed, and the XML it may expand to. PDF:
 * pages read and the time it may take.
 * Word: the XML it may expand to (its text is parsed as a whole, which takes some twenty times its
 * size in memory). The XML limits come from measuring: reading a workbook takes five to ten times its
 * XML in memory, and the app runs with 768 MB shared by every request.
 */
export const COWORK_BINARY_LIMITS = {
  rows: 20_000, cells: 300_000, sheets: 12, xlsxXmlBytes: 30 * 1024 * 1024,
  pdfPages: 40, pdfMs: 12_000,
  docxXmlBytes: 6 * 1024 * 1024,
} as const;

const damaged = { unreadable: 'damaged' } as const;
const large = { unreadable: 'large' } as const;

/** The sheet asked for by name (any case, or the start of its name); without a request, the first with data. */
function pickSheet(names: string[], rowsOf: (name: string) => number, asked: string) {
  const wanted = asked.trim().toLocaleLowerCase('es');
  const exact = wanted ? names.find(name => name.toLocaleLowerCase('es') === wanted) : undefined;
  const start = wanted && !exact ? names.find(name => name.toLocaleLowerCase('es').startsWith(wanted)) : undefined;
  return wanted ? exact ?? start : names.find(name => rowsOf(name) > 0) ?? names[0];
}

/**
 * What a cell shows once read: a date as year-month-day, whatever the file's own format (day/month
 * and month/day look alike), with the time only where the cell shows it, and an error as its text
 * (`#DIV/0!`), not as an empty cell. A duration («[h]:mm») and every other format stay as read.
 */
function showCells(XLSX: typeof import('xlsx'), sheet: import('xlsx').WorkSheet) {
  for (const ref of Object.keys(sheet)) {
    if (ref.charCodeAt(0) === 33) continue; // «!ref», «!merges»…
    const cell = sheet[ref] as import('xlsx').CellObject;
    if (cell.t === 'e') {
      cell.t = 's';
      cell.v = cell.w || '#ERROR';
      delete cell.w;
      continue;
    }
    if (cell.t !== 'n' || typeof cell.v !== 'number' || !cell.z) continue;
    const format = String(cell.z);
    if (!XLSX.SSF.is_date(format) || /\[[hms]+\]/i.test(format)) continue;
    const shownTime = /[hs]|a\/?p/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, ''));
    cell.w = XLSX.SSF.format(cell.v < 1 ? 'hh:mm' : shownTime ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd', cell.v);
  }
}

/** A sheet as a whole: its columns, every row counted, what stood above the header, and the list of sheets. */
export type CoworkExcelTable = {
  columns: string[]; body: unknown[][]; sheet: string; above: string[]; capped: boolean; sheets: Array<{ name: string; rows: number }>;
};
type ExcelTableResult = { table: CoworkExcelTable } | { unreadable: 'damaged' | 'large' | 'sheet' };

/** An Excel workbook: the sheet asked for (the first one with data by default) as a table, and the list of sheets. */
async function excelPreview(bytes: Uint8Array, sheetAsked: string, cells: number): Promise<CoworkBinaryResult> {
  const opened = await excelTable(bytes, sheetAsked, cells);
  if ('unreadable' in opened) return opened;
  const { columns, body, sheet, above, capped, sheets } = opened.table;
  const table = coworkTablePreview(columns, body, body.length);
  return { preview: { ...table, sheet, ...(above.length ? { above } : {}), ...(capped ? { capped: true as const } : {}), sheets } };
}

/**
 * The whole table of an Excel sheet, with the same limits as the preview (rows counted and cells held
 * at once): what an import of contacts reads. The preview shows the first rows of the same table.
 */
export function coworkExcelTable(bytes: Uint8Array, options: { sheet?: string; cells?: number } = {}): Promise<ExcelTableResult> {
  return excelTable(bytes, options.sheet || '', options.cells ?? COWORK_BINARY_LIMITS.cells);
}

async function excelTable(bytes: Uint8Array, sheetAsked: string, cells: number): Promise<ExcelTableResult> {
  const opened = coworkZipGuard(bytes);
  if (!opened.ok) return opened.large ? large : damaged;
  if (opened.xmlBytes > COWORK_BINARY_LIMITS.xlsxXmlBytes) return large;
  const XLSX = await import('xlsx');
  // Formulas stay unread (their value does not) and nothing about the look of a cell is kept.
  const options = { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false } as const;
  let book: import('xlsx').WorkBook;
  let limit: number = COWORK_BINARY_LIMITS.rows;
  try {
    // Unless the file is too small to hold that many cells, a first look at only the first rows tells how wide the sheets are, so the rows read keep the cells held at once within a limit.
    if (opened.xmlBytes > cells * 22) {
      const peek = XLSX.read(bytes, { ...options, cellText: false, sheetRows: 2 });
      const width = peek.SheetNames.reduce((sum, name) => {
        const ref = peek.Sheets[name]?.['!ref'];
        return sum + (ref ? XLSX.utils.decode_range(ref).e.c + 1 : 0);
      }, 0);
      limit = Math.min(limit, Math.max(200, Math.floor(cells / Math.max(1, width))));
    }
    // A sheet is read up to its header, the rows that are counted and one more (to know there are more). Number formats stay, to tell a date from a number.
    book = XLSX.read(bytes, { ...options, cellNF: true, sheetRows: limit + 2 });
  } catch { return damaged; }
  const names = book.SheetNames;
  if (!names.length) return damaged;
  const dataRows = (name: string) => {
    const ref = book.Sheets[name]?.['!ref'];
    return ref ? XLSX.utils.decode_range(ref).e.r : 0;
  };
  const chosen = pickSheet(names, dataRows, sheetAsked);
  if (!chosen) return { unreadable: 'sheet' };
  showCells(XLSX, book.Sheets[chosen]);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[chosen], { header: 1, raw: false, blankrows: false, defval: '' })
    .filter(values => Array.isArray(values) && !coworkBlankRow(values));
  // A title or a note above the header is kept apart, not read as the columns.
  const headerAt = coworkHeaderRow(rows);
  const above = rows.slice(0, headerAt).map(coworkRowText);
  const [first = [], ...rest] = rows.slice(headerAt);
  const capped = rest.length > limit;
  const body = capped ? rest.slice(0, limit) : rest;
  return { table: { columns: coworkTableHeaders(first), body, sheet: chosen, above, capped,
    sheets: names.slice(0, COWORK_BINARY_LIMITS.sheets).map(name => ({ name, rows: name === chosen ? body.length : dataRows(name) })) } };
}

/** A PDF's text, page by page up to a limit of pages and time. A PDF with no text (a scan) is not read. */
async function pdfPreview(bytes: Uint8Array): Promise<CoworkBinaryResult> {
  const { getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try { pdf = await getDocumentProxy(new Uint8Array(bytes)); } catch { return damaged; }
  try {
    const total = pdf.numPages;
    const started = Date.now();
    const parts: string[] = [];
    let read = 0;
    let chars = 0;
    for (let number = 1; number <= Math.min(total, COWORK_BINARY_LIMITS.pdfPages); number++) {
      // Enough to fill what the model reads, or out of time: what is left of the file stays unread.
      if (Date.now() - started > COWORK_BINARY_LIMITS.pdfMs || chars > COWORK_FILE_READ_LIMITS.textChars * 2) break;
      const content = await (await pdf.getPage(number)).getTextContent();
      const text = content.items.map(item => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
      parts.push(text);
      chars += text.length;
      read = number;
    }
    const text = parts.filter(Boolean).join('\n\n');
    if (!text.trim()) return { unreadable: 'scan' };
    return { preview: { ...coworkTextPreview(text), pages: { read, total } } };
  } catch { return damaged; } finally { await pdf.loadingTask.destroy().catch(() => undefined); }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : '';
});
const flat = (html: string) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** The text of the HTML mammoth writes, with each table row on one line («celda | celda») and each list item, nested or not, on its own. Text for the model, never shown as HTML. */
export function coworkHtmlToText(html: string) {
  const withTables = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_whole, table: string) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => flat(cell[1])).join(' | '));
    return `\n\n${rows.filter(row => row.replace(/[|\s]/g, '')).join('\n')}\n\n`;
  });
  return decode(withTables
    .replace(/<a href="#(?:footnote|endnote)-ref-\d+">[^<]*<\/a>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(?:p|h[1-6]|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+\n/g, '\n');
}

/** A Word document's text with its headings, lists and tables; not its formatting, images or macros. */
async function docxPreview(bytes: Uint8Array): Promise<CoworkBinaryResult> {
  const opened = coworkZipGuard(bytes);
  if (!opened.ok) return opened.large ? large : damaged;
  if (opened.xmlBytes > COWORK_BINARY_LIMITS.docxXmlBytes) return large;
  const mammoth = await import('mammoth');
  const lib = mammoth.default ?? mammoth;
  try {
    // Images are left out without being read: only the text is wanted.
    const { value } = await lib.convertToHtml({ buffer: Buffer.from(bytes) }, { convertImage: lib.images.imgElement(async () => ({ src: '' })) });
    return { preview: coworkTextPreview(coworkHtmlToText(value)) };
  } catch { return damaged; }
}

/** The preview of an Excel (.xlsx), a PDF or a Word (.docx), or why it could not be read; null for other files. */
export async function coworkBinaryPreview(name: string, bytes: Uint8Array, options: { sheet?: string; cells?: number } = {}): Promise<CoworkBinaryResult | null> {
  const extension = name.toLowerCase().split('.').pop() || '';
  if (extension === 'xlsx') return excelPreview(bytes, options.sheet || '', options.cells ?? COWORK_BINARY_LIMITS.cells);
  if (extension === 'xls') return { unreadable: 'xls' };
  if (extension === 'pdf') return pdfPreview(bytes);
  if (extension === 'docx') return docxPreview(bytes);
  return null;
}

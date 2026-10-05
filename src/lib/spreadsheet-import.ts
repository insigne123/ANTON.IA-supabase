import * as XLSX from 'xlsx';

/**
 * «Importar contactos» also takes an Excel file (Plan 11, PR 5): the person exports their list from Excel, Google Sheets
 * or their old CRM and uploads it as it is, without saving it as CSV first. Each sheet with data becomes headers and rows,
 * like the CSV reader gives them, so the rest of the import (columns, review, duplicates) is the same. Read in the
 * browser; nothing is uploaded until the person confirms the review.
 */
export type SpreadsheetSheet = { name: string; headers: string[]; rows: Array<Record<string, string>>; total: number };

export class SpreadsheetError extends Error {
  constructor(message: string) { super(message); this.name = 'SpreadsheetError'; }
}

export const isExcelFile = (name: string) => /\.xlsx$/i.test(name);
export const isOldExcelFile = (name: string) => /\.xls$/i.test(name);

const cell = (value: unknown) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim());

/** The headers of the first row with data; empty or repeated names get one of their own, so no column is lost. */
function headersOf(row: unknown[]) {
  const seen = new Map<string, number>();
  return row.map((value, index) => {
    const base = cell(value) || `Columna ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/**
 * The sheets of an .xlsx with at least one data row, each read up to `maxRows` (one more is read to tell the person when
 * the file is too long). Formulas give their value; dates and numbers come as the sheet shows them.
 */
export function readSpreadsheet(bytes: ArrayBuffer | Uint8Array, options: { maxRows: number }): SpreadsheetSheet[] {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: 'array', sheetRows: options.maxRows + 50, cellDates: false, cellHTML: false, cellFormula: false });
  } catch {
    throw new SpreadsheetError('No pudimos abrir el Excel: puede estar dañado o protegido con contraseña. Prueba guardándolo de nuevo o como CSV.');
  }
  const sheets: SpreadsheetSheet[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    // The header row is the first with two or more filled cells: a report often opens with a title in one cell.
    const filled = (row: unknown) => (Array.isArray(row) ? row.filter(value => cell(value)).length : 0);
    const first = matrix.findIndex(row => filled(row) > 0);
    if (first < 0) continue;
    const titled = matrix.findIndex(row => filled(row) >= 2);
    const start = titled >= 0 && titled - first <= 5 ? titled : first;
    const headers = headersOf(matrix[start] as unknown[]);
    const rows = matrix.slice(start + 1)
      .filter(row => Array.isArray(row) && row.some(value => cell(value)))
      .map(row => Object.fromEntries(headers.map((header, index) => [header, cell((row as unknown[])[index])])));
    if (!rows.length) continue;
    sheets.push({ name, headers, rows: rows.slice(0, options.maxRows), total: rows.length });
  }
  if (!sheets.length) throw new SpreadsheetError('El Excel no tiene filas con datos bajo una fila de encabezados.');
  return sheets;
}

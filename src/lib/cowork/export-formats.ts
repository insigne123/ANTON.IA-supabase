import type { CoworkBlock } from './contracts';

/**
 * The files Cowork makes from what is on screen (plan 2, F3), and which card offers which. Shared
 * by the menu that offers them and by the server that checks what it is asked for, so the two
 * cannot disagree. Text and figures go to a spreadsheet, written texts to Word or PDF.
 */

export type CoworkFileFormat = 'xlsx' | 'csv' | 'docx' | 'pdf' | 'md';

export const COWORK_FORMAT_LABEL: Record<CoworkFileFormat, string> = {
  xlsx: 'Excel (.xlsx)', csv: 'CSV (.csv)', docx: 'Word (.docx)', pdf: 'PDF (.pdf)', md: 'Markdown (.md)',
};

/** A spreadsheet or a written file: the menu shows the icon of the one it is. */
export const COWORK_FORMAT_KIND: Record<CoworkFileFormat, 'sheet' | 'text'> = { xlsx: 'sheet', csv: 'sheet', docx: 'text', pdf: 'text', md: 'text' };

export type CoworkBlockType = CoworkBlock['type'];

/** What each card can be downloaded as, in the order the menu shows it. */
export const COWORK_BLOCK_FORMATS: Record<CoworkBlockType, readonly CoworkFileFormat[]> = {
  table: ['xlsx', 'csv'],
  chart: ['xlsx', 'csv'],
  metrics: ['xlsx', 'csv'],
  email_draft: ['docx', 'pdf'],
  sequence: ['docx', 'pdf'],
};

/** The document of a turn (the side panel): the same three ways as any written text, plus Markdown. */
export const COWORK_DOCUMENT_FORMATS: readonly CoworkFileFormat[] = ['docx', 'pdf', 'md'];

export const COWORK_BLOCK_NOUN: Record<CoworkBlockType, string> = {
  table: 'tabla', chart: 'gráfico', metrics: 'cifras', email_draft: 'correo', sequence: 'secuencia',
};

export function coworkFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

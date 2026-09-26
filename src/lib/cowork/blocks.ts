import type { CoworkBlock } from './contracts';
import { csvCell } from './lead-export';

/** Plain-text helpers for the cards: what is copied, exported and summarized. */

type Email = { subject: string; body: string };

export function coworkEmailText({ subject, body }: Email) {
  return `Asunto: ${subject}\n\n${body}`;
}

export function coworkSequenceText(block: Extract<CoworkBlock, { type: 'sequence' }>) {
  return block.steps.map((step, index) => `Correo ${index + 1} · día ${step.day}\n${coworkEmailText(step)}`).join('\n\n---\n\n');
}

/** CSV with a BOM for spreadsheets; formulas are neutralized like the contact export. */
export function coworkTableCsv(block: Extract<CoworkBlock, { type: 'table' }>) {
  return '﻿' + [block.columns, ...block.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** Tab-separated text: pastes as a table in a spreadsheet or document. */
export function coworkTableTsv(block: Extract<CoworkBlock, { type: 'table' }>) {
  return [block.columns, ...block.rows].map(row => row.map(cell => cell.replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
}

export function coworkBlockFilename(title: string, extension: string) {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'cowork'}.${extension}`;
}

function people(to: string[] | null) {
  if (!to?.length) return '';
  return to.length === 1 ? ` · para ${to[0]}` : ` · para ${to[0]} y ${to.length - 1} más`;
}

/** One line under the card title: kind and size, in plain words. */
export function coworkBlockMeta(block: CoworkBlock) {
  if (block.type === 'email_draft') return `Correo${people(block.to)}`;
  if (block.type === 'sequence') {
    const span = block.steps[block.steps.length - 1].day;
    return `Secuencia · ${block.steps.length} correos en ${span} ${span === 1 ? 'día' : 'días'}`;
  }
  if (block.type === 'table') return `Tabla · ${block.rows.length} ${block.rows.length === 1 ? 'fila' : 'filas'}`;
  return `Cifras${block.period ? ` · ${block.period}` : ''}`;
}

/** Everything a set of cards says, as text: for checks that read what the person sees. */
export function coworkBlocksText(blocks: CoworkBlock[]) {
  return blocks.map(block => {
    if (block.type === 'email_draft') return [block.title, block.to?.join(', ') || '', coworkEmailText(block)].join('\n');
    if (block.type === 'sequence') return [block.title, coworkSequenceText(block)].join('\n');
    if (block.type === 'table') return [block.title, coworkTableTsv(block)].join('\n');
    return [block.title, block.period || '', ...block.items.map(item => `${item.label}: ${item.value}${item.detail ? ` (${item.detail})` : ''}`)].join('\n');
  }).join('\n\n');
}

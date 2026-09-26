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

type Draftable = Extract<CoworkBlock, { type: 'email_draft' | 'sequence' }>;
export type CoworkEditedEmail = { subject: string; body: string; day: number | null };

/** The emails of a card as editable steps: a single email is a one-step sequence. */
export function coworkDraftSteps(block: Draftable): CoworkEditedEmail[] {
  return block.type === 'email_draft'
    ? [{ subject: block.subject, body: block.body, day: null }]
    : block.steps.map(step => ({ subject: step.subject, body: step.body, day: step.day }));
}

const USE_LEAD = 'Usa exactamente esta versión';
const CAMPAIGN_LEAD = 'Crea una campaña pausada con esta versión';

/** The message sent from a card: what to do and the exact text, in a shape the
 * loop reads back (coworkEditedEmails) so a campaign carries it word for word. */
export function coworkVersionMessage(block: Draftable, steps: CoworkEditedEmail[], intent: 'use' | 'campaign', edited: boolean) {
  const what = `${edited ? ' editada' : ''} de «${block.title}», sin cambiar el texto`;
  const to = block.type === 'email_draft' && block.to?.length ? `, para ${block.to.join(', ')}` : '';
  const lead = intent === 'campaign' ? `${CAMPAIGN_LEAD}${what}${to}.` : `${USE_LEAD}${what}.`;
  const body = steps.length === 1 && steps[0].day === null
    ? coworkEmailText(steps[0])
    : steps.map((step, index) => `Correo ${index + 1}${step.day === null ? '' : ` · día ${step.day}`}\n${coworkEmailText(step)}`).join('\n\n---\n\n');
  return `${lead}\n\n${body}`;
}

/** The exact emails of a message sent with coworkVersionMessage, or null when the
 * message is anything else or the text does not read back cleanly. */
export function coworkEditedEmails(message: string): CoworkEditedEmail[] | null {
  const text = String(message || '').replace(/\r\n/g, '\n');
  const breakAt = text.indexOf('\n\n');
  if (breakAt < 0) return null;
  const lead = text.slice(0, breakAt);
  if (!(lead.startsWith(USE_LEAD) || lead.startsWith(CAMPAIGN_LEAD)) || !lead.includes('sin cambiar el texto')) return null;
  const emails: CoworkEditedEmail[] = [];
  for (const part of text.slice(breakAt + 2).split(/\n\n---\n\n/)) {
    const match = /^(?:Correo \d+(?: · día (\d+))?\n)?Asunto: ([^\n]+)\n\n([\s\S]+)$/.exec(part.trim());
    if (!match || !match[2].trim() || !match[3].trim()) return null;
    emails.push({ subject: match[2].trim(), body: match[3].trim(), day: match[1] ? Number(match[1]) : null });
  }
  return emails.length ? emails : null;
}

/** Whether the person asked for a campaign with the exact text (not only to keep it). */
export function coworkWantsCampaignFromVersion(message: string) {
  return String(message || '').startsWith(CAMPAIGN_LEAD) && coworkEditedEmails(message) !== null;
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

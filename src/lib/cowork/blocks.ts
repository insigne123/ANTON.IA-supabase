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

/** The emails a turn wrote for one campaign: its only email or sequence card (one email per person is not one campaign). */
export function coworkCampaignEmails(blocks: ReadonlyArray<{ type: string }> | null | undefined): CoworkEditedEmail[] | null {
  const drafts = (blocks || []).filter((block): block is Draftable => block.type === 'email_draft' || block.type === 'sequence');
  return drafts.length === 1 ? coworkDraftSteps(drafts[0]) : null;
}

/** The card with the emails the person has now (their edit of the subject and body of each step); everything else as it was. */
export function coworkBlockWithSteps(block: Draftable, steps: CoworkEditedEmail[]): Draftable {
  if (block.type === 'email_draft') return { ...block, subject: steps[0]?.subject ?? block.subject, body: steps[0]?.body ?? block.body };
  return { ...block, steps: block.steps.map((step, index) => ({ ...step, subject: steps[index]?.subject ?? step.subject, body: steps[index]?.body ?? step.body })) };
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

/** Which card a version message came from (by its title), whether it was edited and what it asked for. */
export function coworkVersionSource(message: string): { title: string; edited: boolean; intent: 'use' | 'campaign' } | null {
  if (!coworkEditedEmails(message)) return null;
  const lead = String(message).replace(/\r\n/g, '\n').split('\n\n')[0];
  const match = /( editada)? de «(.+?)», sin cambiar el texto/.exec(lead);
  if (!match) return null;
  return { title: match[2], edited: Boolean(match[1]), intent: lead.startsWith(CAMPAIGN_LEAD) ? 'campaign' : 'use' };
}

/** Whether the person asked for a campaign with the exact text (not only to keep it). */
export function coworkWantsCampaignFromVersion(message: string) {
  return String(message || '').startsWith(CAMPAIGN_LEAD) && coworkEditedEmails(message) !== null;
}

/** Whether the message came from «Usar esta versión»: it keeps the text, and nothing is created yet. */
export function coworkOnlyUsesVersion(message: string) {
  return String(message || '').startsWith(USE_LEAD) && coworkEditedEmails(message) !== null;
}

/** The integer inside a figure («45 %», «1.200 envíos», «US$ 300»): what comes before and after
 * it, and how to write it back the same way (with thousands dots or not). Decimals, ranges
 * and anything else return null and stay as text. */
export function coworkFigureNumber(value: string): { before: string; number: number; after: string; format: (value: number) => string } | null {
  const match = /^([^\d]*?)(\d{1,3}(?:\.\d{3})+|\d+)(?!\d|[.,]\d)([\s\S]*)$/.exec(value);
  if (!match) return null;
  const number = Number(match[2].replace(/\./g, ''));
  if (!Number.isSafeInteger(number)) return null;
  const format = match[2].includes('.') ? (next: number) => String(next).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : String;
  return { before: match[1], number, after: match[3], format };
}

export type CoworkDiffSegment = { text: string; changed: boolean };

/** The new text split into what stayed and what is new or rewritten, word by word, for a
 * brief highlight after an edit. Removed words are not shown. Very long texts (more than
 * ~250 000 word pairs) come back unmarked rather than slow the page down. */
export function coworkWordDiff(before: string, after: string): CoworkDiffSegment[] {
  const split = (text: string) => text.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
  const space = (token: string) => /^\s+$/.test(token);
  const old = split(before).filter(token => !space(token));
  const tokens = split(after);
  const words = tokens.flatMap((token, index) => space(token) ? [] : [{ token, index }]);
  const kept = new Set<number>();
  if (old.length * words.length <= 250_000) {
    // Longest common subsequence of words: whatever is not in it is new.
    const table = Array.from({ length: old.length + 1 }, () => new Uint16Array(words.length + 1));
    for (let i = old.length - 1; i >= 0; i--) {
      for (let j = words.length - 1; j >= 0; j--) {
        table[i][j] = old[i] === words[j].token ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    for (let i = 0, j = 0; i < old.length && j < words.length;) {
      if (old[i] === words[j].token) { kept.add(words[j].index); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) i++;
      else j++;
    }
  } else words.forEach(word => kept.add(word.index));
  const changed = tokens.map((token, index) => !space(token) && !kept.has(index));
  // A space between two changed words belongs to the change, so one edit reads as one mark.
  tokens.forEach((token, index) => {
    if (!space(token)) return;
    changed[index] = index > 0 && index < tokens.length - 1 && changed[index - 1] && changed[index + 1];
  });
  const segments: CoworkDiffSegment[] = [];
  tokens.forEach((token, index) => {
    const last = segments[segments.length - 1];
    if (last && last.changed === changed[index]) last.text += token;
    else segments.push({ text: token, changed: changed[index] });
  });
  return segments;
}

/** CSV with a BOM for spreadsheets; formulas are neutralized like the contact export. */
export function coworkTableCsv(block: Extract<CoworkBlock, { type: 'table' }>) {
  return '﻿' + [block.columns, ...block.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** Tab-separated text: pastes as a table in a spreadsheet or document. */
export function coworkTableTsv(block: Extract<CoworkBlock, { type: 'table' }>) {
  return [block.columns, ...block.rows].map(row => row.map(cell => cell.replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
}

type Chart = Extract<CoworkBlock, { type: 'chart' }>;

/** A chart's figures as a table: one row per point, one column per series. */
export function coworkChartRows(block: Chart) {
  return block.labels.map((label, index) => [label, ...block.series.map(series => series.values[index])]);
}

/** «12 %» or «240 envíos»: a value with its unit, the way the card and the export write it. */
export function coworkChartValue(block: Pick<Chart, 'unit'>, value: number) {
  const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace('.', ',');
  return block.unit ? (block.unit === '%' ? `${text} %` : `${text} ${block.unit}`) : text;
}

/** CSV with a BOM for spreadsheets, like the table's. */
export function coworkChartCsv(block: Chart) {
  return '﻿' + [[block.period ? `${block.title} (${block.period})` : block.title, ...block.series.map(series => series.name)], ...coworkChartRows(block).map(row => row.map(String))]
    .map(row => row.map(csvCell).join(',')).join('\r\n');
}

type Metrics = Extract<CoworkBlock, { type: 'metrics' }>;

/** The figures of a card as rows, one per figure and each with its period, so they read as a table. */
export function coworkMetricsRows(block: Metrics) {
  return [['Cifra', 'Valor', 'Detalle', 'Período'], ...block.items.map(item => [item.label, item.value, item.detail ?? '', block.period ?? ''])];
}

export function coworkMetricsCsv(block: Metrics) {
  return '\uFEFF' + coworkMetricsRows(block).map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** What a screen reader hears before the data table: the chart in one sentence. */
export function coworkChartSummary(block: Chart) {
  const top = block.series.map(series => {
    const at = series.values.indexOf(Math.max(...series.values));
    return `${series.name}: mayor en ${block.labels[at]} (${coworkChartValue(block, series.values[at])})`;
  }).join('; ');
  return `${block.title}${block.period ? `, ${block.period}` : ''}. ${block.labels.length} puntos y ${block.series.length} ${block.series.length === 1 ? 'serie' : 'series'}. ${top}.`;
}

/** The line a chart's card shows in the chat: its largest value, as the figure to read first. */
export function coworkChartHeadline(block: Chart) {
  const series = block.series[0];
  if (!series?.values.length) return `${block.labels.length} ${block.labels.length === 1 ? 'punto' : 'puntos'}`;
  const at = series.values.indexOf(Math.max(...series.values));
  const name = block.series.length > 1 ? ` (${series.name})` : '';
  const count = block.labels.length;
  const unit = block.kind === 'bar' ? (count === 1 ? 'categoría' : 'categorías') : (count === 1 ? 'punto' : 'puntos');
  return `Mayor: ${block.labels[at]}, ${coworkChartValue(block, series.values[at])}${name} · ${count} ${unit}`;
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
  if (block.type === 'chart') return `Gráfico${block.period ? ` · ${block.period}` : ''}`;
  return `Cifras${block.period ? ` · ${block.period}` : ''}`;
}

/** Everything a set of cards says, as text: for checks that read what the person sees. */
export function coworkBlocksText(blocks: CoworkBlock[]) {
  return blocks.map(block => {
    if (block.type === 'email_draft') return [block.title, block.to?.join(', ') || '', coworkEmailText(block)].join('\n');
    if (block.type === 'sequence') return [block.title, coworkSequenceText(block)].join('\n');
    if (block.type === 'table') return [block.title, coworkTableTsv(block)].join('\n');
    if (block.type === 'chart') return [block.title, block.period || '', block.series.map(series => series.name).join(' · '),
      ...coworkChartRows(block).map(row => `${row[0]}: ${row.slice(1).map(value => coworkChartValue(block, Number(value))).join(' · ')}`)].join('\n');
    return [block.title, block.period || '', ...block.items.map(item => `${item.label}: ${item.value}${item.detail ? ` (${item.detail})` : ''}`)].join('\n');
  }).join('\n\n');
}

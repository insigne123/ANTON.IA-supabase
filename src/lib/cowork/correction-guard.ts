import { coworkBlocksText } from './blocks';
import type { CoworkBlock } from './contracts';
import { coworkTimeZone, coworkWithLocalTimes } from './decision-context';

type Answer = { reply: string; blocks?: CoworkBlock[] | null; document?: { title: string; content: string } | null; question?: string | null };

/** Whether a correction is kept, and why. */
export type CoworkCorrectionVerdict = {
  keep: 'correction' | 'first';
  reason: 'improved' | 'empty' | 'unchanged' | 'new_figures';
  /** The figures the correction added without support, when that is the reason. */
  figures?: string[];
};

const words = (text: string) => text.toLocaleLowerCase('es').match(/[\p{L}\p{N}]+/gu) || [];

function answerText(answer: Answer) {
  return [answer.reply, answer.question || '', answer.blocks?.length ? coworkBlocksText(answer.blocks) : '',
    answer.document ? `${answer.document.title}\n${answer.document.content}` : ''].join('\n');
}

/**
 * The figures a person could check: percentages, decimals and whole numbers of 10 or more, as
 * written (thousands with a dot or without). Years and small counts are left out: they rarely
 * carry an invented fact and would make every correction suspicious.
 */
export function coworkFigures(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?\s*%?/g)) {
    const raw = match[0].trim();
    const number = Number(raw.replace('%', '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (!Number.isFinite(number)) continue;
    const decimal = /[.,]\d/.test(raw) && !/^\d{1,3}(?:\.\d{3})+$/.test(raw);
    if (!raw.endsWith('%') && !decimal && (number < 10 || (number >= 1900 && number <= 2100))) continue;
    found.add(String(number));
  }
  return [...found];
}

/**
 * A correction is kept only if it is one: not empty, not the same answer again, and without
 * figures that are neither in the first answer nor in what Cowork consulted (the data, the
 * history, what the person saved in their profile). Otherwise the first answer stands: a
 * correction never makes an answer worse than the one it was asked to fix.
 */
export function coworkCorrectionVerdict(first: Answer, corrected: Answer, evidence: unknown): CoworkCorrectionVerdict {
  if (!corrected.reply.trim() && !corrected.blocks?.length) return { keep: 'first', reason: 'empty' };
  const before = answerText(first);
  const after = answerText(corrected);
  if (words(before).join(' ') === words(after).join(' ')) return { keep: 'first', reason: 'unchanged' };
  // The coordinator read every timestamp with its local reading next to it: a local hour it writes is supported
  // by the data even though the stored one is in UTC.
  const known = new Set([...coworkFigures(before), ...coworkFigures(JSON.stringify(coworkWithLocalTimes(evidence ?? null, coworkTimeZone())))]);
  const figures = coworkFigures(after).filter(figure => !known.has(figure));
  if (figures.length) return { keep: 'first', reason: 'new_figures', figures };
  return { keep: 'correction', reason: 'improved' };
}

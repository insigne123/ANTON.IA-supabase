// What a document is, before it is a PDF or a Word: a title, an optional cover and a list of blocks (headings, paragraphs, lists, tables, callouts,
// key figures, quotes, bars). Two shapes: the input a model or a person writes (text with light inline Markdown, easy to produce and to validate)
// and the spec the renderers draw (the same with text cut into styled runs). The design lives apart (theme.ts) so a document never carries colors.
import { z } from 'zod';
import { parseMarkdown, type MdBlock, type MdInline } from '@/lib/cowork/markdown';

export type Run = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };
export type ListItem = { runs: Run[]; sub?: ListItem[] };
export type Tone = 'info' | 'warning' | 'success' | 'neutral';
export type Align = 'left' | 'right' | 'center';

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: ListItem[] }
  | { type: 'table'; columns: Array<{ header: Run[]; align?: Align }>; rows: Run[][][]; caption?: string }
  | { type: 'callout'; tone: Tone; title?: string; runs: Run[] }
  | { type: 'figures'; items: Array<{ value: string; label: string; detail?: string }> }
  | { type: 'quote'; runs: Run[]; cite?: string }
  | { type: 'code'; text: string }
  | { type: 'bars'; title?: string; unit?: string; items: Array<{ label: string; value: number }> }
  | { type: 'divider' }
  | { type: 'pageBreak' };

export type DocumentSpec = {
  title: string;
  subtitle?: string;
  /** A short line over the title on the cover («Informe semanal», «Propuesta comercial»). */
  kicker?: string;
  /** Who, for whom, when: shown on the cover as label and value. */
  meta?: Array<{ label: string; value: string }>;
  cover?: boolean;
  /** The line in the header of each page; the title when absent. */
  runningTitle?: string;
  theme?: 'antonia' | 'cowork';
  /** The name in the footer of each page («ANTON.IA Cowork»); ANTON.IA when absent. */
  brand?: string;
  blocks: DocBlock[];
};

// ─── The input a model writes ──────────────────────────────────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
const inline = text(4_000).describe('Texto; admite **negrita**, *cursiva*, `código` y [enlace](https://…)');

export const documentBlockInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(3), text: text(200) }),
  z.object({ type: z.literal('paragraph'), text: inline }),
  z.object({ type: z.literal('list'), ordered: z.boolean().optional(), items: z.array(text(600)).min(1).max(30) }),
  z.object({
    type: z.literal('table'),
    columns: z.array(text(80)).min(1).max(8),
    align: z.array(z.enum(['left', 'right', 'center'])).max(8).optional().describe('Una por columna; las cifras van a la derecha'),
    rows: z.array(z.array(z.string().max(400)).max(8)).min(1).max(80),
    caption: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('callout'), tone: z.enum(['info', 'warning', 'success', 'neutral']), title: z.string().max(100).optional(), text: inline }),
  z.object({
    type: z.literal('figures'),
    items: z.array(z.object({ value: text(24), label: text(80), detail: z.string().max(120).optional() })).min(1).max(4),
  }).describe('De 1 a 4 cifras clave en tarjetas, al inicio de una sección'),
  z.object({ type: z.literal('quote'), text: inline, cite: z.string().max(120).optional() }),
  z.object({
    type: z.literal('bars'), title: z.string().max(100).optional(), unit: z.string().max(12).optional(),
    items: z.array(z.object({ label: text(60), value: z.number().finite().min(0) })).min(2).max(12),
  }).describe('Gráfico de barras horizontales con valores'),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('pageBreak') }),
]);

export const documentInputSchema = z.object({
  title: text(160),
  subtitle: z.string().max(240).optional(),
  kicker: z.string().max(60).optional(),
  meta: z.array(z.object({ label: text(40), value: text(160) })).max(6).optional(),
  cover: z.boolean().optional().describe('Portada propia: para informes y propuestas de varias páginas'),
  blocks: z.array(documentBlockInputSchema).min(1).max(200),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

// ─── Markdown inline → runs ────────────────────────────────────────────────────────────────────────────────────────────────

type Style = Omit<Run, 'text'>;

export function runsOfInline(nodes: MdInline[], style: Style = {}): Run[] {
  const runs: Run[] = [];
  for (const node of nodes) {
    if (node.type === 'text') runs.push({ ...style, text: node.value });
    else if (node.type === 'code') runs.push({ ...style, code: true, text: node.value });
    else if (node.type === 'br') runs.push({ ...style, text: '\n' });
    else if (node.type === 'strong') runs.push(...runsOfInline(node.children, { ...style, bold: true }));
    else if (node.type === 'em') runs.push(...runsOfInline(node.children, { ...style, italic: true }));
    else if (node.type === 'del') runs.push(...runsOfInline(node.children, style));
    else if (node.type === 'link') runs.push(...runsOfInline(node.children, { ...style, href: node.href }));
  }
  return mergeRuns(runs);
}

/** Neighbouring runs with the same style become one: fewer pieces to measure and draw. */
export function mergeRuns(runs: Run[]): Run[] {
  const merged: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.code === !!run.code && last.href === run.href) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/** A line of text with light inline Markdown, as runs. */
export function runsOf(value: string): Run[] {
  const blocks = parseMarkdown(value);
  const first = blocks.find(block => block.type === 'paragraph' || block.type === 'heading');
  if (first && (first.type === 'paragraph' || first.type === 'heading')) return runsOfInline(first.children);
  return value ? [{ text: value }] : [];
}

export const plainOf = (runs: Run[]) => runs.map(run => run.text).join('');

export function specFromInput(input: DocumentInput, extra: Pick<DocumentSpec, 'theme' | 'runningTitle' | 'brand'> = {}): DocumentSpec {
  const blocks = input.blocks.map((block): DocBlock => {
    switch (block.type) {
      case 'heading': return { type: 'heading', level: block.level as 1 | 2 | 3, runs: runsOf(block.text) };
      case 'paragraph': return { type: 'paragraph', runs: runsOf(block.text) };
      case 'list': return { type: 'list', ordered: Boolean(block.ordered), items: block.items.map(item => ({ runs: runsOf(item) })) };
      case 'table': return {
        type: 'table', caption: block.caption,
        columns: block.columns.map((header, index) => ({ header: runsOf(header), align: block.align?.[index] })),
        rows: block.rows.map(row => block.columns.map((_, index) => runsOf(row[index] ?? ''))),
      };
      case 'callout': return { type: 'callout', tone: block.tone, title: block.title, runs: runsOf(block.text) };
      case 'figures': return { type: 'figures', items: block.items };
      case 'quote': return { type: 'quote', runs: runsOf(block.text), cite: block.cite };
      case 'bars': return { type: 'bars', title: block.title, unit: block.unit, items: block.items };
      case 'divider': return { type: 'divider' };
      case 'pageBreak': return { type: 'pageBreak' };
    }
  });
  return { title: input.title, subtitle: input.subtitle, kicker: input.kicker, meta: input.meta, cover: input.cover, blocks, ...extra };
}

// ─── Markdown document → spec (what Cowork's documents already are) ────────────────────────────────────────────────────────────

const CALLOUT_LEAD = /^\s*(nota|importante|atenci[oó]n|ojo|alerta|riesgo|advertencia|conclusi[oó]n|recomendaci[oó]n|resumen|dato)\s*[:：]\s*/i;
const TONES: Record<string, Tone> = { nota: 'info', dato: 'info', resumen: 'info', importante: 'warning', 'atención': 'warning', atencion: 'warning', ojo: 'warning', alerta: 'warning', riesgo: 'warning', advertencia: 'warning', 'conclusión': 'success', conclusion: 'success', 'recomendación': 'success', recomendacion: 'success' };

function listItems(items: Array<{ children: MdBlock[] }>): ListItem[] {
  return items.map(item => {
    const first = item.children.find(child => child.type === 'paragraph');
    const nested = item.children.filter((child): child is Extract<MdBlock, { type: 'list' }> => child.type === 'list');
    return { runs: first && first.type === 'paragraph' ? runsOfInline(first.children) : [], sub: nested.length ? nested.flatMap(list => listItems(list.items)) : undefined };
  });
}

/**
 * The Markdown AST of a Cowork document as a spec: a blockquote that opens with «Nota:» or «Importante:» becomes a callout, the rest of a
 * quote stays a quote, tables keep their alignment, and the title is the document's own. The first heading that repeats the title is dropped.
 */
export function specFromMarkdown(title: string, blocks: MdBlock[], extra: Partial<Omit<DocumentSpec, 'title' | 'blocks'>> = {}): DocumentSpec {
  const out: DocBlock[] = [];
  const titleKey = title.trim().toLowerCase();
  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'heading': {
        const runs = runsOfInline(block.children);
        if (index === 0 && block.level === 1 && plainOf(runs).trim().toLowerCase() === titleKey) return;
        out.push({ type: 'heading', level: Math.min(3, Math.max(1, block.level)) as 1 | 2 | 3, runs });
        return;
      }
      case 'paragraph': out.push({ type: 'paragraph', runs: runsOfInline(block.children) }); return;
      case 'list': out.push({ type: 'list', ordered: block.ordered, items: listItems(block.items) }); return;
      case 'blockquote': {
        const paragraphs = block.children.filter((child): child is Extract<MdBlock, { type: 'paragraph' }> => child.type === 'paragraph');
        const runs = paragraphs.flatMap((paragraph, position) => [...(position ? [{ text: '\n' }] : []), ...runsOfInline(paragraph.children)]);
        const lead = CALLOUT_LEAD.exec(plainOf(runs));
        if (lead && runs.length) {
          const stripped = runs.map((run, position) => (position === 0 ? { ...run, text: run.text.replace(CALLOUT_LEAD, '') } : run));
          out.push({ type: 'callout', tone: TONES[lead[1].toLowerCase()] ?? 'info', title: lead[1][0].toUpperCase() + lead[1].slice(1).toLowerCase(), runs: mergeRuns(stripped) });
        } else if (runs.length) out.push({ type: 'quote', runs: mergeRuns(runs) });
        return;
      }
      case 'code': out.push({ type: 'code', text: block.value }); return;
      case 'table': out.push({
        type: 'table',
        columns: block.header.map((header, column) => ({ header: runsOfInline(header), align: block.align[column] ?? undefined })),
        rows: block.rows.map(row => block.header.map((_, column) => runsOfInline(row[column] ?? []))),
      }); return;
      case 'hr': out.push({ type: 'divider' }); return;
    }
  });
  return { title, blocks: out, ...extra };
}

// The inspector: what a person would notice on opening the document, found from the laid out pages without a model. A heading alone at the
// bottom of a page, text outside the margins, a table row taller than a page, a last page with three lines, a blank page, type too small to
// read. Each finding says where and, when the layout can fix it by itself, how; `improveLayout` applies those fixes and lays out again until
// the document is clean or nothing more can be done. What needs judgement (a paragraph that says nothing, a table that should be a chart) is
// for the reviewer (review.ts), which reads the pages as images.
import { bodyHeight, layoutDocument, type Layout, type LayoutIssue, type LayoutOptions, type Measure } from './layout';
import type { DocumentSpec } from './spec';

export type DocumentIssue = LayoutIssue & { fix?: 'compact' | 'break-before' | 'table-scale'; block?: number };

const MIN_TEXT_SIZE = 7.5;
const SPARSE_LAST_PAGE = 0.14;

export function inspectLayout(layout: Layout): DocumentIssue[] {
  const issues: DocumentIssue[] = layout.issues.map(issue => ({ ...issue, fix: issue.kind === 'table-row-too-tall' ? 'table-scale' : undefined }));
  const { page: geometry } = layout.theme;
  const left = geometry.left - 0.6;
  const right = geometry.width - geometry.right + 0.6;
  const body = bodyHeight(layout.theme);

  layout.pages.forEach((page, index) => {
    const number = index + 1;
    if (page.kind === 'body' && !page.ops.length) return;
    const outside = page.ops.find(op => op.t === 'text' && op.tag !== 'footer' && op.tag !== 'header' && op.tag !== 'brand' && (op.x < left || op.x + op.w > right));
    if (outside && outside.t === 'text') issues.push({ severity: 'error', kind: 'outside-margin', page: number, message: `El texto «${outside.text.slice(0, 40)}» se sale del margen.` });
    const tiny = page.ops.find(op => op.t === 'text' && op.size < MIN_TEXT_SIZE && op.tag !== 'footer' && op.tag !== 'header');
    if (tiny) issues.push({ severity: 'warn', kind: 'tiny-text', page: number, message: 'Hay texto demasiado pequeño para leerse con comodidad.' });
    for (const heading of page.headings) {
      // Less than two lines of body after it on its page: the heading is alone at the bottom.
      if (heading.y > geometry.height - geometry.bottom - 18 && heading.followed < 14) {
        issues.push({ severity: 'warn', kind: 'orphan-heading', page: number, message: `El título «${heading.text.slice(0, 50)}» quedó solo al final de la página.`, fix: 'break-before', block: heading.block });
      }
    }
  });

  const bodies = layout.pages.filter(page => page.kind === 'body');
  const last = bodies[bodies.length - 1];
  if (bodies.length > 1 && last && (last.bottom - geometry.top) / body < SPARSE_LAST_PAGE) {
    issues.push({ severity: 'warn', kind: 'sparse-last-page', page: layout.pages.indexOf(last) + 1, message: 'La última página tiene muy poco contenido.', fix: 'compact' });
  }

  // Content that says nothing: a heading followed by another of the same or a higher level.
  const blocks = layout.spec.blocks;
  blocks.forEach((block, index) => {
    const next = blocks[index + 1];
    if (block.type === 'heading' && next?.type === 'heading' && next.level <= block.level) {
      issues.push({ severity: 'warn', kind: 'empty-section', page: 0, message: `La sección «${block.runs.map(run => run.text).join('').slice(0, 50)}» no tiene contenido.`, block: index });
    }
  });
  return issues;
}

export type Improved = { layout: Layout; issues: DocumentIssue[]; options: LayoutOptions; attempts: number };

/**
 * Lays the spec out, inspects it, applies the fixes the layout can make on its own (a page break before a stranded heading, tighter spacing
 * for a sparse last page, smaller table type for a row too tall) and lays it out again; keeps the best result. Never loops: each fix is tried once.
 */
export function improveLayout(spec: DocumentSpec, measure: Measure, base: LayoutOptions = {}): Improved {
  let options: LayoutOptions = { ...base };
  let layout = layoutDocument(spec, measure, options);
  let issues = inspectLayout(layout);
  const score = (items: DocumentIssue[]) => items.reduce((sum, item) => sum + (item.severity === 'error' ? 10 : 1), 0);
  let attempts = 1;
  const tried = new Set<string>();

  for (let round = 0; round < 8; round++) {
    const fixable = issues.find(issue => issue.fix && !tried.has(`${issue.fix}:${issue.block ?? ''}`) && !(issue.fix === 'compact' && tried.size > 4));
    if (!fixable) break;
    const key = `${fixable.fix}:${fixable.block ?? ''}`;
    tried.add(key);
    let next: LayoutOptions;
    if (fixable.fix === 'break-before' && fixable.block !== undefined) next = { ...options, breakBefore: new Set([...(options.breakBefore ?? []), fixable.block]) };
    else if (fixable.fix === 'table-scale') next = { ...options, tableScale: (options.tableScale ?? 1) * 0.9 };
    else if (fixable.fix === 'compact') next = { ...options, compact: (options.compact ?? 1) * 0.93 };
    else break;
    const candidate = layoutDocument(spec, measure, next);
    const found = inspectLayout(candidate);
    attempts += 1;
    // Keep a fix only if it did not make the document worse (fewer pages never counts as worse).
    if (score(found) < score(issues) || (score(found) === score(issues) && candidate.pages.length <= layout.pages.length)) {
      options = next;
      layout = candidate;
      issues = found;
      // A compact fix that worked can be tried once more if the last page is still sparse.
      if (fixable.fix === 'compact') tried.delete(key);
    }
  }
  return { layout, issues, options, attempts };
}

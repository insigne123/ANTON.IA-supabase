// The layout engine: a DocumentSpec becomes pages of drawing operations (text at a position, a rectangle, a line), the same for every output.
// The PDF writes those operations with jsPDF, the preview draws them as SVG, and the inspector reads them to find what a person would see go
// wrong (a heading alone at the bottom of a page, a table row taller than a page, a last page with three lines, text outside the margins).
// Typography is the work of this file: a type scale, a vertical rhythm, widow and orphan control, headings that stay with what they introduce,
// tables whose header repeats across pages, and numbers aligned to the right. Text is measured by a function the backend gives, so layout
// and output agree. Pure: no jsPDF, no SDK.
import { plainOf, type DocBlock, type DocumentSpec, type ListItem, type Run, type Tone } from './spec';
import { themeOf, type RGB, type Theme } from './theme';

export type Font = { family: 'helvetica' | 'courier'; bold?: boolean; italic?: boolean };
export type Measure = (text: string, font: Font, size: number) => number;

export type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: RGB; stroke?: RGB; lineWidth?: number; radius?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: RGB; width: number }
  | { t: 'circle'; x: number; y: number; r: number; fill: RGB }
  | { t: 'text'; x: number; y: number; text: string; font: Font; size: number; color: RGB; href?: string; underline?: boolean; w: number; tag?: string };

export type LaidPage = {
  kind: 'cover' | 'body';
  ops: Op[];
  /** The lowest point content reaches, from the top of the page, for the «last page nearly empty» check. */
  bottom: number;
  /** Headings on the page with where they sit, and how much content follows on the same page. */
  headings: Array<{ y: number; level: number; text: string; followed: number; block: number }>;
};

export type LayoutIssue = { severity: 'warn' | 'error'; kind: string; page: number; message: string };

export type LayoutOptions = {
  /** Multiplier of the vertical rhythm (1 normal, below 1 tighter): the inspector's way to pull a last page back. */
  compact?: number;
  /** Multiplier of the table type size. */
  tableScale?: number;
  /** Blocks that start a new page (by index), for a heading that ended alone. */
  breakBefore?: ReadonlySet<number>;
  /** The date on the cover and in the footer. */
  date?: string;
};

export type Layout = { pages: LaidPage[]; issues: LayoutIssue[]; theme: Theme; options: LayoutOptions; spec: DocumentSpec };

const PT = 0.3528;
const NUMERIC = /^[\s$€£+\-−–.,0-9%]+(?:\s?(?:CLP|USD|UF|UTM|MM|M|K|x|veces|días|dias|pp))?$/i;
const MIN_LINES = 2;

type Piece = { text: string; font: Font; width: number; color?: RGB; href?: string; underline?: boolean };
type Line = { pieces: Piece[]; width: number };
type Base = { bold?: boolean; italic?: boolean; color?: RGB };

const fontOf = (run: Run, base: Base): Font => ({ family: run.code ? 'courier' : 'helvetica', bold: Boolean(run.bold || base.bold), italic: Boolean(run.italic || base.italic) });

export function layoutDocument(spec: DocumentSpec, measure: Measure, options: LayoutOptions = {}): Layout {
  const theme = themeOf(spec.theme);
  const { page: geometry, type: scale, space } = theme;
  const rhythm = options.compact ?? 1;
  const tableSize = scale.table * (options.tableScale ?? 1);
  const left = geometry.left;
  const width = geometry.width - geometry.left - geometry.right;
  const top = geometry.top;
  const bottom = geometry.height - geometry.bottom;
  const pages: LaidPage[] = [];
  const issues: LayoutIssue[] = [];
  let current: LaidPage;
  let y = top;

  const addPage = (kind: 'cover' | 'body' = 'body') => { current = { kind, ops: [], bottom: top, headings: [] }; pages.push(current); y = top; };
  const push = (op: Op, reach?: number) => {
    current.ops.push(op);
    const low = reach ?? (op.t === 'rect' ? op.y + op.h : op.t === 'line' ? Math.max(op.y1, op.y2) : op.t === 'circle' ? op.y + op.r : op.y);
    if (low > current.bottom) current.bottom = low;
  };
  const warn = (severity: LayoutIssue['severity'], kind: string, message: string) => issues.push({ severity, kind, page: pages.length, message });
  const lineHeight = (size: number) => size * PT * scale.leading;
  const gap = (mm: number) => mm * rhythm;
  /** Starts a new page when `height` does not fit; returns whether it did. */
  const ensure = (height: number) => {
    if (y + height <= bottom + 0.01) return false;
    addPage();
    return true;
  };

  // ─── Text ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const wrap = (runs: Run[], size: number, maxWidth: number, base: Base = {}): Line[] => {
    const lines: Line[] = [{ pieces: [], width: 0 }];
    const newline = () => lines.push({ pieces: [], width: 0 });
    const put = (piece: Piece) => { const line = lines[lines.length - 1]; line.pieces.push(piece); line.width += piece.width; };
    for (const run of runs) {
      const font = fontOf(run, base);
      const color = run.href ? theme.link : base.color;
      run.text.split('\n').forEach((segment, index) => {
        if (index > 0) newline();
        for (const token of segment.match(/\S+\s*|\s+/g) || []) {
          const tokenWidth = measure(token, font, size);
          const trimmed = measure(token.trimEnd(), font, size);
          let line = lines[lines.length - 1];
          if (line.width + trimmed > maxWidth && line.width > 0) { newline(); if (!token.trim()) continue; line = lines[lines.length - 1]; }
          if (trimmed <= maxWidth) { put({ text: token, font, width: tokenWidth, color, href: run.href, underline: Boolean(run.href) }); continue; }
          // A token wider than a line (a long address, a hash) is cut where it has to be.
          let chunk = '';
          for (const char of token) {
            if (measure(chunk + char, font, size) > maxWidth && chunk) { put({ text: chunk, font, width: measure(chunk, font, size), color, href: run.href }); newline(); chunk = char; } else chunk += char;
          }
          if (chunk) put({ text: chunk, font, width: measure(chunk, font, size), color, href: run.href });
        }
      });
    }
    // Trailing blank lines (a break at the end of a run) carry nothing.
    while (lines.length > 1 && !lines[lines.length - 1].pieces.length) lines.pop();
    return lines;
  };

  const baselineIn = (top0: number, size: number) => top0 + (lineHeight(size) + size * PT * 0.72) / 2;

  const drawLine = (line: Line, x: number, top0: number, size: number, color: RGB, align: 'left' | 'right' | 'center' = 'left', maxWidth = width, tag?: string) => {
    const trailing = line.pieces.length ? measure(line.pieces[line.pieces.length - 1].text.match(/\s*$/)?.[0] ?? '', line.pieces[line.pieces.length - 1].font, size) : 0;
    const visible = line.width - trailing;
    let cursor = align === 'left' ? x : align === 'right' ? x + maxWidth - visible : x + (maxWidth - visible) / 2;
    const baseline = baselineIn(top0, size);
    // Neighbouring words in the same style are one run of text: the viewer spaces them with its own font, and the text stays selectable and searchable.
    const same = (a: Piece, b: Piece) => a.font.family === b.font.family && !!a.font.bold === !!b.font.bold && !!a.font.italic === !!b.font.italic
      && a.color === b.color && a.href === b.href && !!a.underline === !!b.underline;
    let index = 0;
    while (index < line.pieces.length) {
      let end = index + 1;
      while (end < line.pieces.length && same(line.pieces[index], line.pieces[end])) end += 1;
      const group = line.pieces.slice(index, end);
      const text = group.map(piece => piece.text).join('').trimEnd();
      const widthOfGroup = group.reduce((sum, piece) => sum + piece.width, 0);
      if (text.trim()) push({ t: 'text', x: cursor, y: baseline, text, font: group[0].font, size, color: group[0].color ?? color, href: group[0].href, underline: group[0].underline, w: widthOfGroup, tag }, top0 + lineHeight(size));
      cursor += widthOfGroup;
      index = end;
    }
  };

  /** A block of lines, one after another, with widow and orphan control: at least two lines stay on each side of a page break. */
  const flow = (lines: Line[], x: number, maxWidth: number, size: number, color: RGB, tag: string) => {
    const lh = lineHeight(size);
    let index = 0;
    while (index < lines.length) {
      const remaining = lines.length - index;
      let fit = Math.floor((bottom - y + 0.01) / lh);
      if (fit >= remaining) fit = remaining;
      else if (fit < MIN_LINES) fit = 0;
      else if (remaining - fit < MIN_LINES) {
        // Splitting here would leave one line alone on the next page: pull a line over, or move the whole block.
        fit = remaining - MIN_LINES;
        if (fit < MIN_LINES) fit = 0;
      }
      // At the top of a page there is nowhere better to go.
      if (fit === 0 && y <= top + 0.01) fit = Math.min(remaining, Math.max(1, Math.floor((bottom - y + 0.01) / lh)));
      if (fit <= 0) { addPage(); continue; }
      for (let row = 0; row < fit; row++) { drawLine(lines[index + row], x, y + row * lh, size, color, 'left', maxWidth, tag); }
      y += fit * lh;
      index += fit;
      if (index < lines.length) addPage();
    }
  };

  // ─── Blocks ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let blockIndex = 0;
  const headingBlock = (block: Extract<DocBlock, { type: 'heading' }>) => {
    const size = block.level === 1 ? scale.h1 : block.level === 2 ? scale.h2 : scale.h3;
    const before = gap(block.level === 1 ? space.heading1 : block.level === 2 ? space.heading2 : space.heading3);
    const color = block.level === 1 ? theme.ink : block.level === 2 ? theme.accentDark : theme.ink;
    const lines = wrap(block.runs, size, width, { bold: true, color });
    const lh = lineHeight(size);
    const after = block.level === 1 ? gap(4.5) : gap(2);
    // A heading never ends a page: it moves with at least two lines of what it introduces.
    const needs = (y > top ? before : 0) + lines.length * lh + after + (block.level === 1 ? 1.2 : 0) + lineHeight(scale.body) * MIN_LINES;
    if (y + needs > bottom + 0.01 && y > top) addPage();
    if (y > top) y += before;
    const startY = y;
    lines.forEach((line, index) => drawLine(line, left, y + index * lh, size, color, 'left', width, `h${block.level}`));
    y += lines.length * lh;
    current.headings.push({ y: startY, level: block.level, text: plainOf(block.runs), followed: 0, block: blockIndex });
    if (block.level === 1) {
      push({ t: 'line', x1: left, y1: y + 1.2, x2: left + width, y2: y + 1.2, color: theme.rule, width: 0.25 });
      push({ t: 'line', x1: left, y1: y + 1.2, x2: left + 22, y2: y + 1.2, color: theme.accent, width: 0.8 });
      y += 1.2;
    }
    y += after;
  };

  const paragraphBlock = (runs: Run[], size = scale.body, color: RGB = theme.ink, x = left, maxWidth = width, after = gap(space.paragraph), base: Base = {}) => {
    const lines = wrap(runs, size, maxWidth, { ...base, color: base.color });
    if (!lines.length || !lines[0].pieces.length) return;
    flow(lines, x, maxWidth, size, color, 'p');
    y += after;
  };

  const listBlock = (items: ListItem[], ordered: boolean, depth = 0) => {
    const size = scale.body;
    const lh = lineHeight(size);
    const indent = 6.5;
    const x = left + depth * indent;
    items.forEach((item, index) => {
      const lines = wrap(item.runs, size, width - depth * indent - indent);
      const height = Math.max(1, lines.length) * lh;
      // A short item stays whole.
      if (lines.length <= 3) ensure(height);
      else if (y + lh * MIN_LINES > bottom) addPage();
      const markerTop = y;
      if (ordered) {
        const label = `${index + 1}.`;
        push({ t: 'text', x: x + indent - 1.2 - measure(label, { family: 'helvetica', bold: true }, size), y: baselineIn(markerTop, size), text: label, font: { family: 'helvetica', bold: true }, size, color: theme.accent, w: 0, tag: 'li' });
      } else {
        push({ t: 'circle', x: x + 2.1, y: baselineIn(markerTop, size) - size * PT * 0.32, r: depth ? 0.55 : 0.7, fill: depth ? theme.muted : theme.accent });
      }
      flow(lines.length ? lines : [{ pieces: [], width: 0 }], x + indent, width - depth * indent - indent, size, theme.ink, 'li');
      y += gap(space.list);
      if (item.sub?.length) listBlock(item.sub, ordered, depth + 1);
    });
    y += gap(space.paragraph - space.list);
  };

  const tableBlock = (block: Extract<DocBlock, { type: 'table' }>) => {
    const size = tableSize;
    const lh = lineHeight(size) * 0.95;
    const pad = 2;
    const columns = block.columns.length;
    const cellText = (cell: Run[]) => plainOf(cell);
    // The width each column wants: its widest word and its whole text, as a share of the table; none under 16 mm.
    const natural = block.columns.map((column, c) => {
      const texts = [cellText(column.header), ...block.rows.map(row => cellText(row[c] ?? []))];
      const whole = Math.max(...texts.map(text => measure(text, { family: 'helvetica', bold: false }, size)));
      const word = Math.max(...texts.flatMap(text => text.split(/\s+/)).map(token => measure(token, { family: 'helvetica', bold: true }, size)));
      return { whole: Math.min(whole, width * 0.6), word: Math.min(word, width * 0.4) };
    });
    const minimum = natural.map(item => Math.max(16, item.word + pad * 2 + 1));
    let widths = natural.map((item, c) => Math.max(minimum[c], item.whole + pad * 2));
    const total = widths.reduce((sum, value) => sum + value, 0);
    if (total > width) {
      // Wider than the page: the columns keep their minimum and share what is left by how much text they have.
      const extra = widths.map((value, c) => value - minimum[c]);
      const spare = Math.max(0, width - minimum.reduce((sum, value) => sum + value, 0));
      const sum = extra.reduce((a, b) => a + b, 0) || 1;
      widths = minimum.map((value, c) => value + (spare * extra[c]) / sum);
      const scaled = widths.reduce((a, b) => a + b, 0);
      if (scaled > width + 0.01) widths = widths.map(value => (value * width) / scaled);
    } else widths = widths.map(value => value + (width - total) / columns);
    const aligns = block.columns.map((column, c) => column.align
      ?? (block.rows.length && block.rows.every(row => { const text = cellText(row[c] ?? []).trim(); return !text || NUMERIC.test(text); }) && block.rows.some(row => cellText(row[c] ?? []).trim()) ? 'right' : 'left'));
    const xs = widths.map((_, c) => left + widths.slice(0, c).reduce((sum, value) => sum + value, 0));
    const layoutRow = (cells: Run[][], bold: boolean) => cells.map((cell, c) => wrap(cell, size, widths[c] - pad * 2, { bold }));
    const rowHeight = (cells: Line[][]) => Math.max(1, ...cells.map(lines => lines.length)) * lh + pad * 2;
    const header = layoutRow(block.columns.map(column => column.header), true);
    const headerHeight = rowHeight(header);
    const drawHeader = () => {
      push({ t: 'rect', x: left, y, w: width, h: headerHeight, fill: theme.accentDark });
      header.forEach((lines, c) => lines.forEach((line, index) => drawLine(line, xs[c] + pad, y + pad + index * lh, size, theme.white, aligns[c], widths[c] - pad * 2, 'th')));
      y += headerHeight;
    };
    if (block.caption) {
      const captionLines = wrap([{ text: block.caption, italic: true }], scale.caption + 0.5, width, { color: theme.muted });
      ensure(captionLines.length * lineHeight(scale.caption + 0.5) + headerHeight + (layoutRow(block.rows[0] ?? [], false).length ? lh + pad * 2 : 0));
      captionLines.forEach((line, index) => drawLine(line, left, y + index * lineHeight(scale.caption + 0.5), scale.caption + 0.5, theme.muted, 'left', width, 'caption'));
      y += captionLines.length * lineHeight(scale.caption + 0.5) + 1;
    }
    const firstRow = block.rows.length ? rowHeight(layoutRow(block.rows[0], false)) : 0;
    ensure(headerHeight + firstRow);
    drawHeader();
    block.rows.forEach((row, r) => {
      const cells = layoutRow(row, false);
      const height = rowHeight(cells);
      if (height > bottom - top) warn('error', 'table-row-too-tall', `Una fila de la tabla es más alta que la página (${Math.round(height)} mm).`);
      if (y + height > bottom + 0.01) { addPage(); drawHeader(); }
      if (r % 2 === 1) push({ t: 'rect', x: left, y, w: width, h: height, fill: theme.zebra });
      cells.forEach((lines, c) => lines.forEach((line, index) => drawLine(line, xs[c] + pad, y + pad + index * lh, size, theme.ink, aligns[c], widths[c] - pad * 2, 'td')));
      push({ t: 'line', x1: left, y1: y + height, x2: left + width, y2: y + height, color: theme.rule, width: 0.2 });
      y += height;
    });
    y += gap(space.block);
  };

  const calloutBlock = (block: Extract<DocBlock, { type: 'callout' }>) => {
    const tone = theme.tones[block.tone as Tone];
    const size = scale.body - 0.5;
    const pad = 3.6;
    const inner = width - pad * 2 - 1.2;
    const lines = wrap(block.runs, size, inner);
    const lh = lineHeight(size);
    const titleHeight = block.title ? lineHeight(scale.small) + 1 : 0;
    const height = pad * 2 + titleHeight + lines.length * lh;
    if (height > bottom - top) warn('error', 'callout-too-tall', 'Un recuadro es más alto que la página.');
    ensure(Math.min(height, bottom - top));
    push({ t: 'rect', x: left, y, w: width, h: height, fill: tone.fill, radius: 1.2 });
    push({ t: 'rect', x: left, y, w: 1.2, h: height, fill: tone.bar });
    let cursor = y + pad;
    if (block.title) {
      const titleLines = wrap([{ text: block.title.toUpperCase(), bold: true }], scale.small - 0.5, inner, { color: tone.title });
      drawLine(titleLines[0], left + pad + 1.2, cursor, scale.small - 0.5, tone.title, 'left', inner, 'callout-title');
      cursor += titleHeight;
    }
    lines.forEach((line, index) => drawLine(line, left + pad + 1.2, cursor + index * lh, size, theme.ink, 'left', inner, 'callout'));
    y += height + gap(space.block);
  };

  const figuresBlock = (block: Extract<DocBlock, { type: 'figures' }>) => {
    const count = block.items.length;
    const spacing = 3.5;
    const cardWidth = (width - spacing * (count - 1)) / count;
    const pad = 3.2;
    const cards = block.items.map(item => ({
      item,
      label: wrap([{ text: item.label }], scale.small - 0.5, cardWidth - pad * 2, { color: theme.muted }),
      detail: item.detail ? wrap([{ text: item.detail }], scale.caption, cardWidth - pad * 2, { color: theme.muted }) : [],
    }));
    const valueHeight = lineHeight(scale.figure) * 0.95;
    const height = pad * 2 + valueHeight + Math.max(...cards.map(card => card.label.length * lineHeight(scale.small - 0.5) + card.detail.length * lineHeight(scale.caption)));
    ensure(height);
    cards.forEach((card, index) => {
      const x = left + index * (cardWidth + spacing);
      push({ t: 'rect', x, y, w: cardWidth, h: height, fill: theme.accentTint, radius: 1.4 });
      push({ t: 'rect', x, y, w: cardWidth, h: 0.9, fill: theme.accent, radius: 0 });
      let cursor = y + pad;
      const valueLines = wrap([{ text: card.item.value, bold: true }], scale.figure, cardWidth - pad * 2, { color: theme.accentDark });
      drawLine(valueLines[0], x + pad, cursor, scale.figure, theme.accentDark, 'left', cardWidth - pad * 2, 'figure');
      cursor += valueHeight;
      card.label.forEach(line => { drawLine(line, x + pad, cursor, scale.small - 0.5, theme.muted, 'left', cardWidth - pad * 2, 'figure-label'); cursor += lineHeight(scale.small - 0.5); });
      card.detail.forEach(line => { drawLine(line, x + pad, cursor, scale.caption, theme.muted, 'left', cardWidth - pad * 2, 'figure-detail'); cursor += lineHeight(scale.caption); });
    });
    y += height + gap(space.block);
  };

  const quoteBlock = (block: Extract<DocBlock, { type: 'quote' }>) => {
    const size = scale.body + 0.5;
    const inner = width - 8;
    const lines = wrap(block.runs, size, inner, { italic: true, color: theme.ink });
    const cite = block.cite ? wrap([{ text: `— ${block.cite}` }], scale.small, inner, { color: theme.muted }) : [];
    const height = lines.length * lineHeight(size) + cite.length * lineHeight(scale.small) + 1;
    ensure(Math.min(height, bottom - top));
    const startY = y;
    lines.forEach((line, index) => drawLine(line, left + 6, y + index * lineHeight(size), size, theme.ink, 'left', inner, 'quote'));
    cite.forEach((line, index) => drawLine(line, left + 6, y + lines.length * lineHeight(size) + 1 + index * lineHeight(scale.small), scale.small, theme.muted, 'left', inner, 'quote-cite'));
    push({ t: 'rect', x: left, y: startY, w: 0.9, h: height, fill: theme.accent });
    y += height + gap(space.block);
  };

  const codeBlock = (block: Extract<DocBlock, { type: 'code' }>) => {
    const size = scale.code;
    const lh = lineHeight(size) * 0.95;
    const pad = 2.6;
    const font: Font = { family: 'courier' };
    const lines: string[] = [];
    for (const source of block.text.split('\n')) {
      let chunk = '';
      for (const char of source) {
        if (measure(chunk + char, font, size) > width - pad * 2 && chunk) { lines.push(chunk); chunk = char; } else chunk += char;
      }
      lines.push(chunk);
    }
    let index = 0;
    while (index < lines.length) {
      const room = Math.floor((bottom - y - pad * 2) / lh);
      if (room < MIN_LINES) { addPage(); continue; }
      const take = Math.min(room, lines.length - index);
      const height = take * lh + pad * 2;
      push({ t: 'rect', x: left, y, w: width, h: height, fill: theme.codeFill, radius: 1 });
      for (let row = 0; row < take; row++) push({ t: 'text', x: left + pad, y: baselineIn(y + pad + row * lh, size), text: lines[index + row], font, size, color: theme.ink, w: 0, tag: 'code' }, y + pad + (row + 1) * lh);
      y += height;
      index += take;
      if (index < lines.length) addPage();
    }
    y += gap(space.block);
  };

  const barsBlock = (block: Extract<DocBlock, { type: 'bars' }>) => {
    const size = scale.small;
    const rowHeight = 7;
    const labelWidth = Math.min(58, Math.max(...block.items.map(item => measure(item.label, { family: 'helvetica' }, size))) + 3);
    const valueWidth = 22;
    const barSpace = width - labelWidth - valueWidth;
    const maximum = Math.max(...block.items.map(item => item.value), 1);
    const titleHeight = block.title ? lineHeight(scale.small + 1) + 1.5 : 0;
    ensure(titleHeight + rowHeight * Math.min(block.items.length, 6));
    if (block.title) {
      const lines = wrap([{ text: block.title, bold: true }], scale.small + 1, width, { color: theme.ink });
      drawLine(lines[0], left, y, scale.small + 1, theme.ink, 'left', width, 'bars-title');
      y += titleHeight;
    }
    block.items.forEach(item => {
      ensure(rowHeight);
      const label = wrap([{ text: item.label }], size, labelWidth - 3, { color: theme.ink })[0];
      drawLine(label, left, y + (rowHeight - lineHeight(size)) / 2, size, theme.ink, 'left', labelWidth - 3, 'bars-label');
      push({ t: 'rect', x: left + labelWidth, y: y + 1.4, w: barSpace, h: rowHeight - 2.8, fill: theme.zebra, radius: 0.8 });
      push({ t: 'rect', x: left + labelWidth, y: y + 1.4, w: Math.max(0.8, (barSpace * item.value) / maximum), h: rowHeight - 2.8, fill: theme.accent, radius: 0.8 });
      const text = `${Number.isInteger(item.value) ? item.value.toLocaleString('es-CL') : item.value.toLocaleString('es-CL', { maximumFractionDigits: 1 })}${block.unit ? ` ${block.unit}` : ''}`;
      const value = wrap([{ text, bold: true }], size, valueWidth, { color: theme.ink })[0];
      drawLine(value, left + labelWidth + barSpace + 2, y + (rowHeight - lineHeight(size)) / 2, size, theme.ink, 'left', valueWidth - 2, 'bars-value');
      y += rowHeight;
    });
    y += gap(space.block);
  };

  // ─── Cover ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const cover = () => {
    addPage('cover');
    push({ t: 'rect', x: 0, y: 0, w: geometry.width, h: 14, fill: theme.accentDark });
    push({ t: 'rect', x: 0, y: 14, w: geometry.width, h: 1.6, fill: theme.accent });
    y = 78;
    if (spec.kicker) {
      const lines = wrap([{ text: spec.kicker.toUpperCase(), bold: true }], scale.small + 0.5, width, { color: theme.accent });
      drawLine(lines[0], left, y, scale.small + 0.5, theme.accent, 'left', width, 'kicker');
      y += lineHeight(scale.small + 0.5) + 4;
    }
    const titleLines = wrap([{ text: spec.title, bold: true }], scale.title, width, { color: theme.ink });
    titleLines.forEach((line, index) => drawLine(line, left, y + index * lineHeight(scale.title) * 0.95, scale.title, theme.ink, 'left', width, 'title'));
    y += titleLines.length * lineHeight(scale.title) * 0.95 + 4;
    push({ t: 'line', x1: left, y1: y, x2: left + 28, y2: y, color: theme.accent, width: 1.2 });
    y += 7;
    if (spec.subtitle) {
      const lines = wrap([{ text: spec.subtitle }], scale.subtitle, width * 0.85, { color: theme.muted });
      lines.forEach((line, index) => drawLine(line, left, y + index * lineHeight(scale.subtitle), scale.subtitle, theme.muted, 'left', width, 'subtitle'));
      y += lines.length * lineHeight(scale.subtitle) + 6;
    }
    const meta = [...(spec.meta ?? []), ...(options.date ? [{ label: 'Fecha', value: options.date }] : [])];
    if (meta.length) {
      y = Math.max(y + 10, 200);
      push({ t: 'line', x1: left, y1: y - 4, x2: left + width, y2: y - 4, color: theme.rule, width: 0.25 });
      for (const item of meta) {
        const label = wrap([{ text: item.label.toUpperCase(), bold: true }], scale.caption, 38, { color: theme.muted })[0];
        drawLine(label, left, y, scale.caption, theme.muted, 'left', 38, 'meta-label');
        const value = wrap([{ text: item.value }], scale.body, width - 42, { color: theme.ink });
        value.forEach((line, index) => drawLine(line, left + 42, y + index * lineHeight(scale.body) - 0.4, scale.body, theme.ink, 'left', width - 42, 'meta'));
        y += Math.max(1, value.length) * lineHeight(scale.body) + 2.5;
      }
    }
    const brand = wrap([{ text: 'ANTON.IA', bold: true }], scale.small, 60, { color: theme.accentDark })[0];
    drawLine(brand, left, geometry.height - 22, scale.small, theme.accentDark, 'left', 60, 'brand');
    addPage();
  };

  // ─── Body ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (spec.cover) cover(); else addPage();
  if (!spec.cover) {
    // Without a cover the title opens the first page.
    const lines = wrap([{ text: spec.title, bold: true }], scale.title - 6, width, { color: theme.ink });
    const size = scale.title - 6;
    lines.forEach((line, index) => drawLine(line, left, y + index * lineHeight(size), size, theme.ink, 'left', width, 'title'));
    y += lines.length * lineHeight(size) + 1.5;
    if (spec.subtitle) {
      const sub = wrap([{ text: spec.subtitle }], scale.subtitle - 1, width, { color: theme.muted });
      sub.forEach((line, index) => drawLine(line, left, y + index * lineHeight(scale.subtitle - 1), scale.subtitle - 1, theme.muted, 'left', width, 'subtitle'));
      y += sub.length * lineHeight(scale.subtitle - 1) + 1;
    }
    const byline = [...(spec.meta ?? []).map(item => `${item.label}: ${item.value}`), ...(options.date ? [options.date] : [])].join('   ·   ');
    if (byline) {
      const lines2 = wrap([{ text: byline }], scale.small, width, { color: theme.muted });
      lines2.forEach((line, index) => drawLine(line, left, y + 1 + index * lineHeight(scale.small), scale.small, theme.muted, 'left', width, 'byline'));
      y += lines2.length * lineHeight(scale.small) + 1;
    }
    push({ t: 'line', x1: left, y1: y + 2, x2: left + width, y2: y + 2, color: theme.rule, width: 0.3 });
    push({ t: 'line', x1: left, y1: y + 2, x2: left + 22, y2: y + 2, color: theme.accent, width: 0.9 });
    y += 6;
  }

  spec.blocks.forEach((block, index) => {
    blockIndex = index;
    if (options.breakBefore?.has(index) && y > top) addPage();
    switch (block.type) {
      case 'heading': headingBlock(block); break;
      case 'paragraph': paragraphBlock(block.runs); break;
      case 'list': listBlock(block.items, block.ordered); break;
      case 'table': tableBlock(block); break;
      case 'callout': calloutBlock(block); break;
      case 'figures': figuresBlock(block); break;
      case 'quote': quoteBlock(block); break;
      case 'code': codeBlock(block); break;
      case 'bars': barsBlock(block); break;
      case 'divider': ensure(8); push({ t: 'line', x1: left, y1: y + 3, x2: left + width, y2: y + 3, color: theme.rule, width: 0.3 }); y += 8; break;
      case 'pageBreak': if (y > top) addPage(); break;
    }
  });

  // ─── Header and footer, once the total is known ─────────────────────────────────────────────────────────────────────────────
  const total = pages.length;
  const running = spec.runningTitle || spec.title;
  pages.forEach((page, index) => {
    if (page.kind === 'cover') return;
    page.ops.push({ t: 'line', x1: left, y1: geometry.height - 17, x2: left + width, y2: geometry.height - 17, color: theme.rule, width: 0.25 });
    const brandName = spec.brand || 'ANTON.IA';
    const brandWidth = measure(brandName, { family: 'helvetica', bold: true }, scale.caption);
    page.ops.push({ t: 'text', x: left, y: geometry.height - 12.4, text: brandName, font: { family: 'helvetica', bold: true }, size: scale.caption, color: theme.accentDark, w: brandWidth, tag: 'footer' });
    const label = `Página ${index + 1} de ${total}`;
    const labelWidth = measure(label, { family: 'helvetica' }, scale.caption);
    page.ops.push({ t: 'text', x: left + width - labelWidth, y: geometry.height - 12.4, text: label, font: { family: 'helvetica' }, size: scale.caption, color: theme.muted, w: labelWidth, tag: 'footer' });
    if (index > 0) {
      let shown = running;
      while (shown.length > 8 && measure(shown, { family: 'helvetica' }, scale.caption) > width * 0.7) shown = `${shown.slice(0, -2).trimEnd()}...`;
      page.ops.push({ t: 'text', x: left, y: 13, text: shown, font: { family: 'helvetica' }, size: scale.caption, color: theme.muted, w: measure(shown, { family: 'helvetica' }, scale.caption), tag: 'header' });
      page.ops.push({ t: 'line', x1: left, y1: 15.2, x2: left + width, y2: 15.2, color: theme.rule, width: 0.2 });
    }
  });

  // What follows each heading on its page, for the inspector.
  for (const page of pages) {
    for (const heading of page.headings) heading.followed = Math.max(0, page.bottom - heading.y);
  }
  pages.forEach((page, index) => { if (page.kind === 'body' && !page.ops.length) issues.push({ severity: 'warn', kind: 'blank-page', page: index + 1, message: 'Hay una página en blanco.' }); });
  return { pages, issues, theme, options, spec };
}

/** The usable height of a body page, in millimetres. */
export const bodyHeight = (theme: Theme) => theme.page.height - theme.page.bottom - theme.page.top;

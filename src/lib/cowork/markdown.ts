/**
 * Safe, dependency-free Markdown parser for Cowork replies and documents.
 *
 * It produces a small AST that renderers (React, PDF) turn into output. Raw
 * HTML is never interpreted: tags stay literal text, except `<br>` inside a
 * paragraph or table cell, which becomes a line break. Links only keep
 * http(s), mailto and same-app relative paths. Every scan is linear or bounded
 * so a 40 000-character document cannot freeze the page.
 */

export type MdInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MdInline[] }
  | { type: 'em'; children: MdInline[] }
  | { type: 'del'; children: MdInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'br' };

export type MdAlign = 'left' | 'center' | 'right' | null;

export type MdListItem = { checked: boolean | null; children: MdBlock[] };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MdListItem[] }
  | { type: 'blockquote'; children: MdBlock[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] }
  | { type: 'hr' };

const MAX_DEPTH = 8;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const EMPTY_HEADING = /^ {0,3}(#{1,6})[ \t]*$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const TASK = /^\[([ xX])\][ \t]+/;

function indentOf(line: string) {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Removes up to `amount` columns of leading indentation. */
function dedent(line: string, amount: number) {
  let width = 0;
  let index = 0;
  while (index < line.length && width < amount) {
    const char = line[index];
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
    index += 1;
  }
  return line.slice(index);
}

const blank = (line: string | undefined) => !line || !line.trim();

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let code = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') { current += '|'; index += 1; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) { cells.push(current); current = ''; continue; }
    current += char;
  }
  cells.push(current);
  const trimmed = line.trim();
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|') && cells.length) cells.pop();
  return cells.map(cell => cell.trim());
}

function isTableStart(lines: string[], index: number) {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header || !delimiter || !header.includes('|')) return false;
  if (!TABLE_DELIMITER.test(delimiter) || !delimiter.includes('-')) return false;
  // A lone "---" under text is a thematic break, not a one-column table.
  if (!delimiter.includes('|') && splitRow(header).length < 2) return false;
  return splitRow(header).length > 0;
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index] || '';
  return FENCE.test(line) || HEADING.test(line) || EMPTY_HEADING.test(line) || HR.test(line) || QUOTE.test(line)
    || LIST_ITEM.test(line) || isTableStart(lines, index);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decodeEntities(text: string) {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name] ?? _);
}

/** Only http(s), mailto and same-app absolute paths survive. */
export function safeMarkdownHref(value: string): string | null {
  const href = value.trim().replace(/^<|>$/g, '');
  if (/^https?:\/\/[^\s]+$/i.test(href)) {
    try {
      const url = new URL(href);
      return url.username || url.password ? null : url.href;
    } catch {
      return null;
    }
  }
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s\\]*$/.test(href)) return href;
  return null;
}

type Delimiter = '**' | '__' | '~~' | '*' | '_';

const WORD = /[\p{L}\p{N}]/u;
const PUNCTUATION = /[!-/:-@[-`{-~]/;

/** Linear-time inline parser. `missing` remembers delimiters with no closer. */
function parseInlineAt(text: string, depth: number, inLink: boolean): MdInline[] {
  const nodes: MdInline[] = [];
  const missing = new Map<string, number>();
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', value: decodeEntities(buffer) });
    buffer = '';
  };
  const findCloser = (delimiter: Delimiter, from: number) => {
    const known = missing.get(delimiter);
    if (known !== undefined && from >= known) return -1;
    let position = text.indexOf(delimiter, from);
    while (position !== -1) {
      const before = text[position - 1] || '';
      const after = text[position + delimiter.length] || '';
      const validSingle = delimiter.length === 1
        ? text[position + 1] !== delimiter && before !== delimiter
        : true;
      const underscoreBoundary = delimiter[0] !== '_' || !WORD.test(after);
      if (position > from && before.trim() && validSingle && underscoreBoundary) return position;
      position = text.indexOf(delimiter, position + 1);
    }
    missing.set(delimiter, Math.min(from, missing.get(delimiter) ?? from));
    return -1;
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1] || '';

    if (char === '\\' && PUNCTUATION.test(next)) { buffer += next; index += 2; continue; }

    if (char === '\n') { flush(); nodes.push({ type: 'br' }); index += 1; continue; }

    if (char === '<' && /^<br\s*\/?>/i.test(text.slice(index, index + 6))) {
      const match = /^<br\s*\/?>/i.exec(text.slice(index, index + 6));
      flush(); nodes.push({ type: 'br' }); index += match ? match[0].length : 4; continue;
    }

    if (char === '`') {
      let run = 1;
      while (text[index + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1) {
        flush();
        let value = text.slice(index + run, close).replace(/\n/g, ' ');
        if (value.length > 1 && value.startsWith(' ') && value.endsWith(' ')) value = value.slice(1, -1);
        nodes.push({ type: 'code', value });
        index = close + run;
        continue;
      }
      buffer += fence; index += run; continue;
    }

    if (!inLink && char === '[' && depth < MAX_DEPTH) {
      const link = /^\[((?:[^\[\]\\]|\\.){1,500})\]\(\s*(<[^>\s]+>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\s*\)/.exec(text.slice(index, index + 3000));
      if (link) {
        flush();
        const href = safeMarkdownHref(link[2]);
        const children = parseInlineAt(link[1], depth + 1, true);
        if (href) nodes.push({ type: 'link', href, children });
        else nodes.push(...children);
        index += link[0].length;
        continue;
      }
    }

    if (!inLink && char === '<') {
      const auto = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/i.exec(text.slice(index, index + 2100));
      if (auto) {
        const href = safeMarkdownHref(auto[1]);
        if (href) {
          flush();
          nodes.push({ type: 'link', href, children: [{ type: 'text', value: auto[1].replace(/^mailto:/i, '') }] });
          index += auto[0].length;
          continue;
        }
      }
    }

    if (!inLink && (char === 'h' || char === 'H') && !WORD.test(text[index - 1] || '')) {
      const bare = /^https?:\/\/[^\s<>"'`]+/i.exec(text.slice(index, index + 2048));
      if (bare) {
        let url = bare[0];
        while (/[.,:;!?)\]}'"*_~]$/.test(url)) {
          if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
          url = url.slice(0, -1);
        }
        const href = safeMarkdownHref(url);
        if (href && url.length > 8) {
          flush();
          nodes.push({ type: 'link', href, children: [{ type: 'text', value: url }] });
          index += url.length;
          continue;
        }
      }
    }

    if ((char === '*' || char === '_' || char === '~') && depth < MAX_DEPTH) {
      const double = (char + char) as Delimiter;
      if (next === char && (char !== '_' || !WORD.test(text[index - 1] || ''))) {
        const inner = text[index + 2] || '';
        if (inner.trim() && inner !== char) {
          const close = findCloser(double, index + 2);
          if (close !== -1) {
            flush();
            const children = parseInlineAt(text.slice(index + 2, close), depth + 1, inLink);
            nodes.push({ type: char === '~' ? 'del' : 'strong', children });
            index = close + 2;
            continue;
          }
        }
        buffer += double; index += 2; continue;
      }
      if (char !== '~' && next.trim() && (char !== '_' || !WORD.test(text[index - 1] || ''))) {
        const close = findCloser(char as Delimiter, index + 1);
        if (close !== -1) {
          flush();
          nodes.push({ type: 'em', children: parseInlineAt(text.slice(index + 1, close), depth + 1, inLink) });
          index = close + 1;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }
  flush();
  return nodes;
}

export function parseMarkdownInline(text: string): MdInline[] {
  return parseInlineAt(String(text ?? ''), 0, false);
}

function parseAlign(cell: string): MdAlign {
  const value = cell.trim();
  const left = value.startsWith(':');
  const right = value.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

const ENDS_SENTENCE = /[.!?…:][»"”')\]]*\s*$/;

function parseList(lines: string[], start: number, depth: number): { block: MdBlock; next: number } {
  const first = LIST_ITEM.exec(lines[start]) as RegExpExecArray;
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items: Array<{ lines: string[] }> = [];
  let current: { lines: string[]; contentIndent: number } | null = null;
  let index = start;
  let previousBlank = false;

  while (index < lines.length) {
    const line = lines[index];
    if (blank(line)) {
      previousBlank = true;
      current?.lines.push('');
      index += 1;
      continue;
    }
    const indent = indentOf(line);
    const marker = LIST_ITEM.exec(line);
    if (marker && indent < baseIndent + 2 && indent >= baseIndent - 1) {
      if (/\d/.test(marker[2]) !== ordered) break;
      current = { lines: [marker[3] || ''], contentIndent: indent + marker[2].length + 1 };
      items.push(current);
      previousBlank = false;
      index += 1;
      continue;
    }
    if (!current) break;
    if (indent >= baseIndent + 2) {
      current.lines.push(dedent(line, Math.min(indent, current.contentIndent)));
      previousBlank = false;
      index += 1;
      continue;
    }
    // Lazy continuation: wrapped text of the item paragraph. Chat answers put the
    // closing question right under the last item; once that item has ended its
    // sentence, the next line starts a paragraph instead of joining the item.
    if (!previousBlank && !startsBlock(lines, index) && !ENDS_SENTENCE.test(current.lines[current.lines.length - 1] || '')) {
      current.lines.push(line.trim());
      index += 1;
      continue;
    }
    break;
  }

  while (current && current.lines.length && !current.lines[current.lines.length - 1].trim()) current.lines.pop();
  const startNumber = ordered ? Math.min(Number.parseInt(first[2], 10) || 1, 1_000_000) : 1;
  return {
    block: {
      type: 'list', ordered, start: startNumber,
      items: items.map(item => {
        const [head = '', ...rest] = item.lines;
        const task = TASK.exec(head);
        const body = task ? head.slice(task[0].length) : head;
        return {
          checked: task ? task[1].toLowerCase() === 'x' : null,
          children: parseBlocks([body, ...rest], depth + 1),
        };
      }),
    },
    next: index,
  };
}

function parseBlocks(lines: string[], depth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (blank(line)) { index += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const indent = indentOf(line);
      const body: string[] = [];
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`).test(candidate)) { index += 1; break; }
        body.push(dedent(candidate, indent));
        index += 1;
      }
      blocks.push({ type: 'code', lang: fence[2].slice(0, 24).toLowerCase(), value: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, children: parseMarkdownInline(heading[2]) });
      index += 1;
      continue;
    }
    if (EMPTY_HEADING.test(line)) { index += 1; continue; }

    if (HR.test(line)) { blocks.push({ type: 'hr' }); index += 1; continue; }

    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const quoted: string[] = [];
      while (index < lines.length && !blank(lines[index])) {
        const match = QUOTE.exec(lines[index]);
        if (match) quoted.push(match[1]);
        else if (quoted.length && !startsBlock(lines, index)) quoted.push(lines[index].trim());
        else break;
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(quoted, depth + 1) });
      continue;
    }

    if (LIST_ITEM.test(line) && depth < MAX_DEPTH) {
      const { block, next } = parseList(lines, index, depth);
      blocks.push(block);
      index = Math.max(next, index + 1);
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitRow(line);
      const delimiters = splitRow(lines[index + 1]);
      const width = Math.max(header.length, 1);
      const align = Array.from({ length: width }, (_, column) => parseAlign(delimiters[column] || ''));
      const rows: MdInline[][][] = [];
      index += 2;
      while (index < lines.length && !blank(lines[index]) && lines[index].includes('|') && rows.length < 500) {
        const cells = splitRow(lines[index]);
        rows.push(Array.from({ length: width }, (_, column) => parseMarkdownInline(cells[column] || '')));
        index += 1;
      }
      blocks.push({
        type: 'table', align,
        header: Array.from({ length: width }, (_, column) => parseMarkdownInline(header[column] || '')),
        rows,
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !blank(lines[index]) && (paragraph.length === 0 || !startsBlock(lines, index))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: parseMarkdownInline(paragraph.join('\n')) });
  }
  return blocks;
}

export function parseMarkdown(markdown: string): MdBlock[] {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
  return parseBlocks(lines, 0);
}

/** Plain text of inline nodes, for titles, search and PDF export. */
export function markdownInlineText(nodes: MdInline[]): string {
  return nodes.map(node => {
    if (node.type === 'text' || node.type === 'code') return node.value;
    if (node.type === 'br') return '\n';
    return markdownInlineText(node.children);
  }).join('');
}

/** Short plain-text preview of a Markdown document (first meaningful text). */
export function markdownExcerpt(markdown: string, maxLength = 180): string {
  const collect = (blocks: MdBlock[]): string[] => blocks.flatMap(block => {
    if (block.type === 'paragraph' || block.type === 'heading') return [markdownInlineText(block.children)];
    if (block.type === 'list') return block.items.flatMap(item => collect(item.children));
    if (block.type === 'blockquote') return collect(block.children);
    return [];
  });
  const text = collect(parseMarkdown(markdown)).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, HeadingLevel, LevelFormat, Packer, PageNumber, Paragraph, ShadingType,
  Table, TableCell, TableRow, TabStopType, TextRun, UnderlineType, WidthType,
  type IParagraphOptions, type ParagraphChild,
} from 'docx';
import type { MdAlign, MdBlock, MdInline } from '@/lib/cowork/markdown';

/**
 * Word (.docx) from the same Markdown tree the workspace shows and the PDF draws (file-exports.ts):
 * headings, lists, quotes, code, tables, links and emphasis. Colors are the app's, so a PDF and a
 * Word of the same text look alike. Nothing here comes from a template or a file: the text is the
 * only input, and characters a .docx cannot hold (control characters, lone surrogates) are dropped
 * because one of them makes Word refuse the whole file.
 */

const INK = '1F1D1A';
const MUTED = '6A655C';
const ACCENT = 'A4501F';
const RULE = 'E0DBD0';
const QUOTE_RULE = 'D6D0C2';
const PANEL = 'F3F0E9';
const CODE_BACKGROUND = 'F5F3EE';
const MONO = 'Consolas';

// XML 1.0 cannot hold most control characters; a lone surrogate is not text either.
const NOT_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (text: string) => text.replace(NOT_TEXT, '');

type Format = { bold?: boolean; italics?: boolean; strike?: boolean; color?: string; link?: boolean };

function textRuns(value: string, format: Format): ParagraphChild[] {
  return clean(value).replace(/\r\n?/g, '\n').split('\n').flatMap((line, index) => [
    ...(index > 0 ? [new TextRun({ break: 1 })] : []),
    ...(line ? [new TextRun({ text: line, bold: format.bold, italics: format.italics, strike: format.strike, color: format.color, style: format.link ? 'Hyperlink' : undefined })] : []),
  ]);
}

function runs(nodes: MdInline[], format: Format = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === 'text') out.push(...textRuns(node.value, format));
    else if (node.type === 'br') out.push(new TextRun({ break: 1 }));
    else if (node.type === 'code') out.push(new TextRun({ text: clean(node.value), font: MONO, size: 20, bold: format.bold, italics: format.italics, color: format.color,
      shading: { type: ShadingType.CLEAR, fill: CODE_BACKGROUND, color: 'auto' } }));
    else if (node.type === 'strong') out.push(...runs(node.children, { ...format, bold: true }));
    else if (node.type === 'em') out.push(...runs(node.children, { ...format, italics: true }));
    else if (node.type === 'del') out.push(...runs(node.children, { ...format, strike: true }));
    // A link a Word can follow: a same-app path («/campaigns») means nothing outside the app, so it stays as text.
    else if (/^(https?:|mailto:)/i.test(node.href)) out.push(new ExternalHyperlink({ link: node.href, children: runs(node.children, { ...format, link: true }) as TextRun[] }));
    else out.push(...runs(node.children, format));
  }
  return out;
}

const alignment = (align: MdAlign) => align === 'right' ? AlignmentType.RIGHT : align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const;
const LIST_LEVELS = 4;
/** Twips (a twentieth of a point): the indent of each list level and of what hangs off a list item. */
const STEP = 500;

type Context = { indent: number; quote: boolean; color?: string; level: number };

/** Turns the tree into Word paragraphs and tables. Returns what the numbered lists need: `ordered` starts. */
function body(items: MdBlock[]) {
  const orderedStarts = new Set<number>();
  let lists = 0;

  const render = (blocks: MdBlock[], context: Context): Array<Paragraph | Table> => {
    const out: Array<Paragraph | Table> = [];
    const indent = context.indent ? { left: context.indent } : undefined;
    const quoted: Partial<IParagraphOptions> = context.quote
      ? { border: { left: { style: BorderStyle.SINGLE, size: 18, color: QUOTE_RULE, space: 8 } } } : {};
    for (const block of blocks) {
      if (block.type === 'heading') {
        out.push(new Paragraph({ heading: HEADINGS[block.level - 1], indent, children: runs(block.children), ...quoted }));
      } else if (block.type === 'paragraph') {
        out.push(new Paragraph({ indent, children: runs(block.children, { color: context.color }), ...quoted }));
      } else if (block.type === 'list') {
        const instance = ++lists;
        if (block.ordered) orderedStarts.add(block.start);
        const reference = block.ordered ? `ordered-${block.start}` : 'bullets';
        for (const item of block.items) {
          const [first, ...rest] = item.children;
          const firstRuns = first && (first.type === 'paragraph' || first.type === 'heading') ? runs(first.children, { color: context.color }) : [];
          // A task shows its box in place of a bullet; the text hangs at the same indent as any other item.
          out.push(item.checked === null
            ? new Paragraph({ numbering: { reference, level: Math.min(context.level, LIST_LEVELS - 1), instance }, spacing: { after: 60 }, children: firstRuns })
            : new Paragraph({ indent: { left: STEP * (context.level + 1), hanging: 300 }, spacing: { after: 60 },
              children: [new TextRun({ text: item.checked ? '☑\t' : '☐\t' }), ...firstRuns], tabStops: [{ type: TabStopType.LEFT, position: STEP * (context.level + 1) }] }));
          const inside = { ...context, indent: context.indent + STEP * (context.level + 1), level: context.level + 1 };
          if (first && !firstRuns.length) out.push(...render([first], inside));
          for (const other of rest) out.push(...render([other], other.type === 'list' ? { ...context, level: context.level + 1 } : inside));
        }
      } else if (block.type === 'blockquote') {
        out.push(...render(block.children, { ...context, indent: context.indent + 360, quote: true, color: MUTED }));
      } else if (block.type === 'code') {
        const lines = clean(block.value).replace(/\r\n?/g, '\n').split('\n');
        for (const line of lines) {
          out.push(new Paragraph({ indent, spacing: { after: 0, line: 260 }, shading: { type: ShadingType.CLEAR, fill: CODE_BACKGROUND, color: 'auto' },
            children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })] }));
        }
        out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      } else if (block.type === 'table') {
        const columns = block.header.length;
        const cell = (nodes: MdInline[], index: number, header: boolean) => new TableCell({
          children: [new Paragraph({ alignment: alignment(block.align[index] ?? null), spacing: { after: 0, line: 260 }, children: runs(nodes, header ? { bold: true } : {}) })],
          shading: header ? { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, bottom: { style: BorderStyle.SINGLE, size: header ? 6 : 2, color: RULE } },
        });
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          indent: context.indent ? { size: context.indent, type: WidthType.DXA } : undefined,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: block.header.map((nodes, index) => cell(nodes, index, true)) }),
            ...block.rows.map(row => new TableRow({ cantSplit: true, children: Array.from({ length: columns }, (_, index) => cell(row[index] || [], index, false)) })),
          ],
        }), new Paragraph({ spacing: { after: 80 }, children: [] }));
      } else if (block.type === 'hr') {
        out.push(new Paragraph({ indent, spacing: { before: 120, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } }, children: [] }));
      }
    }
    return out;
  };

  return { children: render(items, { indent: 0, quote: false, level: 0 }), orderedStarts };
}

const heading = (size: number, before: number, after: number) => ({
  run: { size, bold: true, color: INK },
  paragraph: { spacing: { before, after }, keepNext: true },
});

function numbering(orderedStarts: Set<number>) {
  const level = (index: number, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string, start = 1) => ({
    level: index, format, text, start, alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: STEP * (index + 1), hanging: 300 } } },
  });
  const marks = ['•', '◦', '▪', '•'];
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL];
  return { config: [
    { reference: 'bullets', levels: marks.map((mark, index) => level(index, LevelFormat.BULLET, mark)) },
    ...[...orderedStarts].map(start => ({ reference: `ordered-${start}`,
      levels: formats.map((format, index) => level(index, format, `%${index + 1}.`, index === 0 ? start : 1)) })),
  ] };
}

/** A Word document with `title` on top and the Markdown blocks under it, as bytes. */
export async function renderCoworkDocx(title: string, blocks: MdBlock[]): Promise<Uint8Array> {
  const { children, orderedStarts } = body(blocks);
  const document = new Document({
    creator: 'ANTON.IA Cowork',
    lastModifiedBy: 'ANTON.IA Cowork',
    title: clean(title),
    description: 'Creado con ANTON.IA Cowork',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22, color: INK, language: { value: 'es-CL' } }, paragraph: { spacing: { after: 120, line: 300 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 38, bold: true, color: INK },
          paragraph: { spacing: { after: 240 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...heading(32, 320, 120) },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...heading(27, 280, 100) },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...heading(24, 240, 80) },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, ...heading(22, 200, 60) },
        // The footer's look lives in its style, so the page numbers (fields) look like the text around them in every reader.
        { id: 'Footer', name: 'footer', basedOn: 'Normal', run: { size: 17, color: MUTED }, paragraph: { spacing: { after: 0 } } },
      ],
      characterStyles: [
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: ACCENT, underline: { type: UnderlineType.SINGLE } } },
      ],
    },
    numbering: numbering(orderedStarts),
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, right: 1418, bottom: 1418, left: 1418 } } },
      footers: { default: new Footer({ children: [new Paragraph({ style: 'Footer', alignment: AlignmentType.RIGHT,
        children: [new TextRun('ANTON.IA Cowork · página '), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(' de '), new TextRun({ children: [PageNumber.TOTAL_PAGES] })] })] }) },
      children: [new Paragraph({ style: 'Title', border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } },
        children: [new TextRun({ text: clean(title) })] }), ...children],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

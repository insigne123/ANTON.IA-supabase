// The Word backend: the same spec as the PDF, as a document a person can edit. The styles carry the design (a type scale, spacing, colors from
// the theme), so the headings are real headings (the navigation pane and the table of contents work), lists are real lists, tables repeat their
// header across pages and do not split a row, and the footer numbers its pages. No character is lost: Word has the whole alphabet.
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
  type IParagraphOptions, type ParagraphChild,
} from 'docx';
import { plainOf, type DocBlock, type DocumentSpec, type ListItem, type Run } from './spec';
import { themeOf, type RGB, type Theme } from './theme';

const FONT = 'Calibri';
const MONO = 'Courier New';
const hex6 = (color: RGB) => color.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
const twip = (mm: number) => Math.round((mm / 25.4) * 1440);
const half = (points: number) => Math.round(points * 2);
const plainWords = (text: string) => text.split(/\s+/).map(word => word.length);
const NUMERIC = /^[\s$€£+\-−–.,0-9%]+(?:\s?(?:CLP|USD|UF|UTM|MM|M|K|x|veces|días|dias|pp))?$/i;

function runs(items: Run[], theme: Theme, size: number, base: { bold?: boolean; italic?: boolean; color?: RGB } = {}): ParagraphChild[] {
  return items.flatMap((item): ParagraphChild[] => {
    const parts = item.text.split('\n');
    return parts.flatMap((part, index): ParagraphChild[] => {
      const run = new TextRun({
        text: part, font: item.code ? MONO : FONT, size: half(item.code ? size - 1 : size), bold: Boolean(item.bold || base.bold), italics: Boolean(item.italic || base.italic),
        color: hex6(item.href ? theme.link : base.color ?? theme.ink), break: index > 0 ? 1 : undefined, underline: item.href ? {} : undefined,
      });
      return [item.href && part ? new ExternalHyperlink({ link: item.href, children: [run] }) : run];
    });
  });
}

const noBorders = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };

export async function renderDocx(spec: DocumentSpec, options: { date?: string } = {}): Promise<Uint8Array> {
  const theme = themeOf(spec.theme);
  const { type: scale } = theme;
  const contentWidth = twip(theme.page.width - theme.page.left - theme.page.right);
  const body = scale.body;
  const para = (children: ParagraphChild[], extra: Partial<IParagraphOptions> = {}) => new Paragraph({ children, spacing: { after: 120, line: 330 }, ...extra });
  const listRefs: string[] = [];
  let listCount = 0;

  const listParagraphs = (items: ListItem[], ordered: boolean, level: number, instance: number): Paragraph[] => items.flatMap(item => [
    new Paragraph({ children: runs(item.runs, theme, body), numbering: { reference: ordered ? 'numbers' : 'bullets', level, instance }, spacing: { after: 60, line: 330 } }),
    ...(item.sub?.length ? listParagraphs(item.sub, ordered, Math.min(level + 1, 2), instance) : []),
  ]);

  const cell = (children: Paragraph[], width: number, fill?: RGB, extra: Partial<ConstructorParameters<typeof TableCell>[0]> = {}) => new TableCell({
    children, width: { size: width, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    margins: { top: 70, bottom: 70, left: 110, right: 110 }, shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill: hex6(fill) } : undefined, ...extra,
  });

  const block = (item: DocBlock): Array<Paragraph | Table> => {
    switch (item.type) {
      case 'heading': {
        const size = item.level === 1 ? scale.h1 : item.level === 2 ? scale.h2 : scale.h3;
        const color = item.level === 2 ? theme.accentDark : theme.ink;
        return [new Paragraph({
          heading: item.level === 1 ? HeadingLevel.HEADING_1 : item.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, keepNext: true, keepLines: true,
          children: runs(item.runs, theme, size, { bold: true, color }), spacing: { before: item.level === 1 ? 360 : 240, after: item.level === 1 ? 160 : 100 },
          border: item.level === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex6(theme.accent), space: 4 } } : undefined,
        })];
      }
      case 'paragraph': return [para(runs(item.runs, theme, body))];
      case 'list': { listCount += 1; listRefs.push(String(listCount)); return listParagraphs(item.items, item.ordered, 0, listCount); }
      case 'table': {
        const columns = item.columns.length;
        // Each column wants its text, but never less than its longest word: weights by text length, floors by word length (about 100 twips a character).
        const texts = item.columns.map((column, c) => [plainOf(column.header), ...item.rows.map(row => plainOf(row[c] ?? []))]);
        const weights = texts.map(list => Math.min(40, Math.max(6, ...list.map(text => text.length))));
        const floors = texts.map(list => Math.min(contentWidth / 3, Math.max(Math.max(...plainWords(list[0])) * 125, Math.max(...list.slice(1).flatMap(plainWords), 0) * 105) + 300));
        const total = weights.reduce((sum, value) => sum + value, 0);
        let widths = weights.map((value, c) => Math.max(floors[c], Math.round((contentWidth * value) / total)));
        const scaled = widths.reduce((sum, value) => sum + value, 0);
        // Over the page: the columns above their floor give back what is over, in proportion.
        if (scaled > contentWidth) {
          const slack = widths.map((value, c) => value - floors[c]);
          const spare = slack.reduce((sum, value) => sum + value, 0) || 1;
          const over = scaled - contentWidth;
          widths = widths.map((value, c) => value - (over * slack[c]) / spare);
        }
        const fit = widths.map(value => Math.floor(value * Math.min(1, contentWidth / widths.reduce((sum, w) => sum + w, 0))));
        const aligns = item.columns.map((column, c) => column.align ?? (item.rows.some(row => plainOf(row[c] ?? []).trim()) && item.rows.every(row => { const text = plainOf(row[c] ?? []).trim(); return !text || NUMERIC.test(text); }) ? 'right' : 'left'));
        const alignment = (value: string) => (value === 'right' ? AlignmentType.RIGHT : value === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT);
        const hairline = { style: BorderStyle.SINGLE, size: 4, color: hex6(theme.rule) };
        const out: Array<Paragraph | Table> = [];
        if (item.caption) out.push(new Paragraph({ children: [new TextRun({ text: item.caption, italics: true, size: half(scale.caption + 0.5), color: hex6(theme.muted), font: FONT })], spacing: { after: 60 }, keepNext: true }));
        out.push(new Table({
          width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: fit,
          rows: [
            new TableRow({ tableHeader: true, cantSplit: true, children: item.columns.map((column, c) => cell([new Paragraph({ alignment: alignment(aligns[c]), children: runs(column.header, theme, scale.table, { bold: true, color: theme.white }) })], fit[c], theme.accentDark)) }),
            ...item.rows.map((row, r) => new TableRow({ cantSplit: true, children: item.columns.map((_, c) => cell([new Paragraph({ alignment: alignment(aligns[c]), children: runs(row[c] ?? [], theme, scale.table) })], fit[c], r % 2 === 1 ? theme.zebra : undefined,
              { borders: { top: hairline, bottom: hairline, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } } })) })),
          ],
        }));
        out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        return columns ? out : [];
      }
      case 'callout': {
        const tone = theme.tones[item.tone];
        const children = [
          ...(item.title ? [new Paragraph({ children: [new TextRun({ text: item.title.toUpperCase(), bold: true, size: half(scale.small - 0.5), color: hex6(tone.title), font: FONT })], spacing: { after: 40 } })] : []),
          new Paragraph({ children: runs(item.runs, theme, body - 0.5), spacing: { line: 330 } }),
        ];
        return [new Table({
          width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: [contentWidth],
          rows: [new TableRow({ cantSplit: true, children: [cell(children, contentWidth, tone.fill, { margins: { top: 120, bottom: 120, left: 200, right: 160 },
            borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 24, color: hex6(tone.bar) } } })] })],
        }), new Paragraph({ children: [], spacing: { after: 120 } })];
      }
      case 'figures': {
        const widths = item.items.map(() => Math.floor(contentWidth / item.items.length));
        return [new Table({
          width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: widths,
          rows: [new TableRow({ cantSplit: true, children: item.items.map((figure, index) => cell([
            new Paragraph({ children: [new TextRun({ text: figure.value, bold: true, size: half(scale.figure), color: hex6(theme.accentDark), font: FONT })], spacing: { after: 20 } }),
            new Paragraph({ children: [new TextRun({ text: figure.label, size: half(scale.small - 0.5), color: hex6(theme.muted), font: FONT })], spacing: { after: 10 } }),
            ...(figure.detail ? [new Paragraph({ children: [new TextRun({ text: figure.detail, size: half(scale.caption), color: hex6(theme.muted), font: FONT })] })] : []),
          ], widths[index], theme.accentTint, { margins: { top: 140, bottom: 120, left: 160, right: 120 },
          borders: { ...noBorders, top: { style: BorderStyle.SINGLE, size: 18, color: hex6(theme.accent) }, right: { style: BorderStyle.SINGLE, size: 24, color: 'FFFFFF' } } })) })],
        }), new Paragraph({ children: [], spacing: { after: 120 } })];
      }
      case 'quote': return [new Paragraph({
        children: [...runs(item.runs, theme, body + 0.5, { italic: true }), ...(item.cite ? [new TextRun({ text: `  — ${item.cite}`, size: half(scale.small), color: hex6(theme.muted), font: FONT })] : [])],
        indent: { left: 240 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: hex6(theme.accent), space: 10 } }, spacing: { before: 120, after: 160, line: 330 },
      })];
      case 'code': return item.text.split('\n').map((line, index, all) => new Paragraph({
        children: [new TextRun({ text: line || ' ', font: MONO, size: half(scale.code), color: hex6(theme.ink) })],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex6(theme.codeFill) }, spacing: { after: index === all.length - 1 ? 160 : 0 }, keepLines: true,
      }));
      case 'bars': {
        const maximum = Math.max(...item.items.map(entry => entry.value), 1);
        const widths = [twip(48), contentWidth - twip(48) - twip(26), twip(26)];
        const hairline = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
        return [
          ...(item.title ? [new Paragraph({ children: [new TextRun({ text: item.title, bold: true, size: half(scale.small + 1), color: hex6(theme.ink), font: FONT })], spacing: { before: 120, after: 80 }, keepNext: true })] : []),
          new Table({
            width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: widths,
            rows: item.items.map(entry => new TableRow({ cantSplit: true, children: [
              cell([new Paragraph({ children: [new TextRun({ text: entry.label, size: half(scale.small), color: hex6(theme.ink), font: FONT })] })], widths[0], undefined, { borders: { top: hairline, bottom: hairline, left: hairline, right: hairline } }),
              cell([new Paragraph({ children: [new TextRun({ text: '█'.repeat(Math.max(1, Math.round((entry.value / maximum) * 34))), size: half(scale.small), color: hex6(theme.accent), font: FONT })] })], widths[1], undefined, { borders: { top: hairline, bottom: hairline, left: hairline, right: hairline } }),
              cell([new Paragraph({ children: [new TextRun({ text: `${entry.value.toLocaleString('es-CL')}${item.unit ? ` ${item.unit}` : ''}`, bold: true, size: half(scale.small), color: hex6(theme.ink), font: FONT })] })], widths[2], undefined, { borders: { top: hairline, bottom: hairline, left: hairline, right: hairline } }),
            ] })),
          }),
          new Paragraph({ children: [], spacing: { after: 120 } }),
        ];
      }
      case 'divider': return [new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex6(theme.rule), space: 1 } }, spacing: { before: 120, after: 160 } })];
      case 'pageBreak': return [new Paragraph({ children: [new PageBreak()] })];
    }
  };

  // The cover, when there is one, or the title over the first page.
  const front: Array<Paragraph | Table> = [];
  const metaRows = [...(spec.meta ?? []), ...(options.date ? [{ label: 'Fecha', value: options.date }] : [])];
  if (spec.cover) {
    front.push(new Paragraph({ children: [], spacing: { before: 2600 } }));
    if (spec.kicker) front.push(new Paragraph({ children: [new TextRun({ text: spec.kicker.toUpperCase(), bold: true, size: half(scale.small + 0.5), color: hex6(theme.accent), font: FONT })], spacing: { after: 160 } }));
    front.push(new Paragraph({ children: [new TextRun({ text: spec.title, bold: true, size: half(scale.title), color: hex6(theme.ink), font: FONT })], spacing: { after: 200, line: 300 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: hex6(theme.accent), space: 10 } } }));
    if (spec.subtitle) front.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, size: half(scale.subtitle), color: hex6(theme.muted), font: FONT })], spacing: { before: 200, after: 1800 } }));
    if (metaRows.length) {
      front.push(new Table({
        width: { size: contentWidth, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: [twip(40), contentWidth - twip(40)],
        rows: metaRows.map(row => new TableRow({ children: [
          cell([new Paragraph({ children: [new TextRun({ text: row.label.toUpperCase(), bold: true, size: half(scale.caption), color: hex6(theme.muted), font: FONT })] })], twip(40), undefined, { borders: noBorders }),
          cell([new Paragraph({ children: [new TextRun({ text: row.value, size: half(body), color: hex6(theme.ink), font: FONT })] })], contentWidth - twip(40), undefined, { borders: noBorders }),
        ] })),
      }));
    }
    front.push(new Paragraph({ children: [new PageBreak()] }));
  } else {
    front.push(new Paragraph({ children: [new TextRun({ text: spec.title, bold: true, size: half(scale.title - 6), color: hex6(theme.ink), font: FONT })], spacing: { after: 60 } }));
    if (spec.subtitle) front.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, size: half(scale.subtitle - 1), color: hex6(theme.muted), font: FONT })], spacing: { after: 60 } }));
    const byline = [...(spec.meta ?? []).map(row => `${row.label}: ${row.value}`), ...(options.date ? [options.date] : [])].join('   ·   ');
    if (byline) front.push(new Paragraph({ children: [new TextRun({ text: byline, size: half(scale.small), color: hex6(theme.muted), font: FONT })], spacing: { after: 160 } }));
    front.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex6(theme.rule), space: 1 } }, spacing: { after: 200 } }));
  }

  const content = spec.blocks.flatMap(block);
  const running = spec.runningTitle || spec.title;
  const numbering = {
    config: [
      { reference: 'bullets', levels: [0, 1, 2].map(level => ({ level, format: LevelFormat.BULLET, text: level === 0 ? '•' : '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 + level * 360, hanging: 260 } }, run: { color: hex6(theme.accent) } } })) },
      { reference: 'numbers', levels: [0, 1, 2].map(level => ({ level, format: level === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400 + level * 360, hanging: 320 } }, run: { bold: true, color: hex6(theme.accent) } } })) },
    ],
  };

  const footer = () => new Footer({ children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: hex6(theme.rule), space: 6 } },
    children: [
      new TextRun({ text: spec.brand || 'ANTON.IA', bold: true, size: half(scale.caption), color: hex6(theme.accentDark), font: FONT }),
      new TextRun({ children: ['\tPágina ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: half(scale.caption), color: hex6(theme.muted), font: FONT }),
    ],
  })] });

  const doc = new Document({
    creator: spec.brand || 'ANTON.IA', title: spec.title, description: spec.subtitle,
    numbering,
    styles: { default: { document: { run: { font: FONT, size: half(body), color: hex6(theme.ink) } } } },
    sections: [{
      properties: { titlePage: true, page: { size: { width: twip(theme.page.width), height: twip(theme.page.height) }, margin: { top: twip(theme.page.top - 4), bottom: twip(theme.page.bottom), left: twip(theme.page.left), right: twip(theme.page.right), header: twip(10), footer: twip(9) } } },
      headers: {
        default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: running, size: half(scale.caption), color: hex6(theme.muted), font: FONT })], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex6(theme.rule), space: 4 } } })] }),
        first: new Header({ children: [new Paragraph({ children: [] })] }),
      },
      footers: {
        default: footer(),
        // The cover carries no footer; a first page that is the document's own page does.
        first: spec.cover ? new Footer({ children: [new Paragraph({ children: [] })] }) : footer(),
      },
      children: [...front, ...content],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

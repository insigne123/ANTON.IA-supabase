import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeightRule, ImportedXmlComponent, LevelFormat, LineRuleType, Packer, PageNumber, Paragraph, ShadingType,
  Tab, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
  type IParagraphOptions, type ParagraphChild,
} from 'docx';
import { offerSheet, type SavedOfferDraft } from '@/lib/commercial-opportunities/offer-draft';
import type { OfferAnnex, OfferAnnexBlock } from '@/lib/commercial-opportunities/offer-annexes';
import { complianceAnswer, letterBody, offerParagraphs, prefillField, splitPlaceholders, type OfferCompany } from '@/lib/commercial-opportunities/offer-document';

/**
 * The offer as a Word the team fills in and sends: a working sheet that does not go out (what is missing, which documents to
 * hand in), then the offer itself in its formal order: cover letter, identification of the bidder, technical offer, compliance
 * with the technical requirements, economic offer and the forms of the bases (annexes). What the company has not given is a
 * yellow content control: click it and write, or pick from a list, or tick the box; the date is a date picker. Nothing here
 * invents data: an unknown stays a control to fill.
 */

const INK = '1F2937', MUTED = '5B6573', NAVY = '1F3A5F', RULE = 'C9D1DB', PANEL = 'F3F6FA', FILL = 'FFF2CC', FILL_TEXT = '6B4E00', WARN = 'B45309', WHITE = 'FFFFFF';
const FONT = 'Calibri';
/** A4 with 2.2 cm margins: the text is 9412 twips wide. */
const WIDTH = 9412;
const NOT_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const clean = (text: string) => text.replace(NOT_TEXT, '');
const attr = (value: string) => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => `$${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)}`;
const long = (iso: string | null | undefined) => {
  const at = iso ? new Date(iso) : null;
  return at && Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(at) : '';
};

export type OfferDocumentInput = {
  saved: Pick<SavedOfferDraft, 'draft' | 'prices' | 'created_at'>;
  opportunity: { title: string; buyer?: string | null; code?: string | null; deadline?: string | null; amount?: number | null; budgetIncludesTax?: boolean | null };
  company: OfferCompany;
  /** The documents of «Cómo postular», to list what must be handed in. */
  documents?: Array<{ folder: string; title: string; signed: boolean; excludesIfMissing: boolean }>;
  /** Only this form of the bases, on its own, without the working sheet or the rest of the offer. */
  onlyAnnex?: number;
};

type Para = Paragraph | Table;

function toolkit() {
  let next = 7000;
  const control = (props: string, content: string) => {
    const root = ImportedXmlComponent.fromXmlString(`<w:sdt><w:sdtPr>${props}<w:id w:val="${next++}"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`) as unknown as { root: unknown[] };
    return root.root[0] as ParagraphChild;
  };
  const hold = (text: string, size = 22) => `<w:r><w:rPr><w:rStyle w:val="Marcador"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${attr(text)}</w:t></w:r>`;
  const label = (text: string) => { const name = clean(text).replace(/[\[\]]/g, '').trim().slice(0, 60); return `<w:alias w:val="${attr(name)}"/><w:tag w:val="${attr(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40))}"/>`; };
  /** A yellow box to write in: it holds its text until someone clicks and types. */
  const field = (text: string, options: { multiLine?: boolean; size?: number } = {}): ParagraphChild => control(`${label(text)}<w:showingPlcHdr/><w:text${options.multiLine ? ' w:multiLine="1"' : ''}/>`, hold(text, options.size));
  /** A list to pick from; `chosen` is the item already picked. */
  const choice = (items: string[], chosen: string | null, title: string, size = 22): ParagraphChild => control(`${label(title)}${chosen ? '' : '<w:showingPlcHdr/>'}<w:dropDownList>${items.map(item => `<w:listItem w:displayText="${attr(item)}" w:value="${attr(item)}"/>`).join('')}</w:dropDownList>`,
    chosen ? `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${attr(chosen)}</w:t></w:r>` : hold('Elegir', size));
  const date = (title: string, size = 22): ParagraphChild => control(`${label(title)}<w:showingPlcHdr/><w:date><w:dateFormat w:val="d &apos;de&apos; MMMM &apos;de&apos; yyyy"/><w:lid w:val="es-CL"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`, hold('Elegir fecha', size));
  const box = (ticked = false): ParagraphChild => control(`<w14:checkbox><w14:checked w14:val="${ticked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
    `<w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic" w:hint="eastAsia"/></w:rPr><w:t>${ticked ? '☒' : '☐'}</w:t></w:r>`);
  return { field, choice, date, box };
}

export async function offerDocx(input: OfferDocumentInput): Promise<Uint8Array> {
  const { saved, opportunity, company } = input;
  const draft = saved.draft;
  const annexes = draft.annexes || [];
  const kit = toolkit();
  const sheet = offerSheet(draft, saved.prices, { amount: opportunity.amount ?? null, includesTax: opportunity.budgetIncludesTax ?? null });
  const oferente = company.legalName || null;
  const reference = opportunity.code ? `Licitación Pública ID ${opportunity.code}` : 'Licitación';

  // ─── The pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const run = (text: string, format: { bold?: boolean; italics?: boolean; color?: string; size?: number; caps?: boolean } = {}) => new TextRun({ text: clean(text), bold: format.bold, italics: format.italics, color: format.color, size: format.size, allCaps: format.caps });
  /** Text with its «[placeholders]» turned into boxes to fill. */
  const runs = (text: string, format: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}): ParagraphChild[] => splitPlaceholders(clean(text))
    .map(part => part.placeholder ? kit.field(part.text, { size: format.size }) : run(part.text, format));
  const paragraph = (children: ParagraphChild[], options: Partial<IParagraphOptions> = {}) => new Paragraph({ children, spacing: { after: 120, line: 276, lineRule: LineRuleType.AUTO }, ...options });
  const text = (value: string, options: Partial<IParagraphOptions> = {}, format: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {}) => paragraph(runs(value, format), options);
  const bullet = (value: string) => new Paragraph({ children: runs(value), numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60, line: 276, lineRule: LineRuleType.AUTO } });
  const body = (value: string): Paragraph[] => offerParagraphs(value).map(item => item.kind === 'li' ? bullet(item.text) : text(item.text, { alignment: AlignmentType.JUSTIFIED }));
  const h1 = (value: string, pageBreak = true) => new Paragraph({ children: [run(value, { bold: true, color: NAVY, size: 32 })], pageBreakBefore: pageBreak, keepNext: true,
    spacing: { before: 0, after: 200 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 6 } } });
  const h2 = (value: string) => new Paragraph({ children: [run(value, { bold: true, color: NAVY, size: 26 })], keepNext: true, spacing: { before: 280, after: 100 } });
  const h3 = (value: string) => new Paragraph({ children: [run(value, { bold: true, color: INK, size: 23 })], keepNext: true, spacing: { before: 200, after: 60 } });
  const kicker = (value: string, color = MUTED) => new Paragraph({ children: [new TextRun({ text: clean(value), bold: true, color, size: 18, allCaps: true, characterSpacing: 24 })], spacing: { after: 60 } });
  const spacer = (after = 120) => new Paragraph({ children: [], spacing: { after } });

  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE } as const;
  const none = { style: BorderStyle.NONE, size: 0, color: WHITE } as const;
  const cell = (children: Paragraph[], width: number, options: { fill?: string; span?: number; middle?: boolean; borders?: boolean } = {}) => new TableCell({
    children: children.length ? children : [new Paragraph({ children: [] })], width: { size: width, type: WidthType.DXA }, columnSpan: options.span,
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 110, right: 110 }, verticalAlign: options.middle ? VerticalAlign.CENTER : VerticalAlign.TOP,
    borders: options.borders === false ? { top: none, bottom: none, left: none, right: none } : { top: border, bottom: border, left: border, right: border },
  });
  const cellText = (value: string, options: { bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number } = {}) =>
    paragraph(runs(value, { bold: options.bold, color: options.color, size: options.size ?? 20 }), { alignment: options.align, spacing: { after: 0, line: 252, lineRule: LineRuleType.AUTO } });
  const grid = (widths: number[], rows: TableRow[]) => new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows });
  const head = (labels: string[], widths: number[]) => new TableRow({ tableHeader: true, cantSplit: true, children: labels.map((label, i) => cell([cellText(label, { bold: true, color: WHITE, size: 19 })], widths[i], { fill: NAVY, middle: true })) });
  const callout = (title: string, lines: string[], fill = PANEL, bullets = true) => grid([WIDTH], [new TableRow({ cantSplit: true, children: [cell([
    paragraph([run(title, { bold: true, color: NAVY, size: 21 })], { spacing: { after: 80 } }),
    ...lines.map(line => new Paragraph({ children: runs(line, { size: 20 }), ...(bullets ? { numbering: { reference: 'bullets', level: 0 } } : {}), spacing: { after: 40, line: 264, lineRule: LineRuleType.AUTO } }))], WIDTH, { fill })] })]);

  /** «Label | value» rows: the value is what the company gave, or a box to fill. */
  const fieldTable = (rows: Array<{ label: string; value: string }>, boxes = true) => grid([3300, WIDTH - 3300], rows.map(row => new TableRow({ cantSplit: true, children: [
    cell([cellText(row.label, { bold: true, color: INK })], 3300, { fill: PANEL, middle: true }),
    cell([paragraph(row.value ? runs(row.value, { size: 20 }) : boxes ? [kit.field('Escriba aquí', { size: 20 })] : [], { spacing: { after: 0, line: 252, lineRule: LineRuleType.AUTO } })], WIDTH - 3300, { middle: true }),
  ] })));

  const line = () => new Paragraph({ children: [run('_____________________________________________', { color: MUTED })], alignment: AlignmentType.CENTER, spacing: { before: 480, after: 40 } });
  /** The closing of a form: city and date, then the line to sign above the name of who signs. */
  const signature = (who = 'Representante legal o persona natural') => [
    new Paragraph({ children: [kit.field('Ciudad'), run(', '), kit.date('Fecha')], alignment: AlignmentType.LEFT, spacing: { before: 360, after: 0 } }),
    line(),
    new Paragraph({ children: [run('Nombre, RUT y firma', { bold: true, size: 20 })], alignment: AlignmentType.CENTER, spacing: { after: 20 } }),
    new Paragraph({ children: [run(who, { color: MUTED, size: 19 })], alignment: AlignmentType.CENTER, spacing: { after: 120 } }),
  ];

  // ─── The working sheet: what does not go out ──────────────────────────────────────────────────────────────────────────────
  const workSheet = (): Para[] => {
    const facts: Array<{ label: string; value: string }> = [
      ...(opportunity.buyer ? [{ label: 'Organismo comprador', value: opportunity.buyer }] : []),
      ...(opportunity.code ? [{ label: 'ID de la licitación', value: opportunity.code }] : []),
      ...(opportunity.deadline ? [{ label: 'Cierre de la recepción de ofertas', value: long(opportunity.deadline) }] : []),
      ...(opportunity.amount ? [{ label: 'Presupuesto', value: `${money(opportunity.amount)}${opportunity.budgetIncludesTax === true ? ' IVA incluido' : opportunity.budgetIncludesTax === false ? ' más IVA' : ''}` }] : []),
      { label: 'Oferente', value: oferente || '' }, { label: 'RUT', value: company.rut || '' },
    ];
    const missing = draft.missing;
    const documents = input.documents || [];
    const out: Para[] = [
      kicker('Hoja de trabajo · no se envía', WARN),
      new Paragraph({ children: [run(opportunity.title, { bold: true, color: NAVY, size: 40 })], spacing: { after: 80, line: 252, lineRule: LineRuleType.AUTO } }),
      paragraph([run(`Borrador de oferta preparado con ANTON.IA el ${long(saved.created_at).replace(/,.*$/, '')}`, { color: MUTED, size: 21 })], { spacing: { after: 240 } }),
      fieldTable(facts),
      spacer(200),
      callout('Cómo completar este documento', [
        'Los campos amarillos son para completar: haga clic y escriba. Las listas se abren con un clic y las casillas ☐ se marcan con otro.',
        'Los precios se escriben en ANTON.IA («Tu oferta», Oferta económica): los totales se calculan solos al volver a descargar. También puede escribirlos aquí.',
        'Esta primera hoja no se envía. No envíe nada sin confirmar cada dato con las bases y sus aclaraciones.',
      ]),
      h2(`Datos por completar${missing.length ? ` (${missing.length})` : ''}`),
    ];
    out.push(missing.length ? grid([520, WIDTH - 520], missing.map(item => new TableRow({ cantSplit: true, children: [
      cell([paragraph([kit.box()], { spacing: { after: 0 }, alignment: AlignmentType.CENTER })], 520, { middle: true }), cell([cellText(item)], WIDTH - 520, { middle: true })] })))
      : text('No quedan datos marcados: revise igualmente cada campo amarillo.', {}, { color: MUTED }));
    if (documents.length) {
      out.push(h2(`Documentos que debe entregar (${documents.length})`));
      const widths = [520, 4300, 2400, WIDTH - 7220];
      out.push(grid(widths, [head(['', 'Documento', 'Carpeta', 'Observación'], widths), ...documents.map(doc => new TableRow({ cantSplit: true, children: [
        cell([paragraph([kit.box()], { spacing: { after: 0 }, alignment: AlignmentType.CENTER })], widths[0], { middle: true }),
        cell([cellText(doc.title, { bold: true })], widths[1], { middle: true }), cell([cellText(doc.folder || '—', { color: MUTED })], widths[2], { middle: true }),
        cell([cellText([doc.signed ? 'Con firma' : '', doc.excludesIfMissing ? 'Si falta, queda fuera' : ''].filter(Boolean).join(' · ') || '—', { color: doc.excludesIfMissing ? WARN : MUTED, bold: doc.excludesIfMissing })], widths[3], { middle: true }),
      ] }))]));
    }
    return out;
  };

  // ─── The offer ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const letter = (): Para[] => {
    const paragraphs = letterBody(draft.letter);
    return [
      new Paragraph({ children: [kit.field('Ciudad'), run(', '), kit.date('Fecha')], alignment: AlignmentType.RIGHT, spacing: { after: 360 } }),
      paragraph([run('Señores', { bold: true })], { spacing: { after: 0 } }),
      paragraph([run(opportunity.buyer || 'Organismo comprador', { bold: true })], { spacing: { after: 0 } }),
      paragraph([run('Presente')], { spacing: { after: 240 } }),
      paragraph([run('Ref.: ', { bold: true }), run(`${reference}${opportunity.title ? `, «${opportunity.title}»` : ''}.`)], { spacing: { after: 240 } }),
      paragraph([run('De nuestra consideración:')], { spacing: { after: 160 } }),
      ...(paragraphs.length ? paragraphs.map(item => text(item, { alignment: AlignmentType.JUSTIFIED })) : [text('[Escriba aquí el texto de la carta]', { alignment: AlignmentType.JUSTIFIED })]),
      paragraph([run('Atentamente,')], { spacing: { before: 240, after: 0 } }),
      line(),
      paragraph([kit.field('Nombre del representante legal')], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
      paragraph([run('RUT ', { color: MUTED }), kit.field('RUT del representante legal')], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
      paragraph(oferente ? [run(oferente, { bold: true })] : [kit.field('Razón social')], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
      paragraph([run('RUT ', { color: MUTED }), ...(company.rut ? [run(company.rut)] : [kit.field('RUT de la empresa')])], { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
    ];
  };

  const identification = (): Para[] => [
    h1('Identificación del oferente'),
    text('Datos de la persona natural o jurídica que presenta la oferta.', {}, { color: MUTED }),
    fieldTable([
      { label: 'Razón social o nombre', value: oferente || '' }, { label: 'RUT', value: company.rut || '' }, { label: 'Giro o actividad', value: '' }, { label: 'Domicilio', value: '' },
      { label: 'Comuna y región', value: '' }, { label: 'Correo electrónico de contacto', value: '' }, { label: 'Teléfono', value: '' },
      { label: 'Representante legal', value: '' }, { label: 'RUT del representante legal', value: '' }, { label: 'Personería del representante', value: '' },
    ]),
  ];

  const technical = (): Para[] => {
    const out: Para[] = [h1('Oferta técnica')];
    if (draft.summary) out.push(...body(draft.summary));
    for (const section of draft.technical) {
      out.push(h2(section.heading));
      if (section.criterion || section.weight) out.push(grid([WIDTH], [new TableRow({ cantSplit: true, children: [cell([paragraph([run('Responde a: ', { bold: true, size: 19, color: NAVY }),
        run(section.criterion || section.heading, { size: 19 }), ...(section.weight ? [run(`  ·  Ponderación ${section.weight}`, { size: 19, color: MUTED })] : [])], { spacing: { after: 0 } })], WIDTH, { fill: PANEL })] })]), spacer(60));
      out.push(...body(section.body));
    }
    return out;
  };

  const compliance = (): Para[] => {
    if (!draft.compliance.length) return [];
    const widths = [560, 3400, 1500, WIDTH - 5460];
    return [h1('Cumplimiento de requisitos técnicos'), text('Marque si cumple cada requisito y describa cómo lo acredita.', {}, { color: MUTED }),
      grid(widths, [head(['N.º', 'Requisito de las bases', '¿Cumple?', 'Respuesta y respaldo'], widths), ...draft.compliance.map((item, index) => {
        const answer = complianceAnswer(item.answer);
        return new TableRow({ cantSplit: true, children: [
          cell([cellText(String(index + 1), { align: AlignmentType.CENTER })], widths[0], { middle: true }), cell([cellText(item.requirement)], widths[1]),
          cell([paragraph([kit.choice(['Sí cumple', 'No cumple', 'Por confirmar'], answer.choice === 'yes' ? 'Sí cumple' : null, 'Cumple', 20)], { spacing: { after: 0 } })], widths[2], { middle: true }),
          cell([answer.hint ? paragraph([kit.field(`Describa cómo cumple: ${answer.hint}`, { multiLine: true, size: 20 })], { spacing: { after: 0, line: 252, lineRule: LineRuleType.AUTO } }) : cellText(answer.text || ' ')], widths[3]),
        ] });
      })])];
  };

  const economic = (): Para[] => {
    if (!sheet.rows.length) return [];
    const widths = [600, 2900, 1000, 1300, 1700, WIDTH - 7500];
    const basis = sheet.withTax ? 'con IVA' : 'neto';
    const rows = sheet.rows.map((row, index) => new TableRow({ cantSplit: true, children: [
      cell([cellText(String(index + 1), { align: AlignmentType.CENTER })], widths[0], { middle: true }), cell([cellText(row.description)], widths[1]),
      cell([cellText(row.unit || '—')], widths[2], { middle: true }), cell([cellText(row.quantity === null ? '—' : String(row.quantity), { align: AlignmentType.RIGHT })], widths[3], { middle: true }),
      cell([row.unitPrice === null ? paragraph([kit.field('Precio', { size: 20 })], { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }) : cellText(money(row.unitPrice), { align: AlignmentType.RIGHT })], widths[4], { middle: true }),
      cell([cellText(row.subtotal === null ? '—' : money(row.subtotal), { align: AlignmentType.RIGHT })], widths[5], { middle: true }),
    ] }));
    const total = (label: string, value: number | null, bold = false) => new TableRow({ cantSplit: true, children: [
      cell([cellText(label, { bold: true, align: AlignmentType.RIGHT })], WIDTH - widths[5], { span: 5, fill: PANEL, middle: true }),
      cell([value === null ? paragraph([kit.field('Calcular', { size: 20 })], { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }) : cellText(money(value), { bold, align: AlignmentType.RIGHT })], widths[5], { fill: PANEL, middle: true }),
    ] });
    const done = sheet.complete && sheet.numbers;
    const terms = [draft.economic.validity ? `Vigencia de la oferta: ${draft.economic.validity}` : 'Vigencia de la oferta: [vigencia según las bases]',
      draft.economic.paymentTerms ? `Forma de pago: ${draft.economic.paymentTerms}` : '', ...draft.economic.notes].filter(Boolean);
    return [h1('Oferta económica'),
      text(`Valores ${basis}${draft.economic.priceBasis === 'unknown' ? ' (las bases no dicen si el portal pide el valor neto o el total: confírmelo)' : ''}, en pesos chilenos.`, {}, { color: MUTED }),
      grid(widths, [head(['N.º', 'Descripción', 'Unidad', 'Cantidad', `Precio unitario ${basis}`, 'Subtotal'], widths), ...rows,
        total('Valor neto', done ? sheet.numbers!.net : null), total('IVA (19 %)', done ? sheet.numbers!.tax : null), total('Total con IVA', done ? sheet.numbers!.total : null, true)]),
      ...(done ? [] : [paragraph([run('Escriba los precios en ANTON.IA («Tu oferta», Oferta económica) y vuelva a descargar: los totales se calculan solos y se comparan con el presupuesto.', { italics: true, color: MUTED, size: 19 })], { spacing: { before: 100, after: 120 } })]),
      h3('Condiciones de la oferta'), ...terms.map(bullet)];
  };

  // ─── The forms of the bases ───────────────────────────────────────────────────────────────────────────────────────────────
  const rowNumber = (header: string) => /^n\s*[°º.]?$|^n[úu]mero$|^n\.º$/i.test(header.trim());
  const renderBlock = (block: OfferAnnexBlock): Para[] => {
    const out: Para[] = block.title ? [h3(block.title)] : [];
    if (block.kind === 'text') out.push(...body(block.text));
    else if (block.kind === 'fields') out.push(fieldTable(block.fields.map(field => ({ label: field.label, value: field.value || prefillField(field.label, company) || '' }))), spacer(60));
    else if (block.kind === 'choices') {
      if (block.text) out.push(...body(block.text));
      out.push(...block.options.map(option => new Paragraph({ children: [kit.box(), run('  '), ...runs(option)], spacing: { after: 80 }, indent: { left: 200 } })));
    } else if (block.kind === 'table') {
      const columns = block.columns.length;
      const first = rowNumber(block.columns[0] || '') ? 620 : null;
      const rest = Math.floor((WIDTH - (first ?? 0)) / (first ? columns - 1 : columns));
      const widths = block.columns.map((_, i) => first && i === 0 ? first : rest);
      widths[widths.length - 1] += WIDTH - widths.reduce((a, b) => a + b, 0);
      const filled = block.rows.map(row => block.columns.map((_, i) => row[i] ?? ''));
      const blank = Array.from({ length: block.blankRows }, (_, n) => block.columns.map((__, i) => first && i === 0 ? String(filled.length + n + 1) : ''));
      out.push(grid(widths, [head(block.columns, widths), ...[...filled, ...blank].map(row => new TableRow({ cantSplit: true, height: { value: 460, rule: HeightRule.ATLEAST }, children: row.map((value, i) => cell([cellText(value, { align: first && i === 0 ? AlignmentType.CENTER : undefined })], widths[i], { middle: true })) }))]), spacer(80));
    }
    return out;
  };
  const annexPage = (annex: OfferAnnex, first = false): Para[] => [
    ...(annex.number ? [new Paragraph({ children: [new TextRun({ text: clean(annex.number), bold: true, color: MUTED, size: 20, allCaps: true, characterSpacing: 24 })], pageBreakBefore: !first, keepNext: true, spacing: { after: 40 } })] : []),
    new Paragraph({ children: [run(annex.title || annex.number, { bold: true, color: NAVY, size: 30 })], pageBreakBefore: !annex.number && !first, keepNext: true, spacing: { after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 6 } } }),
    paragraph([run(`${reference}${opportunity.title ? `: «${opportunity.title}»` : ''}`, { color: MUTED, size: 19 })], { spacing: { after: 160 } }),
    ...(annex.faithful ? [paragraph([run('Reproduce el formulario de las bases. Si las bases exigen presentarlo en el archivo original, copie estos datos en él.', { italics: true, color: MUTED, size: 18 })], { spacing: { after: 160 } })]
      : [callout('Formulario armado con lo que piden las bases', ['No encontramos el texto del formulario oficial. Compárelo con el que publicó el comprador (pestaña «Documentos» de la oportunidad) y use el oficial si existe.'], 'FFF8E6', false), spacer(160)]),
    ...(annex.intro ? body(annex.intro) : []),
    ...annex.blocks.flatMap(renderBlock),
    ...(annex.signed ? signature() : []),
  ];

  // ─── The document ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const only = input.onlyAnnex !== undefined ? annexes[input.onlyAnnex] : null;
  const hasIdentification = annexes.some(annex => /identificaci[oó]n del (?:oferente|proponente)|antecedentes administrativos/i.test(`${annex.title} ${annex.number}`));
  const offerChildren: Para[] = only ? annexPage(only, true) : [
    h1('Carta de presentación', false), ...letter(),
    ...(hasIdentification ? [] : identification()), ...technical(), ...compliance(), ...economic(),
    ...annexes.flatMap(annex => annexPage(annex)),
  ];
  const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1200, left: 1247, right: 1247, header: 600, footer: 560 } };
  const title = only ? `${only.number ? `${only.number}: ` : ''}${only.title}` : `Oferta: ${opportunity.title}`;
  const footer = new Footer({ children: [new Paragraph({ style: 'Pie', tabStops: [{ type: TabStopType.RIGHT, position: WIDTH }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
    children: [new TextRun({ text: clean(`${reference}${oferente ? ` · ${oferente}` : ''}`), color: MUTED, size: 17 }), new TextRun({ children: [new Tab(), 'Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], color: MUTED, size: 17 })] })] });
  const header = new Header({ children: [new Paragraph({ style: 'Pie', alignment: AlignmentType.RIGHT, children: [new TextRun({ text: clean(opportunity.title.slice(0, 110)), color: MUTED, size: 17 })] })] });
  const workHeader = new Header({ children: [new Paragraph({ style: 'Pie', alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'HOJA DE TRABAJO · NO SE ENVÍA', color: WARN, size: 17, bold: true, characterSpacing: 20 })] })] });

  const document = new Document({
    creator: 'ANTON.IA', title: clean(title), description: 'Borrador de oferta para completar y enviar',
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { line: 276, lineRule: LineRuleType.AUTO } } } },
      paragraphStyles: [{ id: 'Pie', name: 'Pie de página', basedOn: 'Normal', quickFormat: true, run: { size: 17, color: MUTED } }],
      characterStyles: [{ id: 'Marcador', name: 'Marcador', basedOn: 'DefaultParagraphFont', quickFormat: true, run: { color: FILL_TEXT, shading: { type: ShadingType.CLEAR, fill: FILL, color: 'auto' } } }],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } } } }] }] },
    sections: [
      ...(only ? [] : [{ properties: { page }, headers: { default: workHeader }, footers: { default: footer }, children: workSheet() }]),
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: offerChildren },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

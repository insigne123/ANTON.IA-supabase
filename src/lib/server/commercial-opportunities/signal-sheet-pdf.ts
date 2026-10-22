// The commercial sheet as a PDF: the page of the app, on paper. It draws the same model the page draws (signal-sheet.ts), section by
// section in the same order, with the same figures, and its charts (the bars, the fit meter, the follow-up timeline) as vector shapes.
// The drawing talks to a small `Pen` instead of jsPDF, so the tests can run it on a recording pen and check that everything on the
// sheet was drawn, inside the margins, without a PDF reader.
import { normalizeCoworkPdfText } from '@/lib/server/cowork/file-exports';
import { PRIORITY_STEPS } from '@/lib/commercial-opportunities/priority';
import { STRENGTH_LABELS } from '@/lib/commercial-opportunities/signal-brief';
import { SECTION_TITLES, sheetSections, type SectionId, type SignalSheet } from '@/lib/commercial-opportunities/signal-sheet';
import { IMPACT_LABELS } from '@/lib/commercial-opportunities/report-view';

export type Rgb = [number, number, number];
export interface Pen {
  readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly width: number;
  y: number; page: number;
  wrap(value: string, size: number, bold: boolean, width: number): string[];
  text(value: string, x: number, y: number, o?: { size?: number; bold?: boolean; color?: Rgb; align?: 'left' | 'right' | 'center'; link?: string }): void;
  rect(x: number, y: number, w: number, h: number, o?: { fill?: Rgb; stroke?: Rgb; radius?: number; lineWidth?: number }): void;
  line(x1: number, y1: number, x2: number, y2: number, o?: { color?: Rgb; width?: number }): void;
  dot(x: number, y: number, r: number, o?: { fill?: Rgb; stroke?: Rgb }): void;
  link(x: number, y: number, w: number, h: number, url: string): void;
  newPage(): void;
}

const INK: Rgb = [30, 41, 59], MUTED: Rgb = [100, 116, 139], ACCENT: Rgb = [37, 99, 235], SOFT: Rgb = [239, 246, 255], PAPER: Rgb = [248, 250, 252], RULE: Rgb = [226, 232, 240], WHITE: Rgb = [255, 255, 255];
const GREEN: Rgb = [5, 150, 105], GREEN_SOFT: Rgb = [220, 252, 231], AMBER: Rgb = [180, 83, 9], AMBER_SOFT: Rgb = [254, 243, 199], RED: Rgb = [185, 28, 28], RED_SOFT: Rgb = [254, 226, 226];
const MM = 0.3528;
const lineHeight = (size: number) => size * MM * 1.42;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** What the PDF's font can print. A LinkedIn post or an AI text may carry emoji or symbols it cannot: they are left out, never a failed download. */
const UNPRINTABLE = /[^\x20-\x7e\xa0-\xff\n\r\t‘’′“”″–—−‑…•→⇒➜←≥≤≠≈€✓✔✗✘\u200b\ufeff]/g;
const clean = (value: string) => normalizeCoworkPdfText(value.replace(/[Σ∑](?=\s*\()/g, 'sumatoria').replace(UNPRINTABLE, '').replace(/ {2,}/g, ' '));
const TONES: Record<string, { fill: Rgb; ink: Rgb }> = { go: { fill: GREEN_SOFT, ink: GREEN }, evaluate: { fill: AMBER_SOFT, ink: AMBER }, no: { fill: PAPER, ink: MUTED }, pending: { fill: PAPER, ink: MUTED } };
const IMPACT: Record<string, { fill: Rgb; ink: Rgb }> = { high: { fill: RED_SOFT, ink: RED }, medium: { fill: AMBER_SOFT, ink: AMBER }, low: { fill: PAPER, ink: MUTED } };

export type SheetPdfOptions = {
  /** Whether the team ticked an item (steps, what to validate, steps, questions); the PDF draws the tick as the page does. */
  done?: (kind: 'step' | 'requirement' | 'task' | 'question', text: string) => boolean;
  /** The team's notes on the report, with who wrote them. */
  notes?: Array<{ label: string; note: string; by: string }>;
  /** «Datos del radar al …» when no report has been written. */
  radarDate?: string;
};

/** Draws the whole sheet on the pen: pages are added as it goes, and the footers are the caller's. */
export function drawSignalSheet(pen: Pen, sheet: SignalSheet, options: SheetPdfOptions = {}) {
  const gap = 6;
  const ensure = (height: number) => { if (pen.y + height > pen.bottom) { pen.newPage(); pen.y = pen.top; } };
  /** Wrapped text at the cursor, line by line so it can run over a page; returns the height it took. */
  const paragraph = (value: string, o: { size?: number; bold?: boolean; color?: Rgb; x?: number; width?: number; after?: number; link?: string } = {}) => {
    const size = o.size ?? 10, x = o.x ?? pen.left, width = o.width ?? pen.right - x, start = pen.y;
    for (const line of pen.wrap(clean(value), size, Boolean(o.bold), width)) { ensure(lineHeight(size)); pen.text(line, x, pen.y, { size, bold: o.bold, color: o.color ?? INK, link: o.link }); pen.y += lineHeight(size); }
    pen.y += o.after ?? 1.5;
    return pen.y - start;
  };
  /** A list item with a round bullet; the text runs over a page like any paragraph. */
  const bullet = (value: string, o: { size?: number; color?: Rgb; after?: number } = {}) => {
    const size = o.size ?? 9.5, lines = pen.wrap(clean(value), size, false, pen.width - 6);
    ensure(lineHeight(size) + 0.5);
    pen.dot(pen.left + 1.4, pen.y + size * MM * 0.5, 0.7, { fill: o.color ?? MUTED });
    for (const line of lines) { ensure(lineHeight(size)); pen.text(line, pen.left + 5, pen.y, { size, color: o.color ?? INK }); pen.y += lineHeight(size); }
    pen.y += o.after ?? 0.8;
  };
  /** How much of a section has to fit under its title for the title to stay on that page. */
  const NEEDS: Partial<Record<SectionId, number>> = { messages: 80, cadence: 62, pulse: 50 };
  const heading = (id: SectionId) => {
    ensure(NEEDS[id] ?? 50); // a title never stays alone at the foot of a page
    pen.y += 3; pen.line(pen.left, pen.y, pen.right, pen.y, { color: RULE, width: 0.3 }); pen.y += 3;
    paragraph(SECTION_TITLES[id], { size: 13, bold: true, color: INK, after: 2.5 });
  };
  const chip = (value: string, x: number, y: number, tone: { fill: Rgb; ink: Rgb }, size = 7.5) => {
    const width = pen.wrap(clean(value), size, true, 200)[0].length * size * MM * 0.52 + 5;
    pen.rect(x, y, width, size * MM + 3.2, { fill: tone.fill, radius: 1.8 });
    pen.text(clean(value), x + 2.5, y + 1.5, { size, bold: true, color: tone.ink });
    return width;
  };
  /** A square to tick, with the tick when the team did. */
  const box = (x: number, y: number, ticked: boolean) => {
    pen.rect(x, y, 3.6, 3.6, { stroke: ticked ? GREEN : MUTED, fill: ticked ? GREEN : undefined, radius: 0.7, lineWidth: 0.3 });
    if (ticked) { pen.line(x + 0.8, y + 1.9, x + 1.6, y + 2.8, { color: WHITE, width: 0.5 }); pen.line(x + 1.6, y + 2.8, x + 2.9, y + 0.9, { color: WHITE, width: 0.5 }); }
  };
  const checkRow = (value: string, ticked: boolean, extra?: string) => {
    const lines = pen.wrap(clean(value), 9.5, false, pen.width - 8);
    ensure(lineHeight(9.5) * (lines.length + (extra ? 1 : 0)) + 2);
    box(pen.left, pen.y + 0.4, ticked);
    for (const line of lines) { pen.text(line, pen.left + 7, pen.y, { size: 9.5, color: ticked ? MUTED : INK }); pen.y += lineHeight(9.5); }
    if (extra) paragraph(extra, { size: 8.5, color: MUTED, x: pen.left + 7, width: pen.width - 8, after: 0 });
    pen.y += 1.6;
  };
  const dots = (x: number, y: number, filled: number, total = 3, color: Rgb = ACCENT) => { for (let i = 0; i < total; i++) pen.dot(x + i * 3.2, y, 1.15, i < filled ? { fill: color } : { stroke: MUTED }); };
  const barChart = (title: string, bars: Array<{ label: string; value: number; share: number; percent: number | null }>, x: number, width: number) => {
    const top = pen.y;
    pen.text(clean(title), x, pen.y, { size: 9, bold: true, color: INK }); pen.y += lineHeight(9) + 1;
    const labelW = 34, areaW = width - labelW - 20;
    for (const bar of bars) {
      pen.text(clean(bar.label.length > 20 ? `${bar.label.slice(0, 19)}…` : bar.label), x, pen.y, { size: 8.5, color: INK });
      pen.rect(x + labelW, pen.y + 0.3, areaW, 3.2, { fill: RULE, radius: 1.6 });
      pen.rect(x + labelW, pen.y + 0.3, Math.max(2.4, areaW * bar.share), 3.2, { fill: ACCENT, radius: 1.6 });
      pen.text(clean(`${bar.value}${bar.percent !== null ? ` · ${Math.round(bar.percent * 100)} %` : ''}`), x + width, pen.y, { size: 8, color: MUTED, align: 'right' });
      pen.y += 5.6;
    }
    return pen.y - top;
  };
  const sectionDraw: Record<SectionId, () => void> = {
    summary: () => {
      paragraph(sheet.headline, { size: 13, bold: true, after: 3 });
      if (sheet.executive) {
        const lines = pen.wrap(clean(sheet.executive), 10, false, pen.width - 8);
        ensure(lines.length * lineHeight(10) + 6);
        pen.rect(pen.left, pen.y, pen.width, lines.length * lineHeight(10) + 5, { fill: PAPER, radius: 2 }); pen.y += 2.5;
        for (const line of lines) { pen.text(line, pen.left + 4, pen.y, { size: 10, color: INK }); pen.y += lineHeight(10); }
        pen.y += 4;
      }
      if (sheet.whyNow.length) {
        paragraph('Por qué ahora', { size: 10.5, bold: true, after: 1 });
        sheet.whyNow.forEach((reason, index) => {
          const lines = pen.wrap(clean(reason), 9.5, false, pen.width - 9); ensure(lines.length * lineHeight(9.5) + 1);
          pen.dot(pen.left + 2.2, pen.y + 1.7, 2.2, { fill: ACCENT }); pen.text(String(index + 1), pen.left + 2.2, pen.y + 0.55, { size: 7, bold: true, color: WHITE, align: 'center' });
          for (const line of lines) { pen.text(line, pen.left + 7, pen.y, { size: 9.5, color: INK }); pen.y += lineHeight(9.5); }
          pen.y += 1;
        });
      }
      if (sheet.nextSteps.length) { pen.y += 2; paragraph('Qué hacer ahora', { size: 10.5, bold: true, after: 1 }); sheet.nextSteps.forEach(step => checkRow(step, Boolean(options.done?.('step', step)))); }
      if (sheet.warnings.length) {
        pen.y += 2; const wrapped = sheet.warnings.map(w => pen.wrap(clean(w), 9, false, pen.width - 12));
        const rows = wrapped.reduce((sum, lines) => sum + lines.length, 0);
        ensure(rows * lineHeight(9) + wrapped.length * 0.8 + 12);
        pen.rect(pen.left, pen.y, pen.width, rows * lineHeight(9) + wrapped.length * 0.8 + 9, { fill: AMBER_SOFT, radius: 2 }); pen.y += 2.5;
        pen.text('Antes de decidir', pen.left + 4, pen.y, { size: 9.5, bold: true, color: AMBER }); pen.y += lineHeight(9.5) + 0.5;
        for (const lines of wrapped) {
          pen.dot(pen.left + 5.2, pen.y + 1.5, 0.7, { fill: AMBER });
          for (const line of lines) { pen.text(line, pen.left + 8, pen.y, { size: 9, color: INK }); pen.y += lineHeight(9); }
          pen.y += 0.8;
        }
        pen.y += 4;
      }
    },
    pulse: () => {
      const pulse = sheet.pulse;
      const noteLines = (kpi: { note?: string }, width: number) => (kpi.note ? pen.wrap(clean(kpi.note), 7.5, false, width - 6).slice(0, 2) : []);
      const tileWidth = (pen.width - (pulse.kpis.length - 1) * 3) / pulse.kpis.length;
      const tall = Math.max(...pulse.kpis.map(kpi => noteLines(kpi, tileWidth).length), 0) > 1;
      const height = 20 + (tall ? 3.4 : 0);
      const tile = (index: number, kpi: { label: string; value: string; note?: string }) => {
        const x = pen.left + index * (tileWidth + 3), post = pulse.kind === 'post';
        pen.rect(x, pen.y, tileWidth, height, { fill: SOFT, radius: 2 });
        pen.text(clean(kpi.value), x + 3.5, pen.y + 3, { size: post ? 11 : 18, bold: true, color: ACCENT });
        pen.text(clean(kpi.label), x + 3.5, pen.y + (post ? 9.5 : 12), { size: 8, bold: true, color: INK });
        noteLines(kpi, tileWidth).forEach((line, row) => pen.text(line, x + 3.5, pen.y + (post ? 14 : 16) + row * 3.4, { size: 7.5, color: MUTED }));
      };
      ensure(height + 4); pulse.kpis.forEach((kpi, index) => tile(index, kpi)); pen.y += height + 4;
      if (pulse.kind === 'hiring') {
        paragraph(pulse.window, { size: 8.5, color: MUTED, after: 3 });
        const half = (pen.width - 8) / 2;
        const rows = Math.max(pulse.roles.length, pulse.regions.length);
        ensure(rows * 5.6 + 9);
        const top = pen.y;
        barChart('Cargos que buscan', pulse.roles, pen.left, half);
        const left = pen.y; pen.y = top;
        barChart('Dónde buscan', pulse.regions, pen.left + half + 8, half);
        pen.y = Math.max(left, pen.y) + 2;
        if (pulse.pace) {
          ensure(18);
          paragraph('Ritmo de contratación', { size: 9, bold: true, after: 1 });
          const peak = Math.max(pulse.pace.lastWeek, pulse.pace.priorWeekly, 1), areaW = 90;
          for (const [label, value, color] of [['Promedio anterior', pulse.pace.priorWeekly, MUTED], ['Última semana', pulse.pace.lastWeek, ACCENT]] as Array<[string, number, Rgb]>) {
            pen.text(label, pen.left, pen.y, { size: 8.5, color: INK });
            pen.rect(pen.left + 42, pen.y + 0.3, areaW, 3.2, { fill: RULE, radius: 1.6 }); pen.rect(pen.left + 42, pen.y + 0.3, Math.max(2.4, areaW * value / peak), 3.2, { fill: color, radius: 1.6 });
            pen.text(clean(new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value)), pen.left + 42 + areaW + 3, pen.y, { size: 8.5, bold: true, color: INK }); pen.y += 5.6;
          }
        }
        if (pulse.publishers.length) paragraph(`Publicados en: ${pulse.publishers.join(', ')}.`, { size: 8.5, color: MUTED, after: 1 });
      } else {
        const lines = pen.wrap(clean(pulse.post.text), 10, false, pen.width - 12);
        ensure(lines.length * lineHeight(10) + 14);
        pen.rect(pen.left, pen.y, pen.width, lines.length * lineHeight(10) + 11, { fill: PAPER, radius: 2 }); pen.rect(pen.left, pen.y, 1.4, lines.length * lineHeight(10) + 11, { fill: ACCENT });
        pen.y += 2.5; pen.text(clean([pulse.post.author, pulse.post.when, pulse.post.ago].filter(Boolean).join(' · ')), pen.left + 6, pen.y, { size: 8.5, bold: true, color: MUTED }); pen.y += lineHeight(8.5) + 1;
        for (const line of lines) { pen.text(line, pen.left + 6, pen.y, { size: 10, color: INK }); pen.y += lineHeight(10); }
        pen.y += 5;
        if (pulse.post.truncated) paragraph('El texto de la publicación está cortado.', { size: 8.5, color: MUTED });
      }
    },
    fit: () => {
      ensure(24);
      const w = pen.width - 4, x = pen.left + 2, y = pen.y + 3;
      const bands: Rgb[] = [[254, 226, 226], [254, 243, 199], [254, 249, 195], [209, 250, 229], [167, 243, 208]];
      const cuts = [...PRIORITY_STEPS].reverse().map(step => step.from);
      cuts.forEach((from, index) => { const to = cuts[index + 1] ?? 100; pen.rect(x + w * from / 100, y, w * (to - from) / 100, 4, { fill: bands[index] }); });
      const mark = x + w * sheet.fit.score / 100;
      pen.rect(mark - 0.5, y - 2, 1, 8, { fill: INK }); pen.text(String(sheet.fit.score), mark, y - 5, { size: 8.5, bold: true, color: INK, align: 'center' });
      pen.y += 11;
      paragraph(`Afinidad con tu oferta: ${sheet.fit.score} de 100 · ${sheet.fit.meaning}`, { size: 9, color: MUTED, after: 3 });
      for (const service of sheet.fit.services) {
        const lines = pen.wrap(clean(service.why), 9, false, pen.width - 36);
        ensure(lineHeight(10) + lines.length * lineHeight(9) + 2);
        dots(pen.left + 1.6, pen.y + 1.5, service.strength === 'strong' ? 3 : service.strength === 'medium' ? 2 : 1, 3, service.strength === 'strong' ? GREEN : service.strength === 'medium' ? ACCENT : MUTED);
        pen.text(clean(service.service), pen.left + 12, pen.y, { size: 10, bold: true, color: INK }); pen.text(clean(STRENGTH_LABELS[service.strength]), pen.right, pen.y, { size: 8, color: MUTED, align: 'right' });
        pen.y += lineHeight(10);
        for (const line of lines) { pen.text(line, pen.left + 12, pen.y, { size: 9, color: MUTED }); pen.y += lineHeight(9); }
        pen.y += 1.5;
      }
      if (!sheet.fit.services.length && sheet.fit.matchedService) paragraph(`Servicio con el que el radar encontró esta señal: ${sheet.fit.matchedService}.`, { size: 9.5 });
      if (sheet.fit.gaps.length) { pen.y += 1; paragraph('Lo que habría que respaldar', { size: 9.5, bold: true, after: 0.5 }); sheet.fit.gaps.forEach(gapText => bullet(gapText, { size: 9, color: MUTED })); }
    },
    company: () => {
      if (sheet.company.summary) paragraph(sheet.company.summary, { size: 10, after: 3 });
      const colW = (pen.width - 6) / 2;
      sheet.company.facts.forEach((fact, index) => {
        const column = index % 2, x = pen.left + column * (colW + 6);
        if (column === 0) ensure(10);
        pen.text(clean(fact.label), x, pen.y, { size: 7.5, bold: true, color: MUTED });
        pen.text(clean(pen.wrap(clean(fact.value), 9.5, false, colW)[0]), x, pen.y + 3.6, { size: 9.5, color: INK });
        if (column === 1 || index === sheet.company.facts.length - 1) pen.y += 10;
      });
    },
    buyers: () => {
      const colW = (pen.width - 5) / 2;
      sheet.buyers.forEach((buyer, index) => {
        const column = index % 2, x = pen.left + column * (colW + 5);
        const why = pen.wrap(clean(buyer.why), 8.5, false, colW - 8), h = 14 + why.length * lineHeight(8.5);
        if (column === 0) ensure(h + 2);
        const y = pen.y;
        pen.rect(x, y, colW, h, { stroke: RULE, radius: 2, lineWidth: 0.3 });
        pen.text(clean(pen.wrap(clean(buyer.title), 10, true, colW - 8)[0]), x + 4, y + 3, { size: 10, bold: true, color: INK });
        chip(buyer.priority === 'primary' ? 'Principal' : 'Apoyo', x + 4, y + 8.2, buyer.priority === 'primary' ? { fill: GREEN_SOFT, ink: GREEN } : { fill: PAPER, ink: MUTED }, 7);
        pen.text('Buscar en LinkedIn', x + colW - 4, y + 8.6, { size: 7.5, color: ACCENT, align: 'right', link: buyer.searchUrl });
        let at = y + 14; for (const line of why) { pen.text(line, x + 4, at, { size: 8.5, color: MUTED }); at += lineHeight(8.5); }
        if (column === 1 || index === sheet.buyers.length - 1) pen.y += h + 3;
      });
    },
    approach: () => {
      const approach = sheet.approach!;
      const lines = pen.wrap(clean(approach.angle), 10, false, pen.width - 10);
      ensure(lines.length * lineHeight(10) + 12);
      pen.rect(pen.left, pen.y, pen.width, lines.length * lineHeight(10) + 10, { fill: SOFT, radius: 2 });
      pen.text('Ángulo', pen.left + 4, pen.y + 2.2, { size: 8, bold: true, color: ACCENT }); pen.y += 6.5;
      for (const line of lines) { pen.text(line, pen.left + 4, pen.y, { size: 10, color: INK }); pen.y += lineHeight(10); }
      pen.y += 6;
      if (approach.hooks.length) { paragraph('Qué mencionar', { size: 9.5, bold: true, after: 0.5 }); approach.hooks.forEach(hook => bullet(hook)); pen.y += 1.5; }
      if (approach.avoid.length) { paragraph('Qué evitar', { size: 9.5, bold: true, color: RED, after: 0.5 }); approach.avoid.forEach(item => bullet(item)); }
    },
    messages: () => {
      for (const message of sheet.messages) {
        const body = message.body.split('\n').flatMap(part => (part.trim() ? pen.wrap(clean(part), 9.5, false, pen.width - 10) : ['']));
        const h = 8 + body.length * lineHeight(9.5) + 3;
        ensure(Math.min(h, 60) + 2);
        const y = pen.y;
        pen.rect(pen.left, y, pen.width, h, { stroke: RULE, radius: 2, lineWidth: 0.3 });
        pen.rect(pen.left, y, pen.width, 7, { fill: PAPER, radius: 2 });
        pen.text(clean(message.subject ? `${message.channelLabel} · ${message.subject}` : message.channelLabel), pen.left + 4, y + 2, { size: 9, bold: true, color: INK });
        pen.y = y + 9;
        for (const line of body) { if (pen.y + lineHeight(9.5) > pen.bottom) { pen.newPage(); pen.y = pen.top; } pen.text(line, pen.left + 5, pen.y, { size: 9.5, color: INK }); pen.y += lineHeight(9.5); }
        pen.y += 5;
      }
    },
    cadence: () => {
      ensure(40);
      const maxDay = Math.max(...sheet.cadence.map(step => step.day), 1);
      const x0 = pen.left + 8, x1 = pen.right - 8, y = pen.y + 14;
      pen.line(x0, y, x1, y, { color: RULE, width: 1 });
      sheet.cadence.forEach((step, index) => {
        const x = x0 + (x1 - x0) * step.day / maxDay, up = index % 2 === 0;
        pen.dot(x, y, 2, { fill: ACCENT });
        const label = clamp(x, pen.left + step.channelLabel.length * 7.5 * MM * 0.3, pen.right - step.channelLabel.length * 7.5 * MM * 0.3); // the first and the last labels stay on the page
        pen.text(clean(step.channelLabel), label, up ? y - 7 : y + 4, { size: 7.5, bold: true, color: INK, align: 'center' });
        pen.text(`Día ${step.day}`, label, up ? y - 4 : y + 7.3, { size: 7, color: MUTED, align: 'center' });
      });
      pen.y += 30;
      sheet.cadence.forEach(step => paragraph(`Día ${step.day} · ${step.channelLabel}: ${step.action}`, { size: 9.5, after: 0.8 }));
      paragraph('Es una propuesta: ajusta los días según cómo responda la persona.', { size: 8, color: MUTED });
    },
    objections: () => { for (const item of sheet.objections) { paragraph(item.objection, { size: 10, bold: true, after: 0.5 }); paragraph(item.answer, { size: 9.5, color: INK, after: 3 }); } },
    validate: () => sheet.validate.forEach(item => checkRow(item.title, Boolean(options.done?.('requirement', item.title)), [item.action, item.owner].filter(Boolean).join(' · '))),
    plan: () => sheet.plan.forEach(item => checkRow(item.title, Boolean(options.done?.('task', item.title)), [item.owner, item.result && `Resultado: ${item.result}`].filter(Boolean).join(' · '))),
    risks: () => {
      for (const risk of sheet.risks) {
        const lines = pen.wrap(clean(risk.mitigation), 9, false, pen.width);
        ensure(lineHeight(10) + lines.length * lineHeight(9) + 4);
        const w = chip(IMPACT_LABELS[risk.impact] ?? risk.impact, pen.left, pen.y, IMPACT[risk.impact] ?? IMPACT.low);
        for (const line of pen.wrap(clean(risk.title), 10, true, pen.width - w - 4)) { pen.text(line, pen.left + w + 3, pen.y + 1.2, { size: 10, bold: true, color: INK }); pen.y += lineHeight(10); }
        pen.y += 1.6; for (const line of lines) { pen.text(line, pen.left, pen.y, { size: 9, color: MUTED }); pen.y += lineHeight(9); }
        pen.y += 2.5;
      }
    },
    questions: () => sheet.questions.forEach((question, index) => checkRow(`${index + 1}. ${question}`, Boolean(options.done?.('question', question)))),
    sample: () => {
      for (const ad of sheet.sample) {
        const meta = [ad.where, ad.when, ad.publisher].filter(Boolean).join(' · ');
        ensure(14);
        paragraph(ad.title, { size: 9.5, bold: true, after: 0 }); if (meta) paragraph(meta, { size: 8.5, color: MUTED, after: 0 });
        if (ad.url) paragraph(ad.url.length > 90 ? `${ad.url.slice(0, 89)}…` : ad.url, { size: 7.5, color: ACCENT, link: ad.url, after: 2 }); else pen.y += 2;
      }
    },
    pending: () => {
      ensure(16);
      pen.rect(pen.left, pen.y, pen.width, 3, { fill: RULE, radius: 1.5 }); pen.rect(pen.left, pen.y, Math.max(3, pen.width * sheet.completeness.percent / 100), 3, { fill: GREEN, radius: 1.5 }); pen.y += 6;
      paragraph(`${sheet.completeness.done} de ${sheet.completeness.total} partes listas (${sheet.completeness.percent} %)`, { size: 9, color: MUTED, after: 2 });
      for (const item of sheet.completeness.items.filter(entry => !entry.done)) checkRow(item.label, false, item.action);
    },
  };

  // Cover: the company, what kind of signal it is, how well it fits, and the decision.
  const titleLines = pen.wrap(clean(sheet.title), 20, true, pen.width - 44).slice(0, 2);
  const band = 24 + titleLines.length * 8.6;
  pen.rect(0, 0, 210, band, { fill: ACCENT });
  pen.text('ANTON.IA · FICHA COMERCIAL', pen.left, 9, { size: 8, bold: true, color: [191, 219, 254] });
  let nameY = 14;
  for (const line of titleLines) { pen.text(line, pen.left, nameY, { size: 20, bold: true, color: WHITE }); nameY += 8.6; }
  const sub = [sheet.kindLabel, sheet.relation?.label, sheet.preparedAt ? `Preparada el ${sheet.preparedAt}` : options.radarDate ? `Datos del radar al ${options.radarDate}` : null].filter(Boolean).join(' · ');
  pen.text(clean(sub), pen.left, band - 8, { size: 8.5, color: [219, 234, 254] });
  pen.text(`Prioridad ${sheet.stars.count} de 5`, pen.right, 10, { size: 8.5, bold: true, color: WHITE, align: 'right' });
  for (let i = 0; i < 5; i++) pen.dot(pen.right - 2 - (4 - i) * 4.2, 15, 1.6, i < sheet.stars.count ? { fill: WHITE } : { stroke: [147, 197, 253] });
  pen.y = band + 6;
  if (sheet.decision) { const w = chip(sheet.decision.label, pen.left, pen.y, TONES[sheet.decision.tone] ?? TONES.pending, 9); void w; }
  sheet.links.slice(0, 2).forEach((link, index) => pen.text(clean(link.label), pen.right, pen.y + 1.2 + index * 4.6, { size: 8, color: ACCENT, align: 'right', link: link.url }));
  pen.y += sheet.decision || sheet.links.length ? 11 : 0;
  for (const id of sheetSections(sheet)) { if (id !== 'summary') heading(id); sectionDraw[id](); pen.y += id === 'summary' ? 0 : gap / 3; }
  if (options.notes?.length) {
    pen.y += 3; pen.line(pen.left, pen.y, pen.right, pen.y, { color: RULE, width: 0.3 }); pen.y += 3; paragraph('Notas del equipo', { size: 13, bold: true, after: 2.5 });
    options.notes.forEach(note => { paragraph(note.label, { size: 9.5, bold: true, after: 0 }); paragraph(note.note, { size: 9.5, after: 0 }); if (note.by) paragraph(note.by, { size: 8, color: MUTED, after: 2.5 }); });
  }
}

/** The pen over jsPDF: A4 in millimetres, 16 mm side margins, the footer of every page drawn at the end. */
export async function signalSheetPdf(sheet: SignalSheet, options: SheetPdfOptions = {}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const fill = (color?: Rgb) => { if (color) pdf.setFillColor(...color); };
  const pen: Pen = {
    left: 16, right: 194, top: 18, bottom: 280, width: 178, y: 18, page: 1,
    wrap: (value, size, bold, width) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); return pdf.splitTextToSize(value, width) as string[]; },
    text: (value, x, y, o = {}) => {
      pdf.setFont('helvetica', o.bold ? 'bold' : 'normal'); pdf.setFontSize(o.size ?? 10); pdf.setTextColor(...(o.color ?? INK));
      const at = y + (o.size ?? 10) * MM * 0.82;
      if (o.link) pdf.textWithLink(value, x, at, { url: o.link, align: o.align ?? 'left' }); else pdf.text(value, x, at, { align: o.align ?? 'left' });
    },
    rect: (x, y, w, h, o = {}) => {
      fill(o.fill); if (o.stroke) { pdf.setDrawColor(...o.stroke); pdf.setLineWidth(o.lineWidth ?? 0.3); }
      const style = o.fill && o.stroke ? 'FD' : o.fill ? 'F' : 'S';
      if (o.radius) pdf.roundedRect(x, y, w, h, o.radius, o.radius, style); else pdf.rect(x, y, w, h, style);
    },
    line: (x1, y1, x2, y2, o = {}) => { pdf.setDrawColor(...(o.color ?? RULE)); pdf.setLineWidth(o.width ?? 0.3); pdf.line(x1, y1, x2, y2); },
    dot: (x, y, r, o = {}) => { fill(o.fill); if (o.stroke) { pdf.setDrawColor(...o.stroke); pdf.setLineWidth(0.3); } pdf.circle(x, y, r, o.fill && o.stroke ? 'FD' : o.fill ? 'F' : 'S'); },
    link: (x, y, w, h, url) => { pdf.link(x, y, w, h, { url }); },
    newPage: () => { pdf.addPage(); pen.page++; },
  };
  drawSignalSheet(pen, sheet, options);
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...MUTED);
    pdf.setDrawColor(...RULE); pdf.setLineWidth(0.3); pdf.line(16, 285, 194, 285);
    pdf.text(clean(`ANTON.IA · Ficha comercial · ${sheet.title}`.slice(0, 110)), 16, 290);
    pdf.text(`Página ${page} de ${pages}`, 194, 290, { align: 'right' });
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

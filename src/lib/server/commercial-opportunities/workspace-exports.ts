import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityFinancialScenario } from '@/lib/commercial-opportunities/workspace';
import { IMPACT_LABELS, consultationEmail, humanDate, isSignalReport, opportunityReportWarnings, reportDecision, reportKeyDates, reportNextSteps, statusLabel } from '@/lib/commercial-opportunities/report-view';
import {normalizeCoworkPdfText} from '@/lib/server/cowork/file-exports';

const LABELS:Record<string,string>={monthlyNet:'Precio neto mensual',totalNet:'Precio neto total',totalWithTax:'Total con impuestos',workingCapital:'Capital de trabajo',guarantee:'Garantía'};
const label=(v:string)=>LABELS[v]||IMPACT_LABELS[v]||statusLabel(v);
const pdfText=(value:string)=>normalizeCoworkPdfText(value.replace(/[Σ∑](?=\s*\()/g,'sumatoria'));
const money=(n:number)=>new Intl.NumberFormat('es-CL',{maximumFractionDigits:0}).format(n);
/** What the export knows about the opportunity besides the report: its name, buyer, deadline and amount. */
export type ExportOpportunity = { title: string; buyer?: string | null; deadline?: string | null; amount?: number | null; currency?: string | null };
function cover(report: OpportunityReport, opportunity?: ExportOpportunity) {
  const dates = reportKeyDates(report, opportunity?.deadline);
  const facts = isSignalReport(report) ? [] : [
    ['Cierre', dates.closes ?? 'Por confirmar'], ['Consultas hasta', dates.questions ?? 'Por confirmar'],
    ['Monto', opportunity?.amount ? `${money(opportunity.amount)} ${opportunity.currency || ''}`.trim() : 'No informado'],
    ['Requisitos', String(report.requirements.length)],
  ];
  return { decision: reportDecision(report).label, prepared: humanDate(report.generatedAt) ?? '', facts, steps: reportNextSteps(report) };
}
const sourceOf=(report:OpportunityReport,chunkId:string)=>{const source=report.sources.find(s=>s.id===chunkId);return source?`${source.name}, ${source.locator}`:'documento del expediente';};

export function opportunityReportMarkdown(report: OpportunityReport, opportunity?: ExportOpportunity) {
  const c = cover(report, opportunity);
  const lines = [`# ${opportunity?.title || report.title}`, `**${c.decision}** · Preparado el ${c.prepared}${opportunity?.buyer ? ` · ${opportunity.buyer}` : ''}`,
    ...(c.facts.length ? [c.facts.map(([k, v]) => `**${k}:** ${v}`).join(' · ')] : []),
    '', '## Resumen', report.executive, ...report.reasons.map(r => `- ${r}`), '', '## Qué hacer ahora', ...c.steps.map((s, i) => `${i + 1}. ${s}`)];
  const warnings = opportunityReportWarnings(report.warnings, [], false);
  if (warnings.length) lines.push('', '## Antes de decidir', ...warnings.map(w => `- ${w}`));
  if (report.milestones.length) lines.push('', '## Fechas clave', ...report.milestones.map(m => `- **${m.label}:** ${m.date}`));
  if (report.requirements.length) lines.push('', isSignalReport(report) ? '## Qué validar con la empresa' : '## Requisitos para postular', ...report.requirements.map(r => `- **${r.title}** · ${label(r.status)}\n  ${r.action}${r.role || r.due ? `\n  ${[r.role, r.due].filter(Boolean).join(' · ')}` : ''}`));
  if (report.tasks.length) lines.push('', isSignalReport(report) ? '## Pasos comerciales' : '## Plan de trabajo', ...report.tasks.map(t => `- **${t.title}** · ${[t.role, t.due].filter(Boolean).join(' · ')}${t.dependency ? `\n  Antes: ${t.dependency}` : ''}${t.evidence ? `\n  Resultado: ${t.evidence}` : ''}`));
  if (report.risks.length) lines.push('', '## Riesgos y cómo cubrirlos', ...report.risks.map(r => `- **${r.title}** · ${label(r.impact)}\n  ${r.mitigation}`));
  if (report.questions.length) lines.push('', isSignalReport(report) ? '## Preguntas para la primera conversación' : '## Preguntas para el comprador', ...report.questions.map((q, i) => `${i + 1}. ${q}`));
  lines.push('', '## Números');
  if (!report.scenarios.length) lines.push('No hay escenarios numéricos disponibles: faltan costos y condiciones para calcular la garantía y el precio.');
  for (const s of report.scenarios) { const r = opportunityFinancialScenario(s); lines.push(`### ${s.name}`, ...s.assumptions.map(a => `- Supuesto: ${a}`), ...Object.entries(r).map(([k, v]) => `- ${label(k)}: ${v === null ? 'por confirmar' : money(v)}`)); }
  lines.push('', '## Análisis detallado');
  for (const section of report.sections) lines.push('', `### ${section.title}`, ...section.paragraphs, ...section.facts.map(f => `- ${f.text}${f.citations.map(c => ` (Fuente: ${sourceOf(report, c.chunkId)}: «${c.quote}»)`).join('')}`));
  lines.push('', '## Documentos leídos', ...report.coverage.map(d => `- ${d.name}: ${label(d.status)}${d.pagesTotal ? `, ${d.pagesRead} de ${d.pagesTotal} páginas` : ''}`));
  return lines.join('\n\n');
}
export async function opportunityReportPdf(report: OpportunityReport, opportunity?: ExportOpportunity) {
  const { jsPDF } = await import('jspdf'); const imported = await import('jspdf-autotable');
  const autoTable=typeof imported.default==='function'?imported.default:(imported.default as unknown as {default:typeof imported.default}).default;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); let y = 24;
  const page = () => { pdf.addPage(); y = 24; };
  const space = (height: number) => { if (y + height > 276) page(); };
  const text = (value: string, size = 10, color: [number, number, number] = [30, 41, 59]) => {
    pdf.setFontSize(size); pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(pdfText(value), 176) as string[];
    for (const line of lines) { space(size > 12 ? 8 : 5); pdf.text(line, 17, y); y += size > 12 ? 7 : size > 10 ? 5.6 : 5; } y += 3;
  };
  const heading = (value: string) => { space(22);pdf.outline?.add(null,pdfText(value),{pageNumber:pdf.getCurrentPageInfo().pageNumber}); pdf.setFont('helvetica', 'bold'); text(value, 14); pdf.setFont('helvetica', 'normal'); };
  const table = (headers: string[], body: any[][]) => {
    space(25); autoTable(pdf, { startY: y, head: [headers], body:body.map(row=>row.map(cell=>pdfText(String(cell)))), margin: { left: 17, right: 17, top: 23, bottom: 22 },
      styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' }, headStyles: { fillColor: [37, 99, 235] }, alternateRowStyles: { fillColor: [248, 250, 252] }, rowPageBreak: 'avoid', showHead: 'everyPage' });
    y = (pdf as any).lastAutoTable.finalY + 8;
  };
  // Cover: the decision, the key dates and what to do now fit on the first page.
  const c = cover(report, opportunity);
  text(isSignalReport(report) ? 'ANTON.IA · FICHA COMERCIAL' : 'ANTON.IA · INFORME DE OPORTUNIDAD', 9, [100, 116, 139]);
  pdf.setFont('helvetica', 'bold'); text(opportunity?.title || report.title, 17); pdf.setFont('helvetica', 'normal');
  text([opportunity?.buyer, `Preparado el ${c.prepared}`].filter(Boolean).join(' · '), 10, [100, 116, 139]);
  const tone: Record<string, [number, number, number]> = { go: [220, 252, 231], evaluate: [254, 243, 199], no: [241, 245, 249], pending: [241, 245, 249] };
  space(16); pdf.setFillColor(...(tone[reportDecision(report).tone] || tone.pending)); pdf.roundedRect(17, y - 5, 176, 11, 2, 2, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(30, 41, 59); pdf.text(pdfText(c.decision), 21, y + 2); pdf.setFont('helvetica', 'normal'); y += 13;
  if (c.facts.length) table(c.facts.map(([k]) => k), [c.facts.map(([, v]) => v)]);
  text(report.executive, 11);
  pdf.setFont('helvetica', 'bold'); text('Qué hacer ahora', 12); pdf.setFont('helvetica', 'normal');
  c.steps.forEach((s, i) => text(`${i + 1}. ${s}`));
  report.reasons.forEach(r => text(`• ${r}`, 10, [71, 85, 105]));
  const warnings = opportunityReportWarnings(report.warnings, [], false);
  if (warnings.length) { heading('Antes de decidir'); warnings.forEach(w => text(`• ${w}`)); }
  if (report.milestones.length) { heading('Fechas clave'); table(['Hito', 'Fecha'], report.milestones.map(m => [m.label, m.date])); }
  if (report.requirements.length) { heading(isSignalReport(report) ? 'Qué validar con la empresa' : 'Requisitos para postular');
    table(['Requisito', 'Situación', 'Qué hacer', 'Quién / cuándo'], report.requirements.map(r => [r.title, label(r.status), r.action, [r.role, r.due].filter(Boolean).join('\n')])); }
  if (report.tasks.length) { heading(isSignalReport(report) ? 'Pasos comerciales' : 'Plan de trabajo'); table(['Tarea', 'Quién / cuándo', 'Antes', 'Resultado'], report.tasks.map(t => [t.title, [t.role, t.due].filter(Boolean).join('\n'), t.dependency, t.evidence])); }
  if (report.risks.length) { heading('Riesgos y cómo cubrirlos'); table(['Riesgo', 'Impacto', 'Cómo cubrirlo'], report.risks.map(r => [r.title, label(r.impact), r.mitigation])); }
  if (report.questions.length) {
    heading(isSignalReport(report) ? 'Preguntas para la primera conversación' : 'Preguntas para el comprador');
    if (isSignalReport(report)) report.questions.forEach((q, i) => text(`${i + 1}. ${q}`));
    else { text('Correo listo para enviar dentro del plazo de consultas:', 10, [100, 116, 139]); text(consultationEmail(report, { title: opportunity?.title || report.title, buyer: opportunity?.buyer }), 9); }
  }
  heading('Números');
  if (!report.scenarios.length) text('No hay escenarios numéricos disponibles: faltan costos y condiciones para calcular precio, garantía y capital de trabajo.');
  for (const s of report.scenarios) {
    const result = opportunityFinancialScenario(s); pdf.setFont('helvetica', 'bold'); text(s.name, 11); pdf.setFont('helvetica', 'normal'); s.assumptions.forEach(a => text(`Supuesto: ${a}`, 9));
    table(['Concepto', 'Valor calculado'], Object.entries(result).map(([k, v]) => [label(k), v === null ? 'Impuesto por confirmar' : money(v)]));
  }
  heading('Análisis detallado');
  for (const section of report.sections) {
    pdf.setFont('helvetica', 'bold'); text(section.title, 12); pdf.setFont('helvetica', 'normal'); section.paragraphs.forEach(p => text(p));
    section.facts.forEach(f => { text(`• ${f.text}`); f.citations.forEach(c => text(`Fuente: ${sourceOf(report, c.chunkId)}\n«${c.quote}»`, 8, [100, 116, 139])); });
  }
  heading('Documentos leídos'); table(['Documento', 'Lectura', 'Páginas'], report.coverage.map(d => [d.name, label(d.status), d.pagesTotal ? `${d.pagesRead} de ${d.pagesTotal}` : '—']));
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { pdf.setPage(p); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); if (p > 1) pdf.text('ANTON.IA · ' + pdfText((opportunity?.title || report.title).slice(0, 100)), 17, 12); pdf.text(`Página ${p} de ${pages}`, 17, 289); }
  return new Uint8Array(pdf.output('arraybuffer'));
}
export async function opportunityReportExcel(report: OpportunityReport) {
  const XLSX = await import('xlsx'); const book = XLSX.utils.book_new();
  const add = (name: string, rows: any[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  add('Requisitos', [['Requisito', 'Situación', 'Acción', 'Responsable sugerido', 'Hito'], ...report.requirements.map(r => [r.title, label(r.status), r.action, r.role, r.due])]);
  add('Plan', [['Tarea', 'Responsable', 'Hito', 'Dependencia', 'Evidencia'], ...report.tasks.map(t => [t.title, t.role, t.due, t.dependency, t.evidence])]);
  add('Riesgos', [['Riesgo', 'Impacto', 'Fundamento', 'Mitigación'], ...report.risks.map(r => [r.title, label(r.impact), label(r.basis), r.mitigation])]);
  add('Escenarios', [['Escenario', 'Costo mensual', 'Meses', 'Estructura %', 'Margen %', 'Impuesto %', 'Demora pago meses', 'Garantía %', 'Precio neto', 'Capital trabajo', 'Supuestos'], ...report.scenarios.map(s => { const r = opportunityFinancialScenario(s); return [s.name, s.monthlyCost, s.months, s.overheadPercent, s.marginPercent, s.taxPercent, s.paymentDelayMonths, s.guaranteePercent, r.totalNet, r.workingCapital, s.assumptions.join('; ')]; })]);
  add('Preguntas', [['Pregunta'], ...report.questions.map(q => [q])]);
  add('Documentos', [['Documento', 'Lectura', 'Páginas leídas', 'Páginas'], ...report.coverage.map(d => [d.name, label(d.status), d.pagesRead, d.pagesTotal])]);
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
}

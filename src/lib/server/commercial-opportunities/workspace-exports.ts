import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import { opportunityFinancialScenario } from '@/lib/commercial-opportunities/workspace';
import {normalizeCoworkPdfText} from '@/lib/server/cowork/file-exports';

const LABELS:Record<string,string>={supported:'Respaldado',pending:'Pendiente',blocked:'Bloqueante',unknown:'Por confirmar',documented:'Documentado',calculated:'Calculado',proposed:'Propuesto',read:'Leído',partial:'Lectura parcial',scan:'Escaneado',damaged:'No legible',high:'Alto',medium:'Medio',low:'Bajo',monthlyNet:'Precio neto mensual',totalNet:'Precio neto total',totalWithTax:'Total con impuestos',workingCapital:'Capital de trabajo',guarantee:'Garantía'};
const label=(v:string)=>LABELS[v]||v;

export function opportunityReportMarkdown(report: OpportunityReport) {
  const lines = [`# ${report.title}`, `Fecha de corte: ${report.generatedAt}`, '', '## Decisión ejecutiva', report.executive, ...report.reasons.map(r => `- ${r}`)];
  for (const section of report.sections) lines.push('', `## ${section.title}`, ...section.paragraphs, ...section.facts.map(f => `- [${label(f.state)}] ${f.text}${f.citations.map(c => {const source=report.sources.find(s=>s.id===c.chunkId);return ` [${source?.name||c.chunkId}, ${source?.locator||''}: «${c.quote}»]`;}).join('')}`));
  lines.push('', '## Requisitos', ...report.requirements.map(r => `- ${r.title} · ${r.status}\n  Acción: ${r.action}\n  Responsable sugerido: ${r.role} · Fecha: ${r.due}`), '', '## Hoja de ruta', ...report.tasks.map(t => `- ${t.title} · ${t.role} · ${t.due}\n  Depende de: ${t.dependency}\n  Evidencia esperada: ${t.evidence}`));
  lines.push('', '## Escenarios calculados');
  for (const s of report.scenarios) lines.push(`### ${s.name}`, ...s.assumptions.map(a => `- Supuesto: ${a}`), JSON.stringify(opportunityFinancialScenario(s), null, 2));
  lines.push('', '## Riesgos', ...report.risks.map(r => `- ${r.title} · ${r.impact} · ${r.basis}\n  Mitigación: ${r.mitigation}`), '', '## Preguntas pendientes', ...report.questions.map(q => `- ${q}`), '', '## Cobertura y observaciones', ...report.warnings.map(w => `- ${w}`), ...report.coverage.map(d => `- ${d.name}: ${d.status}, páginas ${d.pagesRead}/${d.pagesTotal ?? 'no aplica'}`));
  lines.push('', '## Índice de fuentes', ...report.sources.map(s => `- ${s.id}: ${s.name}, ${s.locator}`));
  return lines.join('\n\n');
}
export async function opportunityReportPdf(report: OpportunityReport) {
  const { jsPDF } = await import('jspdf'); const imported = await import('jspdf-autotable');
  const autoTable=typeof imported.default==='function'?imported.default:(imported.default as unknown as {default:typeof imported.default}).default;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' }); let y = 24;
  const page = () => { pdf.addPage(); y = 24; };
  const space = (height: number) => { if (y + height > 276) page(); };
  const text = (value: string, size = 10) => {
    pdf.setFontSize(size); pdf.setTextColor(30, 41, 59);
    const lines = pdf.splitTextToSize(normalizeCoworkPdfText(value), 176) as string[];
    for (const line of lines) { space(size > 12 ? 8 : 5); pdf.text(line, 17, y); y += size > 12 ? 7 : 5; } y += 3;
  };
  const heading = (value: string) => { space(22);pdf.outline?.add(null,normalizeCoworkPdfText(value),{pageNumber:pdf.getCurrentPageInfo().pageNumber}); pdf.setFont('helvetica', 'bold'); text(value, 15); pdf.setFont('helvetica', 'normal'); };
  const table = (headers: string[], body: any[][]) => {
    space(25); autoTable(pdf, { startY: y, head: [headers], body:body.map(row=>row.map(cell=>normalizeCoworkPdfText(String(cell)))), margin: { left: 17, right: 17, top: 23, bottom: 22 },
      styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' }, headStyles: { fillColor: [37, 99, 235] }, rowPageBreak: 'avoid', showHead: 'everyPage' });
    y = (pdf as any).lastAutoTable.finalY + 8;
  };
  text('ANTON.IA · EXPEDIENTE DE OPORTUNIDAD', 10); heading(report.title);
  text(`Fecha de corte: ${report.generatedAt}`); heading('Decisión ejecutiva'); text(report.executive);
  report.reasons.forEach(r => text(`• ${r}`));
  if (report.warnings.length) { heading('Datos y documentos por resolver'); report.warnings.forEach(w => text(`• ${w}`)); }
  heading('Mapa del informe'); report.sections.forEach((s, i) => text(`${i + 1}. ${s.title}`));
  for (const section of report.sections) {
    heading(section.title); section.paragraphs.forEach(p => text(p));
    section.facts.forEach(f => { text(`[${label(f.state)}] ${f.text}`); f.citations.forEach(c => { const source = report.sources.find(s => s.id === c.chunkId); text(`Fuente: ${source?.name || c.chunkId} · ${source?.locator || ''}\n«${c.quote}»`, 9); }); });
  }
  heading('Requisitos y preparación');
  table(['Requisito', 'Situación', 'Acción', 'Responsable / hito'], report.requirements.map(r => [r.title, label(r.status), r.action, `${r.role}\n${r.due}`]));
  const counts = ['supported', 'pending', 'blocked', 'unknown'].map(status => ({ status, count: report.requirements.filter(r => r.status === status).length }));
  heading('Avance de requisitos');
  for (const row of counts) { space(12); pdf.setFillColor(37, 99, 235); pdf.rect(70, y - 4, Math.max(1, 100 * row.count / Math.max(1, report.requirements.length)), 5, 'F'); pdf.text(`${label(row.status)}: ${row.count}`, 17, y); y += 10; }
  heading('Cronograma y hitos'); table(['Hito', 'Fecha', 'Evidencia'], report.milestones.map(m => [m.label, m.date, label(m.state)]));
  heading('Plan de trabajo'); table(['Tarea', 'Responsable / fecha', 'Dependencia', 'Evidencia esperada'], report.tasks.map(t => [t.title, `${t.role}\n${t.due}`, t.dependency, t.evidence]));
  heading('Escenarios económicos');
  for (const s of report.scenarios) {
    const result = opportunityFinancialScenario(s); heading(s.name); s.assumptions.forEach(a => text(`Supuesto: ${a}`));
    table(['Concepto', 'Valor calculado'], Object.entries(result).map(([k, v]) => [label(k), v === null ? 'Impuesto por confirmar' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(v)]));
  }
  heading('Riesgos y mitigaciones'); table(['Riesgo', 'Impacto / fundamento', 'Mitigación'], report.risks.map(r => [r.title, `${label(r.impact)}\n${label(r.basis)}`, r.mitigation]));
  heading('Preguntas pendientes'); report.questions.forEach(q => text(`• ${q}`));
  heading('Cobertura documental'); table(['Documento', 'Lectura', 'Páginas'], report.coverage.map(d => [d.name, label(d.status), `${d.pagesRead}/${d.pagesTotal ?? 'no aplica'}`]));
  heading('Índice de fuentes');
  report.sources.forEach(s => text(`${s.id}: ${s.name} · ${s.locator}`, 8));
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { pdf.setPage(p); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text('ANTON.IA · ' + normalizeCoworkPdfText(report.title.slice(0, 100)), 17, 12); pdf.text(`Página ${p} de ${pages}`, 17, 289); }
  return new Uint8Array(pdf.output('arraybuffer'));
}
export async function opportunityReportExcel(report: OpportunityReport) {
  const XLSX = await import('xlsx'); const book = XLSX.utils.book_new();
  const add = (name: string, rows: any[][]) => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  add('Requisitos', [['Requisito', 'Situación', 'Acción', 'Responsable sugerido', 'Hito'], ...report.requirements.map(r => [r.title, r.status, r.action, r.role, r.due])]);
  add('Plan', [['Tarea', 'Responsable', 'Hito', 'Dependencia', 'Evidencia'], ...report.tasks.map(t => [t.title, t.role, t.due, t.dependency, t.evidence])]);
  add('Riesgos', [['Riesgo', 'Impacto', 'Fundamento', 'Mitigación'], ...report.risks.map(r => [r.title, r.impact, r.basis, r.mitigation])]);
  add('Escenarios', [['Escenario', 'Costo mensual', 'Meses', 'Estructura %', 'Margen %', 'Impuesto %', 'Demora pago meses', 'Garantía %', 'Precio neto', 'Capital trabajo', 'Supuestos'], ...report.scenarios.map(s => { const r = opportunityFinancialScenario(s); return [s.name, s.monthlyCost, s.months, s.overheadPercent, s.marginPercent, s.taxPercent, s.paymentDelayMonths, s.guaranteePercent, r.totalNet, r.workingCapital, s.assumptions.join('; ')]; })]);
  add('Fuentes', [['ID de fragmento', 'Documento', 'Ubicación'], ...report.sources.map(s => [s.id, s.name, s.locator])]);
  return new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
}

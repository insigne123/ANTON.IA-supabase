import { jsPDF } from 'jspdf';
import { reportReady } from './research-state';
import { blockLines } from './report-blocks';

export const researchWarnings: Record<string, string> = {
  official_site_fetch_failed: 'No se pudo consultar el sitio oficial de la empresa.',
  hiring_signals_unavailable: 'No se encontraron señales de contratación verificables.',
  company_profile_unavailable: 'No se pudo obtener el perfil público de la empresa.',
  company_news_unavailable: 'No se obtuvieron noticias verificables de la empresa.',
  person_public_evidence_missing: 'No se encontró evidencia pública suficiente sobre la persona.',
  company_context_missing: 'Falta contexto verificable de la empresa.',
};
export function createResearchPdf(profile: { fullName: string; linkedinUrl: string; companyName: string }, research: any) {
  if (!research?.researchSnapshotId || !reportReady(research)) throw new Error('El informe comercial todavía no está disponible. Espera a que termine su preparación.');
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  doc.setProperties({ title: `Investigación comercial · ${profile.fullName || profile.companyName}`, author: 'Anton.IA', subject: 'Contexto, evidencia y fuentes para revisar antes de contactar' });
  const ink = '#172033', muted = '#526077', accent = '#4944C8';
  const left = 20, width = 170, bottom = 270;
  let y = 42;
  const chrome = () => {
    doc.setFillColor(accent); doc.rect(left, 16, 3, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(ink); doc.text('Anton.IA', left + 7, 22);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(muted); doc.text('INVESTIGACIÓN COMERCIAL', 190, 22, { align: 'right' });
    doc.setDrawColor('#E2E6EE'); doc.line(left, 30, 190, 30);
  };
  chrome();
  const room = (height: number) => { if (y + height > bottom) { doc.addPage(); chrome(); y = 42; } };
  const paragraph = (value: unknown, options: { size?: number; bold?: boolean; color?: string; url?: string } = {}) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const size = options.size || 10.5, step = size * 0.47;
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(options.color || ink);
    const lines: string[] = doc.splitTextToSize(value.trim(), width);
    for (const line of lines) {
      room(step);
      // Page chrome changes font/color; restore after any page break.
      doc.setFont('helvetica', options.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(options.color || ink);
      doc.text(line, left, y);
      if (options.url) doc.link(left, y - step + 1, Math.min(width, doc.getTextWidth(line)), step, { url: options.url });
      y += step;
    }
    y += 3;
  };
  const section = (title: string) => {
    room(25); y += 5;
    paragraph(title, { size: 13, bold: true });
    doc.setDrawColor('#E2E6EE'); doc.line(left, y - 1, 190, y - 1); y += 5;
  };
  const link = (value: unknown) => {
    if (typeof value !== 'string') return;
    try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol)) return; paragraph(value, { size: 9, color: accent, url: value }); } catch { /* Invalid source is not linked. */ }
  };
  paragraph(profile.fullName || 'Perfil de LinkedIn', { size: 24, bold: true });
  paragraph(profile.companyName, { size: 13, color: muted });
  link(profile.linkedinUrl);
  const report = research.reportDocumentV2;
  const insufficient = report.synthesis.status === 'partial';
  const status = insufficient ? 'Informe comercial parcial' : 'Informe comercial completado';
  room(32); y += 3;
  doc.setFillColor(insufficient || research.status === 'partial' ? '#FFF5E5' : '#EEF0FC');
  doc.roundedRect(left - 3, y - 5, width + 6, 13, 2, 2, 'F');
  paragraph(status, { size: 11, bold: true, color: insufficient ? '#80500D' : accent }); y += 5;
  paragraph(insufficient
    ? 'El análisis incluye aspectos pendientes de validación. Revisa las limitaciones de cada sección antes de utilizar sus conclusiones en una conversación.'
    : 'Revisa los hallazgos y sus fuentes antes de redactar. Las hipótesis se presentan por separado y no deben citarse como hechos.', { color: muted });
  const date = report.synthesis.generatedAt && new Date(report.synthesis.generatedAt);
  if (date && !Number.isNaN(date.getTime())) paragraph(`Actualizado: ${date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`, { size: 9, color: muted });
  for (const item of report.sections) {
    section(item.title);
    for (const entry of item.paragraphs) {
      if (entry.basis === 'recommendation') paragraph('RECOMENDACIÓN', { size: 8, bold: true, color: accent });
      paragraph(entry.text);
      if (entry.claimIds?.length) paragraph(`Referencias: ${entry.claimIds.join(', ')}`, { size: 8, color: muted });
    }
    for (const block of item.blocks || []) {
      if (block.type === 'committee') {
        for (const person of report.analysis?.buyingCommittee || []) {
          paragraph(`${person.name || 'Rol por identificar'} · ${person.title}`, { bold: true }); paragraph(person.rationale);
        }
      }
      if (block.type !== 'committee') {
        if (block.title) paragraph(block.title, { bold: true });
        const graphItems = Object.values(report.evidenceGraph || {}).filter(Array.isArray).flat() as any[];
        const payload = Array.isArray(block.payload) ? block.payload.map((value: unknown) => {
          if (typeof value !== 'string') return value;
          const item = graphItems.find((item: any) => item?.id === value);
          return item ? item.statement || item.content || item.howToFind || (item.title ? `${item.title} · ${item.url || item.canonicalUrl || ''}` : item.text) || value : value;
        }) : block.payload;
        for (const line of blockLines(payload)) paragraph(line);
      }
    }
  }
  const graph = report.evidenceGraph;
  if (graph?.claims?.length) {
    section('Referencias del análisis');
    for (const claim of graph.claims) {
      paragraph(`${claim.id} · ${claim.type === 'hypothesis' ? 'HIPÓTESIS' : claim.type === 'derived' ? 'ESTIMACIÓN DERIVADA' : claim.type === 'declared' ? 'DATO DECLARADO' : 'HECHO'}`, { bold: true, size: 8, color: accent });
      paragraph(claim.statement); paragraph(claim.validationQuestion);
      const urls = new Set<string>();
      for (const factId of claim.evidenceIds || []) {
        const fact = graph.facts?.find((fact: any) => fact.id === factId);
        const source = graph.sources?.find((source: any) => source.id === fact?.sourceId);
        if (source?.url) urls.add(source.url);
      }
      urls.forEach(url => link(url));
    }
  }
  if (graph?.gaps?.length) { section('Pendientes de validación'); for (const gap of graph.gaps) { paragraph(gap.unknown, { bold: true }); paragraph(gap.howToFind); } }
  if (graph?.deliverables?.length) { section('Material para la conversación'); for (const item of graph.deliverables) { paragraph(item.status === 'blocked' ? 'No utilizar todavía' : 'Revisar antes de usar', { bold: true }); paragraph(item.content); } }
  if (graph?.sources?.length) { section('Fuentes consultadas'); for (const source of graph.sources) { room(20); paragraph(source.title, { bold: true }); link(source.url); } }
  section('Continuar en Anton.IA');
  paragraph(insufficient ? 'Corrige o completa los datos de empresa y utiliza «Investigar de nuevo». El PDF no elimina los requisitos de calidad para generar correos.' : 'Vuelve al contacto guardado para revisar la investigación y preparar tu mensaje con su contexto.');
  paragraph(`Referencia: ${research.researchSnapshotId}`, { size: 8, color: muted });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor('#E2E6EE'); doc.line(left, 280, 190, 280);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(muted);
    doc.text('Anton.IA · Contexto para una conversación informada', left, 287);
    doc.text(`${page} / ${pages}`, 190, 287, { align: 'right' });
  }
  return doc;
}
export function downloadResearchPdf(profile: { fullName: string; linkedinUrl: string; companyName: string }, research: any) {
  const name = (profile.fullName || 'perfil').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80);
  createResearchPdf(profile, research).save(`AntonIA-investigacion-${name}.pdf`);
}

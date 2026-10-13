import { z } from 'zod';
import { EVIDENCE_STATES } from './workspace';

const s = (max: number) => z.string().max(max);
export const citationSchema = z.object({ chunkId: s(100), quote: s(1200) });
export const evidenceFactSchema = z.object({ text: s(3000), state: z.enum(EVIDENCE_STATES), citations: z.array(citationSchema).max(6) });
export const extractionSchema = z.object({ facts: z.array(evidenceFactSchema).max(60), missing: z.array(s(500)).max(20) });
export const reportSectionSchema = z.object({ id: s(60), title: s(200), paragraphs: z.array(s(6000)).max(12),
  facts: z.array(evidenceFactSchema).max(30) });
export const reportSchema = z.object({
  title: s(500), executive: s(6000), recommendation: z.enum(['advance', 'conditional', 'do_not_advance', 'insufficient']), reasons: z.array(s(1200)).max(12),
  sections: z.array(reportSectionSchema).min(5).max(24),
  requirements: z.array(z.object({ title: s(700), status: z.enum(['supported', 'pending', 'blocked', 'unknown']), evidence: z.array(citationSchema).max(6), action: s(1500), role: s(120), due: s(120) })).max(100),
  tasks: z.array(z.object({ title: s(500), role: s(120), due: s(120), dependency: s(500), evidence: s(1000) })).max(60),
  milestones: z.array(z.object({ label: s(300), date: s(120), state: z.enum(['documented', 'proposed', 'unknown']), citations: z.array(citationSchema).max(4) })).max(30),
  risks: z.array(z.object({ title: s(500), impact: z.enum(['high', 'medium', 'low']), basis: z.enum(['documented', 'proposed', 'unknown']), mitigation: s(2000), citations: z.array(citationSchema).max(6) })).max(30),
  scenarios: z.array(z.object({ name: s(200), monthlyCost: z.number().nonnegative(), months: z.number().int().min(1).max(240), overheadPercent: z.number().min(0).max(90),
    marginPercent: z.number().min(0).max(90), taxPercent: z.number().min(0).max(100).nullable(), paymentDelayMonths: z.number().min(0).max(24), guaranteePercent: z.number().min(0).max(100), assumptions: z.array(s(1000)).max(20) })).max(6),
  questions: z.array(s(2000)).max(30), warnings: z.array(s(1000)).max(30),
});
export type OpportunityReport = z.infer<typeof reportSchema> & { generatedAt: string; coverage: Array<{ id: string; name: string; status: string; pagesRead: number; pagesTotal: number | null }>;
  sources: Array<{ id: string; documentId: string; locator: string; name: string }> };
export const answerSchema = z.object({ answer: s(12_000), citations: z.array(citationSchema).max(12), missing: z.array(s(500)).max(8) });
export type DocumentChunk = { id: string; document_id: string; locator: string; content: string; ordinal: number };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');

export function validOpportunityCitation(citation: z.infer<typeof citationSchema>, chunks: DocumentChunk[]) {
  const source = chunks.find(chunk => chunk.id === citation.chunkId);
  return Boolean(source && citation.quote.trim().length >= 8 && normalize(source.content).includes(normalize(citation.quote)));
}
export function validateOpportunityFacts(facts: z.infer<typeof evidenceFactSchema>[], chunks: DocumentChunk[]) {
  return facts.map(fact => {
    const citations = fact.citations.filter(citation => validOpportunityCitation(citation, chunks));
    return { ...fact, citations, state: fact.state === 'documented' && !citations.length ? 'unknown' as const : fact.state };
  });
}
/** Final means enough source coverage, never merely that the model returned valid JSON. */
export function opportunityReportCoverage(documents: Array<{ extraction_status: string }>) {
  return documents.length > 0 && documents.every(doc => doc.extraction_status === 'read') ? 'complete' : 'partial';
}
export const REPORT_VERSION = 'opportunity-expedient/1';
export const REPORT_OUTLINE = [
  'Decisión ejecutiva y condiciones para avanzar', 'Contexto del cliente y encaje con la empresa del workspace',
  'Alcance, prestaciones y requisitos documentados', 'Elegibilidad, evidencia disponible y brechas',
  'Criterios de evaluación y estrategia de participación', 'Condiciones contractuales, garantías, pagos y multas',
  'Solución propuesta, recursos, gobierno, metodología y continuidad', 'Hoja de ruta de postulación y ejecución',
  'Escenarios económicos, impuestos por confirmar, margen y capital de trabajo', 'Riesgos, mitigaciones y decisiones pendientes',
  'Preguntas para la contraparte y documentos por preparar', 'Fuentes, cobertura y supuestos',
];

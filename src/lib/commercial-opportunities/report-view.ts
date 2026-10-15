// How a report is shown and exported: the decision first, then what to do. Pure, shared by the page, the PDF and Markdown.
import { isSignalKind, type OpportunityReport } from './expedient';

export const DECISION: Record<OpportunityReport['recommendation'], { label: string; tone: 'go' | 'evaluate' | 'no' | 'pending' }> = {
  advance: { label: 'Postular', tone: 'go' },
  conditional: { label: 'Postular si se resuelve lo pendiente', tone: 'evaluate' },
  do_not_advance: { label: 'No postular', tone: 'no' },
  insufficient: { label: 'Falta información para decidir', tone: 'pending' },
};
/** A LinkedIn signal is a conversation to start, not an offer to submit. */
export const SIGNAL_DECISION: typeof DECISION = {
  advance: { label: 'Contactar ahora', tone: 'go' },
  conditional: { label: 'Contactar, validando primero lo pendiente', tone: 'evaluate' },
  do_not_advance: { label: 'No contactar por ahora', tone: 'no' },
  insufficient: { label: 'Falta información para decidir', tone: 'pending' },
};
export const reportDecision = (report: Pick<OpportunityReport, 'recommendation' | 'kind'>) =>
  (isSignalKind(report.kind) ? SIGNAL_DECISION : DECISION)[report.recommendation] ?? DECISION.insufficient;

export const STATUS_LABELS: Record<string, string> = {
  supported: 'Exigido en las bases', pending: 'Por preparar', blocked: 'Bloquea la postulación', unknown: 'Por confirmar',
  documented: 'Según los documentos', calculated: 'Calculado', proposed: 'Sugerido', read: 'Leído completo', partial: 'Leído en parte',
  scan: 'Escaneado, sin texto', damaged: 'No se pudo leer', unavailable: 'No disponible', pending_read: 'Leyendo',
};
export const IMPACT_LABELS: Record<string, string> = { high: 'Impacto alto', medium: 'Impacto medio', low: 'Impacto bajo' };
export const statusLabel = (value: string) => STATUS_LABELS[value] ?? value;

const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «15 de octubre de 2026» (and «, 15:00» with the time), in Chile's time zone. */
export function humanDate(value: string | null | undefined, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(value)).map(p => [p.type, p.value]));
  const date = `${Number(parts.day)} de ${months[Number(parts.month) - 1]} de ${parts.year}`;
  return withTime ? `${date}, ${parts.hour}:${parts.minute}` : date;
}

/** The three things to do now: the report's own, or the first of its plan for reports made before they existed. */
export function reportNextSteps(report: Pick<OpportunityReport, 'nextSteps' | 'tasks' | 'requirements'>) {
  if (report.nextSteps?.length) return report.nextSteps.slice(0, 3);
  const fromPlan = report.tasks.map(t => t.due ? `${t.title} (${t.due})` : t.title);
  return (fromPlan.length ? fromPlan : report.requirements.map(r => r.action)).filter(Boolean).slice(0, 3);
}

const QUESTIONS = /consulta|pregunta|aclaraci/i;
/** The dates that decide the work: until when to ask and when offers close («Cierre de consultas» is not the closing). */
export function reportKeyDates(report: Pick<OpportunityReport, 'milestones'>, deadline?: string | null) {
  const find = (pattern: RegExp, unless?: RegExp) => report.milestones.find(m => pattern.test(m.label) && !unless?.test(m.label))?.date ?? null;
  return {
    questions: find(QUESTIONS, /respuesta/i),
    closes: humanDate(deadline, true) ?? find(/cierre|recepci[oó]n de ofertas|presentaci[oó]n de (la )?oferta/i, QUESTIONS),
  };
}

/** The pending questions as an e-mail the person can paste and send to the buyer before the questions deadline. */
export function consultationEmail(report: Pick<OpportunityReport, 'questions' | 'title' | 'milestones'>, opportunity: { title: string; buyer?: string | null }) {
  const until = reportKeyDates(report).questions;
  return [
    `Asunto: Consultas · ${opportunity.title}`,
    '',
    `Estimados${opportunity.buyer ? ` de ${opportunity.buyer}` : ''}:`,
    '',
    `Junto con saludar, y dentro del plazo de consultas${until ? ` (${until})` : ''}, solicitamos aclarar los siguientes puntos:`,
    '',
    ...report.questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Quedamos atentos a sus respuestas.',
    '',
    'Saludos cordiales,',
  ].join('\n');
}

const INTERNAL = [/tarifa confirmada/i, /investigaci[oó]n web del cliente/i, /recalcular con c[oó]digo/i, /f[oó]rmula param[eé]trica/i, /inventario completo de (las )?bases/i];
/**
 * What the person must know or get before deciding: missing bases first, documents read only in part, then the rest.
 * System notes (a connector without a confirmed rate, internal formulas) are not for them.
 */
export function opportunityReportWarnings(warnings: string[], documents: Array<{ name: string; extraction_status: string }>, basesMissing: boolean) {
  const reading = documents.filter(d => d.extraction_status !== 'read').map(d =>
    d.extraction_status === 'scan' ? `«${d.name}» es una imagen escaneada: súbelo como PDF con texto o Word para leerlo.`
      : d.extraction_status === 'partial' ? `«${d.name}» se leyó solo en parte.`
        : `«${d.name}» no se pudo leer: vuelve a subirlo como PDF o Word.`);
  const bases = basesMissing ? ['Faltan las bases y anexos de Mercado Público: descárgalos desde «Ver anexos» y súbelos en Documentos para un informe completo.'] : [];
  const rest = warnings.filter(w => !INTERNAL.some(pattern => pattern.test(w))).map(w => w.replace(/\bnull\b/gi, 'sin dato'));
  return [...new Set([...bases, ...reading, ...rest])].slice(0, 6);
}
export const isSignalReport = (report: Pick<OpportunityReport, 'kind'>) => isSignalKind(report.kind);

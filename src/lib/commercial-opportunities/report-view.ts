// How a report is shown and exported: the decision first, then what to do. Pure, shared by the page, the PDF and Markdown.
import { isSignalKind, type OpportunityReport } from './expedient';
import { milestoneDate } from './report-marks';

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
  scan: 'Escaneado, sin leer', damaged: 'No se pudo leer', unavailable: 'No disponible', pending_read: 'Leyendo',
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
  const find = (pattern: RegExp, unless?: RegExp) => milestoneDate(report.milestones.find(m => pattern.test(m.label) && !unless?.test(m.label))?.date);
  return {
    questions: find(QUESTIONS, /respuesta/i),
    closes: humanDate(deadline, true) ?? find(/cierre|recepci[oó]n de ofertas|presentaci[oó]n de (la )?oferta/i, QUESTIONS),
  };
}

/** The pending questions as an e-mail the person can paste and send to the buyer before the questions deadline. */
/**
 * Everything to ask the buyer, once: the questions of the report plus the contradictions found in the bases («Para preguntar en el foro» of
 * «Cómo postular»), so the report, the email, the download and the guide never disagree about what is still unanswered. A question that
 * says the same thing as another with other words is not repeated.
 */
export function buyerQuestions(report: Pick<OpportunityReport, 'questions'> & { submission?: { inconsistencies?: Array<{ question: string }> } | null }): string[] {
  const words = (text: string) => new Set(text.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(word => word.length > 3));
  const alike = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return false; const shared = [...a].filter(word => b.has(word)).length; return shared / Math.min(a.size, b.size) >= 0.8 && shared / Math.max(a.size, b.size) >= 0.6; };
  const kept: Array<{ text: string; words: Set<string> }> = [];
  for (const raw of [...(report.questions || []), ...(report.submission?.inconsistencies || []).map(item => item.question)]) {
    const text = raw.replace(/\s+/g, ' ').trim();
    const own = words(text);
    if (!text || kept.some(item => item.text.toLocaleLowerCase('es') === text.toLocaleLowerCase('es') || alike(item.words, own))) continue;
    kept.push({ text, words: own });
  }
  return kept.map(item => item.text);
}

export function consultationEmail(report: Pick<OpportunityReport, 'questions' | 'title' | 'milestones'> & { submission?: { inconsistencies?: Array<{ question: string }> } | null }, opportunity: { title: string; buyer?: string | null }) {
  const until = reportKeyDates(report).questions;
  return [
    `Asunto: Consultas · ${opportunity.title}`,
    '',
    `Estimados${opportunity.buyer ? ` de ${opportunity.buyer}` : ''}:`,
    '',
    `Junto con saludar, y dentro del plazo de consultas${until ? ` (${until})` : ''}, solicitamos aclarar los siguientes puntos:`,
    '',
    ...buyerQuestions(report).map((q, i) => `${i + 1}. ${q}`),
    '',
    'Quedamos atentos a sus respuestas.',
    '',
    'Saludos cordiales,',
  ].join('\n');
}

const INTERNAL = [/tarifa confirmada/i, /investigaci[oó]n web del cliente/i, /recalcular con c[oó]digo/i, /f[oó]rmula param[eé]trica/i, /inventario completo de (las )?bases/i,
  /identificar al cliente para la investigaci[oó]n/i];
/** A short system note the report already says in its own words. */
const SUBSUMED: Array<[RegExp, RegExp]> = [[/^una fuente p[uú]blica no pudo leerse\.?$/i, /fuente p[uú]blica/i]];
/**
 * What the person must know or get before deciding: missing bases first, documents read only in part, then the rest.
 * System notes (a connector without a confirmed rate, internal formulas) are not for them.
 */
export function opportunityReportWarnings(warnings: string[], documents: Array<{ name: string; extraction_status: string }>, basesMissing: boolean) {
  const reading = documents.filter(d => d.extraction_status !== 'read').map(d =>
    d.extraction_status === 'scan' ? `«${d.name}» es una imagen o un escaneo que la IA no alcanzó a leer: súbelo como PDF con texto o Word, o en partes de hasta 25 páginas.`
      : d.extraction_status === 'partial' ? `«${d.name}» se leyó solo en parte.`
        : `«${d.name}» no se pudo leer: vuelve a subirlo como PDF o Word.`);
  const bases = basesMissing ? ['Faltan las bases y anexos de Mercado Público: descárgalos desde «Ver anexos» y súbelos en Documentos para un informe completo.'] : [];
  const rest = warnings.filter(w => !INTERNAL.some(pattern => pattern.test(w)))
    .filter(w => !SUBSUMED.some(([note, said]) => note.test(w.trim()) && warnings.some(other => other !== w && said.test(other))))
    .map(w => w.replace(/\bnull\b/gi, 'sin dato'));
  return [...new Set([...bases, ...reading, ...rest])].slice(0, 6);
}
export const isSignalReport = (report: Pick<OpportunityReport, 'kind'>) => isSignalKind(report.kind);

const JOB_ERRORS: Array<[RegExp, string]> = [
  [/no termin[oó]|consumo observado|no pudo terminar|pendiente de conciliaci[oó]n|retom[oó] en otro proceso|formato requerido/i, 'Tardó más de lo esperado. Vuelve a intentarlo: suele resolverse al segundo intento.'],
  // Jobs refused before 24 Oct 2026 did not say which cap they reached (one report, its kind of work or the month). Most of those
  // were reports written by Sonnet, which cost several times more: a new try says which cap, if one is still reached.
  [/presupuesto disponible para este trabajo|supera el presupuesto del trabajo|presupuesto de b[uú]squeda de este mes/i,
    'Se alcanzó un tope de gasto de Oportunidades. Vuelve a intentarlo: los informes ahora cuestan menos y, si un tope sigue alcanzado, te diremos cuál y cuándo se renueva.'],
  [/documentos nuevos|oferta cambi[oó]|criterios cambiaron/i, 'El expediente cambió mientras se preparaba. Vuelve a generarlo para incluir lo nuevo.'],
  [/proveedor de IA|precio verificable/i, 'La IA no está disponible en este momento. Inténtalo más tarde.'],
];
/** What a failed report or answer tells the person: what happened and what to do, never internal accounting. */
export function friendlyJobError(error: string | null | undefined) {
  if (!error) return 'Intenta de nuevo en un momento.';
  return JOB_ERRORS.find(([pattern]) => pattern.test(error))?.[1] ?? error;
}

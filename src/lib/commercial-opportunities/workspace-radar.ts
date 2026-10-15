// What the workspace list adds from the person's own tender radar (13 oct 2026): what to do with each opportunity, where
// to start, why the excluded ones were left out, and what almost every set of bases asks for. Pure: the page renders it.
import type { WorkItem } from './workspace';

/** Why the evaluation left an opportunity out. Asked of the model next to «excluded»; older rows have none. */
export const EXCLUSION_MOTIVES = ['otro_producto', 'parte_menor', 'requisito', 'escala', 'sin_compra'] as const;
export type ExclusionMotive = typeof EXCLUSION_MOTIVES[number];
export const EXCLUSION_MOTIVE_LABELS: Record<ExclusionMotive | 'otros', string> = {
  otro_producto: 'Piden otra cosa',
  parte_menor: 'Lo que ofreces es una parte menor',
  requisito: 'Exigen algo que no ofreces',
  escala: 'Volumen o plazo fuera de proporción',
  sin_compra: 'No muestra una compra',
  otros: 'Otros motivos',
};

const DAY = 86_400_000;
/** Closing within this many days reads as urgent. */
export const URGENT_DAYS = 3;

export type WorkAdvice = { label: 'Postular' | 'Evaluar' | 'No postular' | 'Por evaluar'; tone: 'go' | 'evaluate' | 'no' | 'pending';
  daysLeft: number | null; urgent: boolean; closed: boolean };

const evaluationOf = (item: Pick<WorkItem, 'kind' | 'data'>) => {
  const value = item.data?.evaluation;
  return value === 'recommended' || value === 'review' || value === 'excluded' ? value : item.kind === 'private' ? 'review' : 'pending';
};
/** Whole days left until the deadline (0 = closes today), or null without one. */
export function daysLeft(deadline: string | null | undefined, now: number) {
  if (!deadline || !Number.isFinite(Date.parse(deadline))) return null;
  return Math.floor((Date.parse(deadline) - now) / DAY);
}

/**
 * What to do with an opportunity, from its evaluation: recommended → «Postular», review → «Evaluar», excluded → «No postular»,
 * not evaluated yet → «Por evaluar». A deadline within three days is urgent; a past one is closed.
 */
export function workAdvice(item: Pick<WorkItem, 'kind' | 'data' | 'deadline_at'>, now = Date.now()): WorkAdvice {
  const evaluation = evaluationOf(item);
  const left = daysLeft(item.deadline_at, now);
  const closed = Boolean(item.deadline_at && Date.parse(item.deadline_at) < now);
  const base = evaluation === 'recommended' ? { label: 'Postular' as const, tone: 'go' as const }
    : evaluation === 'review' ? { label: 'Evaluar' as const, tone: 'evaluate' as const }
      : evaluation === 'excluded' ? { label: 'No postular' as const, tone: 'no' as const } : { label: 'Por evaluar' as const, tone: 'pending' as const };
  return { ...base, daysLeft: left, closed, urgent: !closed && left !== null && left < URGENT_DAYS && evaluation !== 'excluded' };
}

/** «cierra hoy», «cierra mañana», «cierra en 5 días» or «cerrada». */
export function closesLabel(advice: Pick<WorkAdvice, 'daysLeft' | 'closed'>) {
  if (advice.closed) return 'cerrada';
  if (advice.daysLeft === null) return null;
  return advice.daysLeft <= 0 ? 'cierra hoy' : advice.daysLeft === 1 ? 'cierra mañana' : `cierra en ${advice.daysLeft} días`;
}

/**
 * «Por dónde empezar»: the recommended ones with time to prepare an offer (at least a day left), nearest deadline first.
 * Without enough of them, the ones to evaluate follow. Opportunities without a deadline (posts, hiring) are not here.
 */
export function startHere<T extends Pick<WorkItem, 'id' | 'kind' | 'data' | 'deadline_at' | 'score'>>(items: T[], now = Date.now(), limit = 5): T[] {
  const open = items.filter(item => { const left = daysLeft(item.deadline_at, now); return left !== null && left >= 1; });
  const byDeadline = (a: T, b: T) => Date.parse(a.deadline_at!) - Date.parse(b.deadline_at!) || b.score - a.score;
  const recommended = open.filter(item => evaluationOf(item) === 'recommended').sort(byDeadline);
  const review = open.filter(item => evaluationOf(item) === 'review').sort(byDeadline);
  return [...recommended, ...review].slice(0, limit);
}

/** The excluded opportunities grouped by why, the largest group first and the ones without a motive last. */
export function exclusionGroups<T extends Pick<WorkItem, 'data'>>(items: T[]) {
  const groups = new Map<ExclusionMotive | 'otros', T[]>();
  for (const item of items) {
    const motive = item.data?.excludedMotive;
    const key = typeof motive === 'string' && (EXCLUSION_MOTIVES as readonly string[]).includes(motive) ? motive as ExclusionMotive : 'otros';
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => (a === 'otros' ? 1 : 0) - (b === 'otros' ? 1 : 0) || y.length - x.length)
    .map(([motive, list]) => ({ motive, label: EXCLUSION_MOTIVE_LABELS[motive], items: list }));
}

/**
 * «Antes de postular»: what almost every set of public bases in Chile asks for, worth solving once. General guidance, not
 * legal advice: each set of bases decides, and the page says so.
 */
export const TENDER_PREREQUISITES: Array<{ title: string; items: string[] }> = [
  { title: 'Registro y cuenta', items: [
    'Usuario proveedor en Mercado Público a nombre de la empresa, con el representante legal habilitado para ofertar.',
    'Inscripción hábil en el Registro de Proveedores: se revisa al adjudicar y al firmar el contrato.',
    'En cada oferta se firma en línea la Declaración Jurada de Requisitos para Ofertar.',
    'Firma electrónica avanzada del representante: agiliza declaraciones, contratos y garantías.',
  ] },
  { title: 'Puntos fáciles de ganar', items: [
    'Programa de integridad: código de ética, canal de denuncias y capacitación, declarados en el anexo.',
    'Requisitos formales: todos los anexos firmados y en el formato pedido.',
    'Plazo de implementación: ofrece el mínimo realista; en varias bases pesa bastante.',
  ] },
  { title: 'Experiencia acreditable', items: [
    'Órdenes de compra públicas con recepción conforme, o certificados de clientes con monto, plazo y alcance.',
    'CV del equipo y casos con resultados medibles.',
    'Contratos chicos (Compra Ágil, cursos) crean historial para las licitaciones grandes.',
  ] },
  { title: 'Garantías y respaldo', items: [
    'Fiel cumplimiento: un porcentaje del contrato que fijan las bases, con boleta o póliza, también electrónica.',
    'Seriedad de la oferta en algunas: se entrega antes del cierre.',
    'Para las grandes, una Unión Temporal de Proveedores con un socio que tenga historial en el Estado.',
  ] },
];

/** LinkedIn signals (job ads grouped by company, posts) have no deadline; everything else is a purchase with one or not. */
export const LINKEDIN_KINDS = ['hiring', 'linkedin_post'] as const;
export const isLinkedIn = (kind: string) => (LINKEDIN_KINDS as readonly string[]).includes(kind);

/**
 * By deadline: the open ones first, the nearest closing first; then the ones without a deadline, best match first; the
 * closed ones last, the most recently closed first.
 */
export function byClosing<T extends Pick<WorkItem, 'deadline_at' | 'score' | 'updated_at'>>(items: T[], now = Date.now()): T[] {
  const at = (item: T) => (item.deadline_at && Number.isFinite(Date.parse(item.deadline_at)) ? Date.parse(item.deadline_at) : null);
  const rank = (item: T) => { const deadline = at(item); return deadline === null ? 1 : deadline >= now ? 0 : 2; };
  return [...items].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? at(a)! - at(b)! : rank(a) === 2 ? at(b)! - at(a)! : 0)
    || b.score - a.score || Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export type SourceGroup<T> = { key: 'tenders' | 'linkedin'; label: string; note: string; items: T[] };
/** Each view split in «Licitaciones» (public, Compra Ágil, received, projects) and «LinkedIn», each by closing. Empty groups are left out. */
export function bySource<T extends Pick<WorkItem, 'kind' | 'deadline_at' | 'score' | 'updated_at'>>(items: T[], now = Date.now()): SourceGroup<T>[] {
  const groups: SourceGroup<T>[] = [
    { key: 'tenders', label: 'Licitaciones', note: 'Por fecha de cierre, la más próxima primero.', items: byClosing(items.filter(item => !isLinkedIn(item.kind)), now) },
    { key: 'linkedin', label: 'LinkedIn', note: 'Avisos de trabajo y publicaciones. No tienen cierre: las más afines primero.', items: byClosing(items.filter(item => isLinkedIn(item.kind)), now) },
  ];
  return groups.filter(group => group.items.length > 0);
}

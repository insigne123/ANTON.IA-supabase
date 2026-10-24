// The list of «Oportunidades» by the same stages as the pipeline (pipeline.ts), so «Por revisar» means one thing on both: what nobody
// works yet and the AI left to review. What the server asks the database for (opportunity_workspace_page) and what the page keeps of
// it while a new reading arrives come from here. Pure: the page, the API and the tests share it.
import { z } from 'zod';
import type { WorkItem, WorkRecord } from './workspace';

type WorkState = WorkRecord['state'];
/** The stage of the database: «open» while nobody works it (no work record, or one left unassigned), otherwise its work state. */
export type ListStage = 'open' | Exclude<WorkState, 'unassigned'>;
export type ListQuery = { stages: ListStage[]; evaluations: string[]; biddable: boolean };

/** The administrator's filters, in the order of the pipeline; «No recomendadas» and «Todas» last. */
export const ADMIN_LIST_VIEWS = [
  { id: 'recommended', label: 'Recomendadas', hint: 'Calzan con tu oferta y aún no tienen equipo.' },
  { id: 'review', label: 'Por revisar', hint: 'Nadie las trabaja todavía: falta decidir si se trabajan.' },
  { id: 'assigned', label: 'Asignadas', hint: 'Tienen equipo; todavía nadie empezó.' },
  { id: 'working', label: 'En preparación', hint: 'El equipo las está preparando, o están bloqueadas.' },
  { id: 'submitted', label: 'Presentadas', hint: 'Se presentaron; se espera respuesta.' },
  { id: 'closed', label: 'Cerradas', hint: 'Ganadas, perdidas o archivadas (también las descartadas).' },
  { id: 'excluded', label: 'No recomendadas', hint: 'La IA las dejó fuera porque no calzan con tu oferta.' },
  { id: 'all', label: 'Todas', hint: 'Todas, también las que ya cerraron sin que nadie las trabajara.' },
] as const;
export type AdminListView = typeof ADMIN_LIST_VIEWS[number]['id'];
/** The views the server answers: the administrator's, the stages a member filters by, and «pending» of the older links. */
export const LIST_VIEWS = ['all', 'recommended', 'review', 'pending', 'excluded', 'assigned', 'working', 'blocked', 'submitted', 'won', 'lost', 'archived', 'closed'] as const;
export type ListView = typeof LIST_VIEWS[number];

const OPEN = (evaluations: string[]): ListQuery => ({ stages: ['open'], evaluations, biddable: true });
const STAGES = (...stages: ListStage[]): ListQuery => ({ stages, evaluations: [], biddable: false });
const EVERYTHING: ListQuery = { stages: [], evaluations: [], biddable: false };

/**
 * What a view asks the database for. An administrator's evaluations are of what nobody works yet and can still be bid; the stages
 * are of the work, whatever the deadline. A member reads only what was assigned to them: «Mi trabajo» (all, or recommended in the older
 * links) is everything of theirs, and each stage is that stage.
 */
export function listViewQuery(view: string, admin: boolean): ListQuery {
  if (!admin) {
    if (view === 'all' || view === 'recommended' || !(LIST_VIEWS as readonly string[]).includes(view)) return EVERYTHING;
    if (view === 'closed') return STAGES('won', 'lost', 'archived');
    return ['pending', 'review', 'excluded'].includes(view) ? EVERYTHING : STAGES(view as ListStage);
  }
  switch (view) {
    case 'recommended': return OPEN(['recommended']);
    case 'review': return OPEN(['review', 'pending']);
    case 'pending': return OPEN(['pending']);
    case 'excluded': return OPEN(['excluded']);
    case 'assigned': return STAGES('assigned');
    case 'working': return STAGES('working', 'blocked');
    case 'closed': return STAGES('won', 'lost', 'archived');
    case 'blocked': case 'submitted': case 'won': case 'lost': case 'archived': return STAGES(view);
    default: return EVERYTHING;
  }
}

/** The AI's evaluation as the database reads it: a received one without one is to review; any other without one, none. */
export const evaluationOf = (item: Pick<WorkItem, 'kind' | 'data'>) => (item.data?.evaluation as string | undefined) ?? (item.kind === 'private' ? 'review' : null);
/** The stage as the database reads it. */
export const listStageOf = (state: WorkState | null | undefined): ListStage => (!state || state === 'unassigned' ? 'open' : state);

/** Whether an opportunity belongs to the view, as opportunity_workspace_page decides it (the page keeps it while the next reading arrives). */
export function inListView(view: string, admin: boolean, item: Pick<WorkItem, 'kind' | 'data' | 'deadline_at'>, state: WorkState | null | undefined, now = Date.now()) {
  const query = listViewQuery(view, admin);
  const stage = listStageOf(state);
  if (query.stages.length && !query.stages.includes(stage)) return false;
  if (query.evaluations.length && !query.evaluations.includes(String(evaluationOf(item)))) return false;
  if (query.biddable && stage === 'open' && item.deadline_at && Date.parse(item.deadline_at) <= now) return false;
  return true;
}

/** How many there are in each of the administrator's views, from the counts of the database (biddable, like the views). */
export function adminViewCounts(groups: Array<{ stage: string; evaluation: string | null; total: number }>): Partial<Record<AdminListView, number>> {
  const sum = (match: (group: { stage: string; evaluation: string | null }) => boolean) => groups.filter(match).reduce((total, group) => total + Number(group.total || 0), 0);
  const open = (...evaluations: string[]) => sum(group => group.stage === 'open' && evaluations.includes(String(group.evaluation)));
  const stage = (...stages: string[]) => sum(group => stages.includes(group.stage));
  return { recommended: open('recommended'), review: open('review', 'pending'), excluded: open('excluded'), assigned: stage('assigned'),
    working: stage('working', 'blocked'), submitted: stage('submitted'), closed: stage('won', 'lost', 'archived') };
}

/** How many a member has in each of their filters (member-work.ts): «Mi trabajo» is what is not finished, «Presentadas y cerradas» the rest. */
export function memberViewCounts(groups: Array<{ stage: string; total: number }>): Record<string, number> {
  const stage = (...stages: string[]) => groups.filter(group => stages.includes(group.stage)).reduce((total, group) => total + Number(group.total || 0), 0);
  return { all: stage('assigned', 'working', 'blocked'), assigned: stage('assigned'), working: stage('working'), blocked: stage('blocked'), done: stage('submitted', 'won', 'lost', 'archived') };
}

/** «No es para nosotros»: why the team puts an opportunity aside, in a word the next evaluations can read. */
export const DISCARD_REASONS = [
  { id: 'rubro', label: 'No es nuestro rubro' },
  { id: 'zona', label: 'Fuera de nuestra zona' },
  { id: 'escala', label: 'Muy grande o muy chica' },
  { id: 'requisitos', label: 'Piden algo que no tenemos' },
  { id: 'monto', label: 'El monto no conviene' },
  { id: 'plazo', label: 'No alcanzamos a prepararla' },
  { id: 'ya_participamos', label: 'Ya participamos por otra vía' },
  { id: 'otro', label: 'Otro motivo' },
] as const;
export type DiscardReason = typeof DISCARD_REASONS[number]['id'];
export const discardReasonSchema = z.enum(DISCARD_REASONS.map(reason => reason.id) as [DiscardReason, ...DiscardReason[]]);
/** «Otro motivo» says which in a line; the others may add one. */
export const discardSchema = z.object({ reason: discardReasonSchema, note: z.string().trim().max(300).default('') }).strict()
  .refine(value => value.reason !== 'otro' || value.note.length >= 3, { message: 'Cuenta en una línea por qué no es para ustedes.', path: ['note'] });
export const discardLabel = (reason: string) => DISCARD_REASONS.find(item => item.id === reason)?.label ?? 'Otro motivo';
/** The line of the activity: «No es para nosotros: fuera de nuestra zona. Solo trabajamos en la RM.» */
export function discardBody(reason: string, note = '') {
  const line = note.replace(/\s+/g, ' ').trim();
  const label = discardLabel(reason);
  return reason === 'otro' && line ? `No es para nosotros: ${line}` : `No es para nosotros: ${label.charAt(0).toLowerCase()}${label.slice(1)}${line ? `. ${line}` : ''}`;
}

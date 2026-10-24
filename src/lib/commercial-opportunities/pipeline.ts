// The admin's pipeline: where each opportunity stands, drawn as a route of stages, and the rules that move it on their own
// when the work shows it moved. Pure: the page, the API and the tests share it.
import { dayInZone, shiftDay } from '@/lib/admin/chile-time';
import type { WorkItem, WorkRecord } from './workspace';

/** One of «Cierran esta semana» over the road (server/commercial-opportunities/workspace-pipeline.ts). */
export type PipelineWeekItem = { id: string; title: string; deadlineAt: string; stage: 'recommended' | 'assigned' | 'working' | 'blocked' };
const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** «Hoy», «Mañana», «Vie 30»: the day it closes, in Chile, short enough for a chip. */
export function weekDay(at: string, now: Date) {
  const day = dayInZone(new Date(at)), today = dayInZone(now);
  if (day === today) return 'Hoy';
  if (day === shiftDay(today, 1)) return 'Mañana';
  const [year, month, date] = day.split('-').map(Number);
  const name = SHORT_DAYS[new Date(Date.UTC(year, month - 1, date, 12)).getUTCDay()];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${date}`;
}

export const WORK_STATE_LABELS: Record<WorkRecord['state'], string> = { unassigned: 'Sin asignar', assigned: 'Asignada', working: 'En preparación', blocked: 'Bloqueada',
  submitted: 'Presentada', won: 'Ganada', lost: 'Perdida', archived: 'Archivada' };

export const PIPELINE_STAGES = [
  { id: 'found', label: 'Por revisar', hint: 'La IA las encontró o las cargaste; falta decidir si se trabajan.' },
  { id: 'recommended', label: 'Recomendadas', hint: 'Calzan con tu oferta y aún no tienen equipo.' },
  { id: 'assigned', label: 'Asignadas', hint: 'Tienen equipo; todavía nadie empezó.' },
  { id: 'working', label: 'En preparación', hint: 'El equipo trabaja el informe, los documentos y la oferta.' },
  { id: 'submitted', label: 'Presentadas', hint: 'La oferta o el primer contacto ya salió; se espera respuesta.' },
  { id: 'won', label: 'Ganadas', hint: 'Adjudicadas o convertidas en cliente.' },
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number]['id'] | 'lost' | 'archived' | 'excluded';

/** The stage of an opportunity, from its work state and, before anyone works it, from the AI's evaluation. */
export function pipelineStage(item: Pick<WorkItem, 'kind' | 'data'>, work?: Pick<WorkRecord, 'state'> | null): PipelineStage {
  const state = work?.state ?? 'unassigned';
  if (state === 'won' || state === 'lost' || state === 'archived' || state === 'submitted' || state === 'assigned') return state;
  if (state === 'working' || state === 'blocked') return 'working';
  const evaluation = item.data?.evaluation;
  if (evaluation === 'excluded') return 'excluded';
  return evaluation === 'recommended' ? 'recommended' : 'found';
}

/** Days until the opportunity closes (negative once closed), or null without a deadline. */
export function daysToClose(deadline: string | null | undefined, now = Date.now()) {
  if (!deadline || !Number.isFinite(Date.parse(deadline))) return null;
  return Math.ceil((Date.parse(deadline) - now) / 86_400_000);
}

/**
 * What the work says about the stage, as a move the server applies by itself: a report ready or the first item ticked
 * moves an assigned opportunity into preparation; ticking the step to submit moves it to «Presentada». Never backwards,
 * never out of a closed stage, and never without a reason the team can read in the activity. The one way back is for a tick
 * that was a mistake (automaticUndo).
 */
export type WorkEvent = { kind: 'report_ready' } | { kind: 'marked_done'; routeKind?: string | null; label: string } | { kind: 'task_started' };
const isSubmitStep = (event: { routeKind?: string | null; label: string }) =>
  event.routeKind === 'submit' || /^(presentar|subir|enviar|ingresar) (la )?(oferta|postulaci|propuesta)/i.test(event.label.trim());
export function automaticMove(state: WorkRecord['state'] | null | undefined, event: WorkEvent): { to: WorkRecord['state']; reason: string } | null {
  const current = state ?? 'unassigned';
  if (['submitted', 'won', 'lost', 'archived', 'unassigned'].includes(current)) return null;
  if (event.kind === 'marked_done' && isSubmitStep(event))
    return { to: 'submitted', reason: `se marcó «${event.label.slice(0, 120)}»` };
  if (current !== 'assigned') return null;
  if (event.kind === 'report_ready') return { to: 'working', reason: 'el informe quedó listo' };
  if (event.kind === 'marked_done') return { to: 'working', reason: `se marcó «${event.label.slice(0, 120)}»` };
  return { to: 'working', reason: 'empezó una tarea' };
}

/**
 * Taking back the tick of the step to submit, when it was that tick that moved the opportunity to «Presentada»: it goes back to
 * preparation. A stage a person set (or any other stage) is left alone, and so is a tick that did not move anything.
 */
export function automaticUndo(state: WorkRecord['state'] | null | undefined, event: { routeKind?: string | null; label: string }, last: { kind: string; to?: string | null } | null): { to: WorkRecord['state']; reason: string } | null {
  if (state !== 'submitted' || !isSubmitStep(event)) return null;
  if (last?.kind !== 'auto_state' || last.to !== 'submitted') return null;
  return { to: 'working', reason: `se desmarcó «${event.label.slice(0, 120)}»` };
}

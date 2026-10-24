// The tasks of an opportunity (OPP-27): the day each one is due on Chile's calendar and which are late, the order of the list, the plan
// of the report turned into tasks with an owner and a day already proposed (OPP-21), and «Mis tareas» across opportunities.
// A task is due on a day, not at an hour: the page picks a day and it is kept at noon in Chile, so it reads as that day anywhere.
// Pure: the page, the API and the tests share it.
import { z } from 'zod';
import { chileTime, parseReportDate } from './report-marks';

export const TASK_STATUSES = ['pending', 'working', 'done', 'blocked'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { pending: 'Pendiente', working: 'En curso', done: 'Hecha', blocked: 'Bloqueada' };
export type OpportunityTask = { id: string; title: string; owner_id: string | null; due_at: string | null; status: TaskStatus; evidence: string;
  created_by?: string | null; updated_at?: string | null };

const text = (max: number) => z.string().trim().max(max);
const dueAtSchema = z.string().datetime({ offset: true }).nullable();
/** One task to create; the owner must be in the team of the opportunity (the API checks it). */
export const newTaskSchema = z.object({ title: text(500).min(2), ownerId: z.string().uuid().nullable(), dueAt: dueAtSchema, evidence: text(4000).default('') }).strict();
/** The plan turned into tasks at once: the ones ticked in the preview. */
export const taskBatchSchema = z.object({ tasks: z.array(newTaskSchema).min(1).max(40) }).strict();
export const taskStatusSchema = z.object({ id: z.string().uuid(), status: z.enum(TASK_STATUSES) }).strict();
export const taskDeleteSchema = z.object({ id: z.string().uuid() }).strict();

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
/** The day on Chile's calendar of an instant: «2026-10-28». */
export const chileDay = (at: Date | string | number) => DAY.format(new Date(at));
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const utcOf = (day: string) => { const [year, month, date] = parts(day); return Date.UTC(year, month - 1, date); };
/** Days from one day to another: 1 from today to tomorrow, −1 to yesterday. */
export const daysBetween = (from: string, to: string) => Math.round((utcOf(to) - utcOf(from)) / 86_400_000);
/** A day moved by some days: «2026-10-28» + 3 → «2026-10-31». */
export const addDays = (day: string, days: number) => new Date(utcOf(day) + days * 86_400_000).toISOString().slice(0, 10);
/** What the page stores for a day picked: noon of that day in Chile. */
export function dueAtOfDay(day: string | null | undefined): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = parts(day);
  const at = chileTime(year, month, date, 12, 0);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}
/** The day a stored due date falls on in Chile, for the day picker; empty without one. */
export const dayOfDueAt = (dueAt: string | null | undefined) => (dueAt && Number.isFinite(Date.parse(dueAt)) ? chileDay(dueAt) : '');
/** «28 de octubre», with the year only when it is not this one. */
export function dayLabel(day: string, today: string) {
  const [year, month, date] = parts(day);
  return `${date} de ${MONTHS[month - 1]}${year !== parts(today)[0] ? ` de ${year}` : ''}`;
}

/** When a task is due, as the list says it: a late one in red with the day it was due, today and tomorrow by name, the rest by their day. */
export function taskDue(dueAt: string | null | undefined, status: TaskStatus, now = new Date()): { label: string; late: boolean } | null {
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) return null;
  const today = chileDay(now), day = chileDay(dueAt), days = daysBetween(today, day);
  if (status === 'done') return { label: dayLabel(day, today), late: false };
  if (days < 0) return { label: `Venció el ${dayLabel(day, today)}`, late: true };
  if (days === 0) return { label: 'Vence hoy', late: false };
  if (days === 1) return { label: 'Vence mañana', late: false };
  return { label: `Vence el ${dayLabel(day, today)}`, late: false };
}
export const isLate = (task: Pick<OpportunityTask, 'due_at' | 'status'>, now = new Date()) => Boolean(taskDue(task.due_at, task.status, now)?.late);

/** The list: what is still to do by the day it is due (the ones without a day last), and what is done apart, the latest first. */
export function orderTasks<T extends Pick<OpportunityTask, 'title' | 'due_at' | 'status' | 'updated_at'>>(tasks: T[]) {
  const due = (task: T) => (task.due_at && Number.isFinite(Date.parse(task.due_at)) ? Date.parse(task.due_at) : Number.POSITIVE_INFINITY);
  const open = tasks.filter(task => task.status !== 'done').sort((a, b) => due(a) - due(b) || a.title.localeCompare(b.title, 'es'));
  const done = tasks.filter(task => task.status === 'done').sort((a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || '') || a.title.localeCompare(b.title, 'es'));
  return { open, done };
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
/** A step of the report's plan (expedient.ts, `tasks`), or one of «Qué hacer ahora» when the report has no plan. */
export type PlanStep = { title: string; role?: string; due?: string; dependency?: string; evidence?: string };
export type PlanDraft = { key: string; title: string; ownerId: string | null; day: string | null; evidence: string; exists: boolean };
const weekday = (day: string) => new Date(utcOf(day)).getUTCDay();
/** A day the plan proposes that falls on a weekend moves to the Friday before, or to the Monday after when that Friday has passed. */
function workday(day: string, today: string) {
  const back = weekday(day) === 6 ? 1 : weekday(day) === 0 ? 2 : 0;
  if (!back) return day;
  const friday = addDays(day, -back);
  return daysBetween(today, friday) >= 0 ? friday : addDays(day, back === 1 ? 2 : 1);
}
/** «Hasta 3 días hábiles antes del cierre»: the close counted back that many working days. */
function workdaysBefore(close: string, days: number) {
  let day = close;
  for (let left = days; left > 0;) { day = addDays(day, -1); if (weekday(day) !== 0 && weekday(day) !== 6) left -= 1; }
  return day;
}
const BEFORE = /(\d{1,3})\s*(d[ií]as?|semanas?)(\s+h[aá]biles)?\s+antes/i;

/**
 * The plan of the report as tasks to create (OPP-21), each with a day and an owner already proposed, to correct before creating them.
 * The day: the date the plan names; «N días antes del cierre» counted back from the close; the close itself for the step that hands in;
 * the rest between the steps around them, in the order of the plan, up to the working day before the close. Never before today nor after
 * the close, and a proposed one never on a weekend. Without a close, the ones with no date of their own have none. The owner: the person of the team the
 * role names, or else whoever is in charge, or the only one in the team. The steps already in the list come marked, to leave them out.
 */
export function planTaskDrafts(steps: PlanStep[], input: { deadline: string | null; now?: Date; responsibleId: string | null;
  people: Array<{ user_id: string; name: string }>; existing: string[] }): PlanDraft[] {
  const today = chileDay(input.now ?? new Date());
  const close = input.deadline && Number.isFinite(Date.parse(input.deadline)) ? chileDay(input.deadline) : null;
  const existing = new Set(input.existing.map(fold));
  const people = input.people.filter(person => person.name.trim());
  const fallback = input.responsibleId && people.some(person => person.user_id === input.responsibleId) ? input.responsibleId : people.length === 1 ? people[0].user_id : null;
  const ownerOf = (role = '') => {
    const words = fold(role).split(/[^\p{L}]+/u).filter(word => word.length >= 3);
    return people.find(person => fold(person.name).split(' ').some(name => name.length >= 3 && words.includes(name)))?.user_id ?? fallback;
  };
  const chosen = steps.map(step => ({ ...step, title: step.title.replace(/\s+/g, ' ').trim().slice(0, 500) })).filter(step => step.title.length >= 2).slice(0, 40);
  const clamp = (day: string) => { const late = close && daysBetween(close, day) > 0 ? close : day; return daysBetween(today, late) < 0 ? today : late; };
  // A day of its own, none (no close to count from) or undefined: spread below.
  const days: Array<string | null | undefined> = chosen.map(step => {
    const due = (step.due || '').trim();
    const named = due ? parseReportDate(due) : null;
    if (named) return clamp(chileDay(named.at));
    if (!close) return null;
    const before = due.match(BEFORE);
    if (before) {
      const count = Number(before[1]) * (/semana/i.test(before[2]) ? 7 : 1);
      return clamp(workday(before[3] ? workdaysBefore(close, count) : addDays(close, -count), today));
    }
    if (/(d[ií]a|fecha)\s+del?\s+cierre|al\s+cierre|^cierre$/i.test(due) || /\b(presentar|subir|enviar|ingresar)\b.*\b(oferta|propuesta)\b/i.test(step.title)) return clamp(close);
    return undefined;
  });
  // The steps without a day of their own go between the steps around them, in the plan's order: from today (before the first) up to
  // the working day before the close (after the last), evenly.
  const last = close ? clamp(workday(addDays(close, -1), today)) : today;
  for (let start = 0; start < days.length; start++) {
    if (days[start] !== undefined) continue;
    let end = start;
    while (end < days.length && days[end] === undefined) end++;
    const from = start > 0 ? days[start - 1] ?? today : today;
    const until = end < days.length ? days[end] ?? last : last;
    const span = Math.max(0, daysBetween(from, daysBetween(from, until) < 0 ? last : until));
    for (let index = start; index < end; index++) days[index] = clamp(workday(addDays(from, Math.round(((index - start + 1) * span) / (end - start + 1))), today));
    start = end;
  }
  return chosen.map((step, index) => ({
    key: `plan-${index}`, title: step.title, ownerId: ownerOf(step.role), day: days[index] ?? null,
    evidence: [step.dependency?.trim() && `Antes: ${step.dependency.trim()}`, step.evidence?.trim() && `Resultado: ${step.evidence.trim()}`].filter(Boolean).join(' · ').slice(0, 4000),
    exists: existing.has(fold(step.title)),
  }));
}

/** A task of «Mis tareas», with the opportunity it belongs to. */
export type MyTask = OpportunityTask & { opportunity: { id: string; title: string; kind: string; deadline_at: string | null } };
export type MyTaskGroup = { key: 'late' | 'today' | 'week' | 'later' | 'undated'; label: string; tasks: MyTask[] };
/** «Mis tareas» in the order they are needed: late, today, the next seven days, later and without a day. Empty groups are left out. */
export function myTaskGroups(tasks: MyTask[], now = new Date()): MyTaskGroup[] {
  const today = chileDay(now);
  const groups: MyTaskGroup[] = [
    { key: 'late', label: 'Vencidas', tasks: [] }, { key: 'today', label: 'Hoy', tasks: [] }, { key: 'week', label: 'Próximos 7 días', tasks: [] },
    { key: 'later', label: 'Más adelante', tasks: [] }, { key: 'undated', label: 'Sin fecha', tasks: [] },
  ];
  for (const task of orderTasks(tasks).open) {
    const days = task.due_at && Number.isFinite(Date.parse(task.due_at)) ? daysBetween(today, chileDay(task.due_at)) : null;
    const key = days === null ? 'undated' : days < 0 ? 'late' : days === 0 ? 'today' : days <= 7 ? 'week' : 'later';
    groups.find(group => group.key === key)!.tasks.push(task);
  }
  return groups.filter(group => group.tasks.length > 0);
}

/** The line a change of a task leaves in the activity of the opportunity. */
export function taskActivityLine(change: 'created' | 'edited' | 'deleted' | TaskStatus, title: string) {
  const what = { created: 'Tarea creada', edited: 'Tarea actualizada', deleted: 'Tarea eliminada', pending: 'Tarea pendiente de nuevo', working: 'Tarea en curso',
    done: 'Tarea hecha', blocked: 'Tarea bloqueada' }[change];
  return `${what}: ${title.replace(/\s+/g, ' ').trim().slice(0, 300)}`;
}

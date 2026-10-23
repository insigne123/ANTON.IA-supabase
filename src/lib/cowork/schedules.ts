import { z } from 'zod';
import { coworkTimeZone } from './time-zone';
import { COWORK_SCHEDULE_MARK } from './schedule-message';

export { COWORK_SCHEDULE_MARK, coworkIsScheduledMessage, coworkScheduledTitle } from './schedule-message';

/**
 * Scheduled tasks of Cowork: a request the person wants answered again and again («cada lunes a las 9, dime quién respondió y a quién
 * escribir hoy»). Each firing starts a new conversation, in approval mode, with the request as its first message; whatever needs a
 * decision waits there as a proposal. This file is the pure part: what a schedule is, when it fires next and how it reads.
 */

export const COWORK_SCHEDULE_LIMITS = {
  /** Tasks a person may have turned on at once. */
  active: 5,
  titleMax: 80,
  promptMin: 10,
  promptMax: 2_000,
  /** A firing later than this is a missed one (the worker was down): it is skipped, never run late. */
  graceMs: 6 * 60 * 60_000,
  /** Failures in a row after which a task is paused. */
  failuresToPause: 3,
} as const;

export const COWORK_SCHEDULE_FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type CoworkScheduleFrequency = (typeof COWORK_SCHEDULE_FREQUENCIES)[number];

/** When a task fires: the day rule, the time in the zone of the person and, for weekly and monthly, which day. */
export type CoworkSchedule = {
  frequency: CoworkScheduleFrequency;
  /** «HH:MM», 24 hours. */
  time: string;
  /** ISO weekday, 1 Monday to 7 Sunday: weekly only. */
  weekday: number | null;
  /** Day of the month, 1 to 28 so every month has it: monthly only. */
  monthDay: number | null;
  timeZone: string;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The fields of a task, each with what it means (the agent reads these descriptions when it proposes one). */
export const coworkScheduleFields = {
  title: z.string().trim().min(3).max(COWORK_SCHEDULE_LIMITS.titleMax).describe('Nombre corto de la tarea, por ejemplo «Resumen del lunes»'),
  prompt: z.string().trim().min(COWORK_SCHEDULE_LIMITS.promptMin).max(COWORK_SCHEDULE_LIMITS.promptMax)
    .describe('El pedido tal como se le haría a Cowork, completo: quien lo lee en la ejecución no tiene esta conversación'),
  frequency: z.enum(COWORK_SCHEDULE_FREQUENCIES).describe('daily: todos los días. weekdays: de lunes a viernes. weekly: un día de la semana. monthly: un día del mes'),
  time: z.string().regex(TIME, 'La hora va como HH:MM, de 00:00 a 23:59').describe('Hora local, HH:MM de 24 horas'),
  weekday: z.number().int().min(1).max(7).nullable().optional().describe('Solo weekly: 1 lunes … 7 domingo'),
  monthDay: z.number().int().min(1).max(28).nullable().optional().describe('Solo monthly: día del mes, de 1 a 28'),
  timeZone: z.string().trim().max(64).optional().describe('Zona horaria IANA; por defecto la de la cuenta'),
};

/** What the person (or the agent on their behalf) asks for. Everything is checked again on the server; this is the shape. */
export const coworkScheduleInputSchema = z.object(coworkScheduleFields).strict().superRefine((value, context) => {
  if (value.frequency === 'weekly' && !value.weekday) context.addIssue({ code: 'custom', path: ['weekday'], message: 'Una tarea semanal necesita el día de la semana' });
  if (value.frequency === 'monthly' && !value.monthDay) context.addIssue({ code: 'custom', path: ['monthDay'], message: 'Una tarea mensual necesita el día del mes' });
  if (value.frequency !== 'weekly' && value.weekday) context.addIssue({ code: 'custom', path: ['weekday'], message: 'El día de la semana solo va en las tareas semanales' });
  if (value.frequency !== 'monthly' && value.monthDay) context.addIssue({ code: 'custom', path: ['monthDay'], message: 'El día del mes solo va en las tareas mensuales' });
});
export type CoworkScheduleInput = z.infer<typeof coworkScheduleInputSchema>;

/** The schedule of an input, with the zone checked (an unknown one falls back to the account's) and the unused day fields null. */
export function coworkScheduleOf(input: Pick<CoworkScheduleInput, 'frequency' | 'time' | 'weekday' | 'monthDay' | 'timeZone'>): CoworkSchedule {
  return {
    frequency: input.frequency,
    time: input.time,
    weekday: input.frequency === 'weekly' ? input.weekday ?? null : null,
    monthDay: input.frequency === 'monthly' ? input.monthDay ?? null : null,
    timeZone: coworkTimeZone(input.timeZone),
  };
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(timeZone: string, at: number): Parts {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  const found: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(at))) if (part.type !== 'literal') found[part.type] = Number(part.value);
  return { year: found.year, month: found.month, day: found.day, hour: found.hour, minute: found.minute, second: found.second };
}

/** How far the local time of the zone is from UTC at an instant, in milliseconds (negative to the west, like Chile). */
function offsetAt(timeZone: string, at: number) {
  const parts = partsIn(timeZone, at);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a local date and time happen in a zone. A time that happens twice (clocks go back) is the first one; a time that never
 * happens (clocks go forward) is moved ahead by the gap, so a task set for 00:30 still fires that night.
 */
export function coworkLocalInstant(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(timeZone, guess);
  const second = guess - offsetAt(timeZone, first);
  if (first === second) return first;
  const local = partsIn(timeZone, second);
  return local.day === day && local.hour === hour && local.minute === minute ? second : Math.max(first, second);
}

const isoWeekday = (year: number, month: number, day: number) => ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;

/** The first firing strictly after `after`. */
export function nextCoworkScheduleRun(schedule: CoworkSchedule, after: Date): Date {
  const timeZone = coworkTimeZone(schedule.timeZone);
  const [hour, minute] = schedule.time.split(':').map(Number);
  const today = partsIn(timeZone, after.getTime());
  for (let offset = 0; offset <= 62; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    const dayOfMonth = day.getUTCDate();
    const weekday = isoWeekday(year, month, dayOfMonth);
    const matches = schedule.frequency === 'daily' ? true
      : schedule.frequency === 'weekdays' ? weekday <= 5
        : schedule.frequency === 'weekly' ? weekday === schedule.weekday
          : dayOfMonth === schedule.monthDay;
    if (!matches) continue;
    const instant = coworkLocalInstant(timeZone, year, month, dayOfMonth, hour, minute);
    if (instant > after.getTime()) return new Date(instant);
  }
  throw new Error('La tarea programada no tiene una próxima fecha.');
}

const WEEKDAYS_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
const WEEKDAYS_ON_THE = ['los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados', 'los domingos'];

/** «Los lunes a las 09:00», as the list of tasks shows it. */
export function describeCoworkSchedule(schedule: CoworkSchedule) {
  const zone = schedule.timeZone && schedule.timeZone !== coworkTimeZone('') ? ` (hora de ${schedule.timeZone})` : '';
  const at = `a las ${schedule.time}${zone}`;
  if (schedule.frequency === 'daily') return `Todos los días ${at}`;
  if (schedule.frequency === 'weekdays') return `De lunes a viernes ${at}`;
  if (schedule.frequency === 'weekly') {
    const name = WEEKDAYS_ON_THE[(schedule.weekday ?? 1) - 1] || WEEKDAYS_PLURAL[0];
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${at}`;
  }
  return `El día ${schedule.monthDay} de cada mes ${at}`;
}

/** «lunes 26 de octubre, 09:00» in the zone of the task. */
export function coworkScheduleWhen(at: Date, timeZone: string) {
  const zone = coworkTimeZone(timeZone);
  const day = new Intl.DateTimeFormat('es-CL', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(at);
  const hour = new Intl.DateTimeFormat('es-CL', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return `${day}, ${hour}`;
}

/** The first message of the conversation a firing starts: what it is, when it fired and the request, word for word. */
export function coworkScheduleMessage(task: { title: string; prompt: string }, firedFor: Date, timeZone: string) {
  return [
    `${COWORK_SCHEDULE_MARK} · ${task.title}`,
    coworkScheduleWhen(firedFor, timeZone),
    '',
    task.prompt.trim(),
    '',
    '(Ejecución automática: responde con lo que puedas resolver ahora; lo que necesite una decisión de la persona queda como propuesta para aprobar.)',
  ].join('\n');
}

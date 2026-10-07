/**
 * When the daily search of «Oportunidades» runs (Plan 15): the days of the week (0 domingo … 6 sábado) and the hour, in
 * Chilean time, chosen in «Ajustes de la búsqueda». Pure: the hourly tick asks `scheduleDue` for each organization.
 */
export type OpportunitySchedule = { enabled: boolean; days: number[]; hour: number };

export const DEFAULT_SCHEDULE: OpportunitySchedule = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], hour: 8 };
export const SCHEDULE_TIME_ZONE = 'America/Santiago';
/** Monday first, as a Chilean calendar reads. */
export const WEEK_DAYS: Array<{ day: number; short: string; label: string }> = [
  { day: 1, short: 'L', label: 'lunes' }, { day: 2, short: 'M', label: 'martes' }, { day: 3, short: 'M', label: 'miércoles' },
  { day: 4, short: 'J', label: 'jueves' }, { day: 5, short: 'V', label: 'viernes' }, { day: 6, short: 'S', label: 'sábado' },
  { day: 0, short: 'D', label: 'domingo' },
];

export function normalizeSchedule(value: Partial<{ enabled: unknown; days: unknown; hour: unknown }> | null | undefined): OpportunitySchedule {
  const days = Array.isArray(value?.days) ? [...new Set(value!.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
  const hour = Number(value?.hour);
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_SCHEDULE.enabled,
    days: days.length ? days : [...DEFAULT_SCHEDULE.days],
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SCHEDULE.hour,
  };
}

/** The day of the week, the hour and the date of an instant in Chile. */
export function chileanClock(nowIso: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULE_TIME_ZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowIso)).map(part => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/**
 * Whether an organization's daily search is due now: its day, at or after its hour, and not run yet today (Chilean dates).
 * The tick runs every hour, so the hour chosen is when it runs; «at or after» also catches up an hour the tick missed.
 */
export function scheduleDue(schedule: OpportunitySchedule, nowIso: string, lastScheduledAt: string | null) {
  if (!schedule.enabled) return false;
  const now = chileanClock(nowIso);
  if (!schedule.days.includes(now.day) || now.hour < schedule.hour) return false;
  return !lastScheduledAt || chileanClock(lastScheduledAt).date !== now.date;
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** «Todos los días a las 08:00», «De lunes a viernes a las 07:00», «Lunes, miércoles y viernes a las 09:00», «En pausa». */
export function describeSchedule(schedule: OpportunitySchedule) {
  if (!schedule.enabled) return 'En pausa';
  const days = WEEK_DAYS.filter(item => schedule.days.includes(item.day));
  const at = `a las ${hourLabel(schedule.hour)}`;
  if (days.length === 7) return `Todos los días ${at}`;
  const weekdays = [1, 2, 3, 4, 5];
  if (days.length === 5 && weekdays.every(day => schedule.days.includes(day))) return `De lunes a viernes ${at}`;
  const names = days.map(item => item.label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0];
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${at}`;
}

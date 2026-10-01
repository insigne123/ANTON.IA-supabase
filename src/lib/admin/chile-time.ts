/** Calendar days of the admin panel, in Chile time: «hoy» and «últimos 7 días» end at local midnight, not UTC. */
export const ADMIN_TIME_ZONE = 'America/Santiago';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function offsetMinutes(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** «YYYY-MM-DD» of an instant in the zone. */
export function dayInZone(at: Date, timeZone = ADMIN_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The instant a calendar day starts in the zone, daylight saving included. */
export function dayStartInZone(day: string, timeZone = ADMIN_TIME_ZONE) {
  if (!DAY_RE.test(day)) throw new Error(`Invalid day: ${day}`);
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  const firstGuess = utcMidnight - offsetMinutes(new Date(utcMidnight), timeZone) * 60_000;
  return new Date(utcMidnight - offsetMinutes(new Date(firstGuess), timeZone) * 60_000);
}

export function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from `from` to `to`. */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}

/** The last `days` calendar days ending today in Chile. */
export function lastDaysInZone(days: number, now = new Date()) {
  const to = dayInZone(now);
  return { from: shiftDay(to, -(days - 1)), to };
}

/** The same number of days right before the range, to compare against. */
export function previousRange(range: { from: string; to: string }) {
  const length = daysBetween(range.from, range.to);
  return { from: shiftDay(range.from, -length), to: shiftDay(range.from, -1) };
}

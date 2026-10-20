// The cards of «Hoy» drop an answer that is not for the person, workspace and day they show (usePersonalHome), so the
// mocks of those cards answer with the demo owner's scope (scripts/visual-audit/fixtures/ids.mjs) and Chile's day.
const OWNER = '00000000-0000-4000-8000-000000000011';
const ORG = '00000000-0000-4000-8000-000000000001';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const DAY = 86_400_000;

export const chileDay = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(at);
export const homeScope = request => ({ userId: OWNER, organizationId: request.headers()['x-organization-id'] || ORG, dayKey: chileDay() });

/** This week in Chile, Monday to Sunday, as «Meta de la semana» labels it («19–25 oct»). */
export function thisWeek() {
  const today = chileDay();
  const shift = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  const start = shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const end = shift(start, 6);
  const part = (day, month) => `${Number(day.slice(8, 10))}${month ? ` ${MONTHS[Number(day.slice(5, 7)) - 1]}` : ''}`;
  return { end, label: start.slice(5, 7) === end.slice(5, 7) ? `${part(start, false)}–${part(end, true)}` : `${part(start, true)} – ${part(end, true)}` };
}

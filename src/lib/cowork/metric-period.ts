import { z } from 'zod';
export const coworkMetricQuerySchema = z.object({ period: z.enum(['calendar_week', 'calendar_month', 'last_7_days', 'last_30_days', 'previous_calendar_week', 'previous_calendar_month']),
  scope: z.enum(['own', 'organization']) }).strict();
export type CoworkMetricQuery = z.infer<typeof coworkMetricQuerySchema>;
export function coworkMetricQuery(raw: string): CoworkMetricQuery | null {
  if (!raw.trim().startsWith('{')) return null;
  return coworkMetricQuerySchema.parse(JSON.parse(raw));
}
/** Bind an omitted legacy argument to an explicit user period/scope; comparisons keep their individual queries. */
export function coworkRequestedMetricQuery(message: string): CoworkMetricQuery | null {
  const text = message.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!/numeros|metricas|envios|correos|actividad|resultados|tasa/.test(text) || !/cuant[oa]s|numeros|metricas|resultados|tasa|como (?:me |nos )?ha|resumen|informe/.test(text) || /compar|\bvs\b|versus/.test(text)) return null;
  const period = /este mes|mes calendario/.test(text) ? 'calendar_month' : /esta semana|desde el lunes/.test(text) ? 'calendar_week'
    : /ultimos 7 dias/.test(text) ? 'last_7_days' : /ultimos 30 dias/.test(text) ? 'last_30_days' : null;
  if (!period) return null;
  const own = /mis (?:numeros|metricas|envios|correos|resultados)|mi actividad|personales|como me ha/.test(text);
  const team = /(?:del |el )equipo|(?:la |mi )organizacion/.test(text);
  return { period, scope: own ? 'own' : team ? 'organization' : 'organization' };
}
export function coworkMetricSpan(query: CoworkMetricQuery, now: Date, timeZone = 'America/Santiago') {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, Number(part.value)]));
  const today = parts(now.getTime());
  // A wall-clock midnight in the time zone, resolved with the offset at that boundary, not today's (Chile changes DST).
  const midnight = (wall: Date) => {
    const target = wall.getTime();
    let at = target;
    for (let pass = 0; pass < 4; pass++) {
      const local = parts(at);
      const observed = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
      const correction = target - observed;
      if (!correction) break;
      at += correction;
    }
    return at;
  };
  let start = now.getTime() - (query.period === 'last_7_days' ? 7 : 30) * 86400000;
  let end = now.getTime() + 1;
  const month = query.period === 'calendar_month' || query.period === 'previous_calendar_month';
  if (query.period.includes('calendar_')) {
    const wall = new Date(Date.UTC(today.year, today.month - 1, month ? 1 : today.day));
    if (!month) wall.setUTCDate(wall.getUTCDate() - (wall.getUTCDay() + 6) % 7);
    start = midnight(wall);
    // The week or month before this one ends where this one starts (round 25: «¿voy mejor o peor que la semana pasada?»).
    if (query.period.startsWith('previous_')) {
      end = start;
      if (month) wall.setUTCMonth(wall.getUTCMonth() - 1); else wall.setUTCDate(wall.getUTCDate() - 7);
      start = midnight(wall);
    }
  }
  return { period: query.period, scope: query.scope, timeZone, startInclusive: new Date(start).toISOString(),
    endExclusive: new Date(end).toISOString(), observedAt: now.toISOString(),
    label: ({ calendar_week: 'Esta semana (desde el lunes)', calendar_month: 'Este mes calendario', last_7_days: 'Últimos 7 días', last_30_days: 'Últimos 30 días',
      previous_calendar_week: 'La semana pasada (lunes a domingo)', previous_calendar_month: 'El mes pasado' } as const)[query.period] };
}

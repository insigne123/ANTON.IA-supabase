/** The zone Cowork reads dates in: COWORK_TIME_ZONE when it is a real zone, else Chile. Apart from decision-context.ts so the interface can use it without the instructions. */
export const COWORK_DEFAULT_TIME_ZONE = 'America/Santiago';

export function coworkTimeZone(value = typeof process === 'undefined' ? undefined : process.env?.COWORK_TIME_ZONE) {
  const zone = String(value || '').trim();
  if (!zone) return COWORK_DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: zone });
    return zone;
  } catch {
    return COWORK_DEFAULT_TIME_ZONE;
  }
}

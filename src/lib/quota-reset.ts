/** When the daily quota renews, as a person in Chile reads it («21:00»). The quota itself renews at midnight UTC. */
export function quotaResetTime(value?: string | null, timeZone = 'America/Santiago') {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
}

/** «Se renueva cada día a las 21:00 (hora de Chile).», or without the hour when it is unknown. */
export const quotaResetSentence = (value?: string | null) => {
  const time = quotaResetTime(value);
  return time ? `Se renueva cada día a las ${time} (hora de Chile).` : 'Se renueva cada día.';
};

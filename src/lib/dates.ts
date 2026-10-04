// One way to show dates across the app: Chilean Spanish, the viewer's time zone, and words a person reads at a glance
// («hace 2 h», «ayer», «3 oct»). Pages had es-CL, es-AR, es-ES and the browser default mixed.
const LOCALE = 'es-CL';

const toDate = (value: Date | string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** «3 oct 2026»; without the year when it is the current one («3 oct»). */
export function formatDate(value: Date | string | number | null | undefined, { now = new Date(), year }: { now?: Date; year?: boolean } = {}) {
  const date = toDate(value);
  if (!date) return '—';
  const showYear = year ?? date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', ...(showYear ? { year: 'numeric' } : {}) }).replace(/\./g, '');
}

/** «3 oct, 14:05» (24 h, as in Chile). */
export function formatDateTime(value: Date | string | number | null | undefined, options: { now?: Date } = {}) {
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDate(date, options)}, ${date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** «ahora», «hace 5 min», «hace 2 h», «ayer», «hace 3 días», then the date; future dates read «en 2 días», «mañana». */
export function formatRelative(value: Date | string | number | null | undefined, { now = new Date() }: { now?: Date } = {}) {
  const date = toDate(value);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const past = seconds <= 0;
  const abs = Math.abs(seconds);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (abs < 60) return 'ahora';
  if (abs < 3600) return past ? `hace ${Math.floor(abs / 60)} min` : `en ${Math.floor(abs / 60)} min`;
  if (dayDiff === 0) return past ? `hace ${Math.floor(abs / 3600)} h` : `en ${Math.floor(abs / 3600)} h`;
  if (dayDiff === -1) return 'ayer';
  if (dayDiff === 1) return 'mañana';
  if (dayDiff < 0 && dayDiff > -7) return `hace ${-dayDiff} días`;
  if (dayDiff > 0 && dayDiff < 7) return `en ${dayDiff} días`;
  return formatDate(date, { now });
}

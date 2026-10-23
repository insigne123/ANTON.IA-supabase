import type { CoworkScheduleFrequency } from './schedules';

/**
 * What a request already says about when it repeats («cada lunes a las 9, dime a quién escribir hoy»): the form of a scheduled task
 * opens with that filled in, and the person fixes whatever was guessed wrong. Plain rules over Spanish, no model: it is instant, free
 * and says the same thing every time.
 */
export type CoworkScheduleHint = {
  /** The request without the words that only said when ("Dime a quién escribir hoy"), as a name for the task. */
  title: string;
  frequency?: CoworkScheduleFrequency;
  weekday?: number;
  monthDay?: number;
  /** «HH:MM» in 24 hours. */
  time?: string;
};

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const DAYS: Array<[RegExp, number]> = [
  [/lunes/, 1], [/martes/, 2], [/miercoles/, 3], [/jueves/, 4], [/viernes/, 5], [/sabados?/, 6], [/domingos?/, 7],
];

/** «a las 9», «a las 8:30», «a las 3 de la tarde», «a las 8 pm», «a las 17 h». */
const AT = /\ba las (\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|hs?|horas|de la manana|de la tarde|de la noche|de la madrugada)?/;

/**
 * The hour of «a las N»: a PM mark (or «de la tarde/noche») adds twelve; with no mark an hour from 1 to 6 is the afternoon, because nobody
 * wants a work task at 3 in the morning, and the rest is read as typed.
 */
function timeOf(folded: string): string | null {
  const match = folded.match(AT);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const mark = match[3] || '';
  if (hour > 23 || minute > 59) return null;
  const pm = /^(pm|p\.m\.|de la tarde|de la noche)$/.test(mark);
  const am = /^(am|a\.m\.|de la manana|de la madrugada)$/.test(mark);
  if (pm && hour < 12) hour += 12;
  else if (am && hour === 12) hour = 0;
  else if (!pm && !am && !mark && hour >= 1 && hour <= 6) hour += 12;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The phrases that said when, to take them out of the name. */
const WHEN = [
  // The longer phrase first: «cada mes» alone would leave «el día 15 de» behind.
  /\bel dia \d{1,2} de cada mes\b/gi,
  /\b(?:de|desde el) lunes a viernes\b/gi, /\bdias habiles\b/gi, /\bdias de semana\b/gi,
  /\b(?:todos los|cada|los) (?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)\b/gi,
  /\b(?:todos los dias|cada dia|todas las (?:mananas|tardes|noches)|cada semana|cada mes|semanalmente|mensualmente|diariamente)\b/gi,
  /\ba las \d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|hs?|horas|de la manana|de la tarde|de la noche|de la madrugada)?/gi,
];

export function coworkScheduleHint(text: string): CoworkScheduleHint {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  const folded = fold(original);
  const hint: CoworkScheduleHint = { title: '' };

  const day = DAYS.find(([pattern]) => new RegExp(`\\b(?:todos los|cada|los) ${pattern.source}\\b`).test(folded));
  if (/\b(?:de lunes a viernes|dias habiles|dias de semana)\b/.test(folded)) hint.frequency = 'weekdays';
  else if (day) { hint.frequency = 'weekly'; hint.weekday = day[1]; }
  else if (/\b(?:el dia \d{1,2} de cada mes|cada mes|mensualmente)\b/.test(folded)) {
    hint.frequency = 'monthly';
    const monthDay = folded.match(/\bel dia (\d{1,2}) de cada mes\b/);
    hint.monthDay = monthDay ? Math.min(28, Math.max(1, Number(monthDay[1]))) : 1;
  } else if (/\b(?:cada semana|semanalmente)\b/.test(folded)) { hint.frequency = 'weekly'; hint.weekday = 1; }
  else if (/\b(?:todos los dias|cada dia|diariamente|todas las (?:mananas|tardes|noches))\b/.test(folded)) hint.frequency = 'daily';

  const time = timeOf(folded);
  if (time) hint.time = time;
  else if (/\btodas las mananas\b/.test(folded)) hint.time = '08:00';
  else if (/\btodas las tardes\b/.test(folded)) hint.time = '16:00';
  else if (/\btodas las noches\b/.test(folded)) hint.time = '20:00';

  // The name: the request without the words that said when, cut at its first sentence and 50 characters.
  let rest = original;
  for (const pattern of WHEN) {
    // Folding keeps the length of the text, so a match of the folded copy is at the same place in the original.
    for (const found of [...fold(rest).matchAll(pattern)].reverse()) rest = `${rest.slice(0, found.index)}${rest.slice((found.index ?? 0) + found[0].length)}`;
  }
  rest = rest.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, '').replace(/\s+([,.;:])/g, '$1');
  const sentence = rest.match(/^.{8,}?[.?!](?=\s|$)/u)?.[0] ?? rest;
  const named = sentence.replace(/^[¿¡]\s*/u, '').replace(/[?!.]+$/u, '').trim();
  const capitalized = named ? named.charAt(0).toLocaleUpperCase('es') + named.slice(1) : '';
  hint.title = capitalized.length <= 50 ? capitalized : `${capitalized.slice(0, 49).replace(/\s+\S*$/, '').trimEnd()}…`;
  return hint;
}

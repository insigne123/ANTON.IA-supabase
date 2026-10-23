// When is a sentence about a company «in the facts»? Shared by the research, where a Claude proposes signals out of the facts of the pages, and by
// the draft, which quotes a signal's statement only if it passes the same test again: every number and every proper name of the statement is
// written in the facts it stands on, and the dates are the ones the text writes or the signal's own.

export const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const words = (value: unknown) => fold(value).replace(/[^a-z0-9]+/g, ' ').trim();

const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

export function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

/** The dates a text writes («2026-10-12», «12/10/2026», «12 de octubre de 2026», «12 de octubre»); a date without a year takes `fallbackYear`. */
export function datesInText(text: string, fallbackYear: number): string[] {
  const folded = fold(text);
  const found = new Set<string>();
  for (const match of folded.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) found.add(isoDate(Number(match[1]), Number(match[2]), Number(match[3])) ?? '');
  for (const match of folded.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g)) found.add(isoDate(Number(match[3]), Number(match[2]), Number(match[1])) ?? '');
  for (const match of folded.matchAll(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: (?:de|del) (20\d{2}))?/g)) {
    found.add(isoDate(match[3] ? Number(match[3]) : fallbackYear, MONTHS[match[2]!]!, Number(match[1])) ?? '');
  }
  found.delete('');
  return [...found];
}

/** Every number of a text as its digits («5,4» and «5.4» are 54; «$185.209,6» is 1852096): the figures a statement may use are the ones of its facts. */
export const numbersOf = (text: string) => [...text.matchAll(/\d[\d.,]*/g)].map(match => match[0].replace(/\D/g, '')).filter(Boolean);

/** Capitalised words of 4 letters or more in the middle of a text (names of places, people and brands): each must be written in the facts. */
export const namesOf = (text: string) => [...text.matchAll(/\p{Lu}\p{Ll}{3,}/gu)].filter(match => match.index !== 0).map(match => fold(match[0]));

const COMMON_NAMES = new Set([...Object.keys(MONTHS), 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'region', 'chile', 'peru', 'colombia']);

/**
 * Why a statement is not in the facts it stands on, or null if it is: `number_not_in_facts` for a figure none of the facts writes (a sum or an
 * invention) and `name_not_in_facts` for a place, person or brand they do not name. The day, month and year of `date` may be written even if the
 * facts have them in another form, the first word of a sentence is free, and so are the name of the company and months, days and countries.
 */
export function ungroundedIn(statement: string, factTexts: string[], options: { date?: string | null; companyName: string; companyDomain: string }): 'number_not_in_facts' | 'name_not_in_facts' | null {
  const evidence = factTexts.join(' ');
  const evidenceNumbers = new Set(numbersOf(evidence));
  const dateNumbers = new Set<string>();
  const date = options.date?.slice(0, 10);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) [String(Number(date.slice(8, 10))), String(Number(date.slice(5, 7))), date.slice(0, 4)].forEach(number => dateNumbers.add(number));
  if (numbersOf(statement).some(number => !evidenceNumbers.has(number) && !dateNumbers.has(number))) return 'number_not_in_facts';
  const evidenceNames = new Set(namesOf(evidence).concat(words(evidence).split(' ')));
  const companyNames = new Set(words(`${options.companyName} ${options.companyDomain}`).split(' '));
  if (namesOf(statement).some(name => !evidenceNames.has(name) && !companyNames.has(name) && !COMMON_NAMES.has(name))) return 'name_not_in_facts';
  return null;
}

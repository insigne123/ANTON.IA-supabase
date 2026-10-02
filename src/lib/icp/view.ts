/**
 * What the ICP screens show (plan 8, phase 2), computed apart so it can be tested: the segment views, rates with their
 * probable range in Chilean Spanish, the period of the sends and the comma lists of «Perfil».
 */
export type SegmentView = 'area' | 'industry' | 'location' | 'level';
export const SEGMENT_VIEWS: Array<{ id: SegmentView; label: string; column: string }> = [
  { id: 'area', label: 'Área del cargo', column: 'Área' },
  { id: 'industry', label: 'Industria', column: 'Industria' },
  { id: 'location', label: 'Ubicación', column: 'Ubicación' },
  { id: 'level', label: 'Nivel', column: 'Nivel' },
];

const percent = (value: number) => `${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;
type Rate = { pct: number; low: number; high: number } | null;
/** «3,1 %, entre 0,9 % y 10,6 %»: the rate and its probable range, for a sentence; without sends, a dash. */
export function formatRate(rate: Rate) {
  if (!rate) return '—';
  return `${percent(rate.pct)}, entre ${percent(rate.low)} y ${percent(rate.high)}`;
}
/** «3,1 % (0,9–10,6)»: the same, short, for a table. */
export function formatRateCompact(rate: Rate) {
  if (!rate) return '—';
  const number = (value: number) => value.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  return `${percent(rate.pct)} (${number(rate.low)}–${number(rate.high)})`;
}

const dayFormat = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const day = (value: string) => dayFormat.format(new Date(`${value}T12:00:00Z`)).replace('.', '');
/** « entre el 2 sept y el 30 sept», or nothing without dates. */
export function icpPeriod(first: string | null, last: string | null) {
  if (!first || !last) return '';
  return first === last ? ` el ${day(first)}` : ` entre el ${day(first)} y el ${day(last)}`;
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
/** Whether a comma list of «Perfil» («Retail, logística») already has the term, ignoring case and accents. */
export function includesTerm(list: string, term: string) {
  return list.split(/[,;\n]/).some(item => fold(item) === fold(term));
}
/** The comma list with the term at the end, once. */
export function appendTerm(list: string, term: string) {
  if (includesTerm(list, term)) return list;
  const items = list.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
  return [...items, term.trim()].join(', ');
}

/** Where to act on a recommended contact: «Por escribir» to write, «Por completar» to find what is missing. */
export function recommendationLink(item: { list?: 'por_escribir' | 'por_completar'; missing: string[] }) {
  if (item.list === 'por_escribir') return { href: '/saved/leads/enriched', label: item.missing.includes('buscar su correo') ? 'Buscar correo' : 'Escribir' };
  return { href: '/saved/leads', label: item.missing.includes('buscar su correo') ? 'Buscar correo' : 'Abrir' };
}

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

type RecommendedItem = { list?: 'por_escribir' | 'por_completar'; missing: string[] };

/**
 * Whether «Recomendados para ti» finds this contact's email right there: saved («Por completar») and still without one. Before
 * (3 Nov 2026) its «Buscar correo» only opened «Por escribir», where the person had to find the contact again: GrupoExpro had
 * 414 saved contacts whose email nobody ever looked up.
 */
export const canLookUpEmail = (item: RecommendedItem) => item.list !== 'por_escribir' && item.missing.includes('buscar su correo');

/** How many emails «Buscar correos» looks up at once: one credit each (RECOMMEND_LOOKUP_BATCH on the server). */
export const EMAIL_LOOKUP_BATCH = 10;

/** The best recommended contacts whose email can be found right there, in their order, up to one batch. */
export function emailLookupBatch<T extends RecommendedItem & { leadId: string }>(items: T[], size = EMAIL_LOOKUP_BATCH) {
  return items.filter(canLookUpEmail).slice(0, size).map(item => item.leadId);
}

/** «Buscar 4 correos · 4 créditos»: what the button does and what it costs. */
export function emailLookupLabel(count: number) {
  return count === 1 ? 'Buscar 1 correo · 1 crédito' : `Buscar ${count.toLocaleString('es-CL')} correos · ${count.toLocaleString('es-CL')} créditos`;
}

/** Where to act on a recommended contact that is not looked up right there: «Por escribir», to write or to open it. */
export function recommendationLink(item: RecommendedItem) {
  if (item.list === 'por_escribir') return { href: '/saved/leads/enriched', label: item.missing.includes('buscar su correo') ? 'Abrir' : 'Escribir' };
  return { href: '/saved/leads/enriched', label: 'Abrir' };
}

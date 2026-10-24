// What the daily search of Oportunidades looks in and for, as the administrator chose it (OPP-51). Before, every source ran every day:
// LinkedIn could not be turned off (it needed at least one search, and failed 4 of 10 times in a month), job ads cost US$0,30 a run
// every day though they change weekly, and a tender could only be narrowed by words. Kept in opportunity_company_context.search,
// beside the offer and apart from the criteria the AI derives from it, so a new offer does not undo them. Pure: the page, the route and
// the search share it.
import { z } from 'zod';

export const SEARCH_SOURCES = ['tenders', 'compraAgil', 'posts', 'hiring'] as const;
export type SearchSource = typeof SEARCH_SOURCES[number];
export const SEARCH_SOURCE_LABELS: Record<SearchSource, string> = {
  tenders: 'Licitaciones públicas', compraAgil: 'Compra Ágil', posts: 'Publicaciones de LinkedIn', hiring: 'Avisos de trabajo',
};

const words = (max: number, length: number) => z.array(z.string().trim().min(1).max(length)).max(max);
export const searchSettingsSchema = z.object({
  /** Which sources the daily search runs; a missing one runs, as before. */
  sources: z.object({ tenders: z.boolean(), compraAgil: z.boolean(), posts: z.boolean(), hiring: z.boolean() }).partial().default({}),
  /** Job ads change slowly: once a week (on Mondays) costs a fifth. */
  hiringEvery: z.enum(['day', 'week']).default('day'),
  tenders: z.object({
    /** Below or above it is left out before the AI reads it, with the reason («Fuera del rango de monto que definiste»). */
    minAmount: z.number().int().nonnegative().nullable().default(null),
    maxAmount: z.number().int().positive().nullable().default(null),
    /** Buyers to leave out, by name: the same reason. */
    avoidBuyers: words(30, 160).default([]),
    /** Preferences the AI weighs: buyers to follow, regions and UNSPSC codes (2 to 8 digits; an item that starts with one counts). */
    buyers: words(30, 160).default([]),
    regions: words(16, 80).default([]),
    unspsc: z.array(z.string().trim().regex(/^\d{2,8}$/, 'Los códigos UNSPSC tienen de 2 a 8 dígitos.')).max(40).default([]),
  }).default({}),
}).strict();
export type SearchSettings = z.infer<typeof searchSettingsSchema>;

/** What is saved, read leniently: an older or broken value is the defaults, never an error that stops the search. */
export function readSearchSettings(raw: unknown): SearchSettings {
  const parsed = searchSettingsSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  return parsed.success ? parsed.data : searchSettingsSchema.parse({});
}

export const sourceOn = (settings: SearchSettings, source: SearchSource) => settings.sources[source] !== false;

/**
 * The jobs of a day of search: without criteria yet, deriving them from the offer; else tenders (the listing and Compra Ágil share the
 * job, each one only when on), job ads when on, with roles and on their day, and LinkedIn posts when on and with searches.
 * `weekday` is the day in Chile, 0 Sunday to 6 Saturday; job ads once a week run on Mondays.
 */
export function discoverySources(settings: SearchSettings, criteria: { postQueries?: string[]; roles?: string[]; keywords?: string[] } | null | undefined, weekday: number) {
  const derived = Boolean(criteria?.postQueries?.length || criteria?.keywords?.length || criteria?.roles?.length);
  if (!derived) return ['criteria'];
  return [
    ...(sourceOn(settings, 'tenders') || sourceOn(settings, 'compraAgil') ? ['tenders'] : []),
    ...(sourceOn(settings, 'hiring') && criteria?.roles?.length && (settings.hiringEvery === 'day' || weekday === 1) ? ['hiring'] : []),
    ...(sourceOn(settings, 'posts') && criteria?.postQueries?.length ? ['posts'] : []),
  ];
}

/** What the criteria need with these sources: LinkedIn on asks for at least one search, said in words instead of the browser's «Completa este campo». */
export function criteriaProblem(settings: SearchSettings, criteria: { postQueries?: string[]; keywords?: string[] }) {
  if (sourceOn(settings, 'posts') && !criteria.postQueries?.length) return 'LinkedIn necesita al menos una búsqueda de publicaciones; escríbela o apaga LinkedIn en «Fuentes».';
  if ((sourceOn(settings, 'tenders') || sourceOn(settings, 'compraAgil')) && !criteria.keywords?.length) return 'Las licitaciones necesitan al menos una palabra; escríbela o apágalas en «Fuentes».';
  if (!SEARCH_SOURCES.some(source => sourceOn(settings, source))) return 'Deja al menos una fuente encendida.';
  return null;
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether a tender or Compra Ágil is out by the administrator's own rules, before the AI reads it: the amount out of the range, or a
 * buyer to avoid. The reason is the one the list shows. An amount the tender does not say is never a reason: it is read.
 */
export function tenderRuledOut(settings: SearchSettings, tender: { amount?: number | null; currency?: string | null; company?: string | null }) {
  const { minAmount, maxAmount, avoidBuyers } = settings.tenders;
  const amount = typeof tender.amount === 'number' && Number.isFinite(tender.amount) && (!tender.currency || tender.currency === 'CLP') ? tender.amount : null;
  if (amount !== null && minAmount !== null && amount < minAmount) return 'El monto está bajo el mínimo que definiste en «Qué buscamos».';
  if (amount !== null && maxAmount !== null && amount > maxAmount) return 'El monto supera el máximo que definiste en «Qué buscamos».';
  const buyer = fold(String(tender.company || ''));
  const avoided = buyer ? avoidBuyers.find(name => buyer.includes(fold(name))) : undefined;
  if (avoided) return `Es de ${avoided}, un organismo que pediste evitar.`;
  return null;
}

/** The preferences the AI weighs on tenders, only the ones set (so an empty set says nothing to it). */
export function tenderPreferences(settings: SearchSettings) {
  const { buyers, regions, unspsc } = settings.tenders;
  return {
    ...(buyers.length ? { organismosQueSeguimos: buyers } : {}),
    ...(regions.length ? { regionesPreferidas: regions } : {}),
    ...(unspsc.length ? { codigosUnspsc: unspsc } : {}),
  };
}

/** Whether an item of the tender is one of the UNSPSC codes asked for (a code of 2 to 8 digits matches the items that start with it). */
export const unspscMatch = (codes: readonly string[], items: ReadonlyArray<{ code?: string | null }>) =>
  codes.length > 0 && items.some(item => item.code && codes.some(code => String(item.code).replace(/\D/g, '').startsWith(code)));

/** «Qué buscamos» as the dialog edits it: one per line in the boxes, the sources as switches, the amounts as typed. */
export type CriteriaDraft = {
  keywords: string; postQueries: string; roles: string; decisionMakerTitles: string;
  sources: Record<SearchSource, boolean>; hiringEvery: 'day' | 'week';
  minAmount: string; maxAmount: string; regions: string[]; buyers: string; avoidBuyers: string; unspsc: string;
};
type Criteria = { keywords?: string[]; postQueries?: string[]; roles?: string[]; decisionMakerTitles?: string[] };
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
const amountText = (value: number | null) => (value === null ? '' : value.toLocaleString('es-CL'));

/** The draft of what is saved: the criteria the AI derived (or the admin corrected) and the settings. */
export function criteriaDraft(criteria: Criteria | null | undefined, rawSearch: unknown): CriteriaDraft {
  const settings = readSearchSettings(rawSearch);
  return {
    keywords: (criteria?.keywords || []).join('\n'), postQueries: (criteria?.postQueries || []).join('\n'), roles: (criteria?.roles || []).join('\n'),
    decisionMakerTitles: (criteria?.decisionMakerTitles || []).join('\n'),
    sources: Object.fromEntries(SEARCH_SOURCES.map(source => [source, sourceOn(settings, source)])) as Record<SearchSource, boolean>,
    hiringEvery: settings.hiringEvery, minAmount: amountText(settings.tenders.minAmount), maxAmount: amountText(settings.tenders.maxAmount),
    regions: settings.tenders.regions, buyers: settings.tenders.buyers.join('\n'), avoidBuyers: settings.tenders.avoidBuyers.join('\n'), unspsc: settings.tenders.unspsc.join(' '),
  };
}

/** An amount as a person types it («5.000.000», «5000000»): the digits, or null when empty. */
function amountOf(text: string) {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : null;
}

/** What the dialog saves, or what to fix first, in words. */
export function draftToSave(draft: CriteriaDraft): { criteria: Required<Criteria>; search: SearchSettings } | { problem: string } {
  const minAmount = amountOf(draft.minAmount), maxAmount = amountOf(draft.maxAmount);
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) return { problem: 'El monto mínimo no puede ser mayor que el máximo.' };
  const codes = draft.unspsc.split(/[\s,;]+/).map(code => code.trim()).filter(Boolean);
  const wrong = codes.find(code => !/^\d{2,8}$/.test(code));
  if (wrong) return { problem: `Los códigos UNSPSC tienen de 2 a 8 dígitos: revisa «${wrong}».` };
  const parsed = searchSettingsSchema.safeParse({
    sources: draft.sources, hiringEvery: draft.hiringEvery,
    tenders: { minAmount, maxAmount: maxAmount || null, regions: draft.regions, buyers: lines(draft.buyers), avoidBuyers: lines(draft.avoidBuyers), unspsc: [...new Set(codes)] },
  });
  if (!parsed.success) return { problem: parsed.error.issues[0]?.message || 'Revisa los datos.' };
  const criteria = { keywords: lines(draft.keywords), postQueries: lines(draft.postQueries), roles: lines(draft.roles), decisionMakerTitles: lines(draft.decisionMakerTitles) };
  const problem = criteriaProblem(parsed.data, criteria);
  return problem ? { problem } : { criteria, search: parsed.data };
}

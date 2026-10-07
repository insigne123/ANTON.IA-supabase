import { CHILE_REGIONS, chileanRegion } from './hiring';

/**
 * What a search of «Oportunidades» asks for (Plan 15), apart from how each source is called. The person picks the roles and
 * the regions when they search; each role also brings its variants, the other ways companies write it («cajero» is also
 * «operador de caja» and «cashier»; «cajera» and «cajeros» are already found by the role itself). Pure: the variants come
 * from search-ai.ts on the server, and here they are cleaned, turned into the questions for each source and mapped back to
 * the role they came from, so an ad for a «cashier» counts for «cajero».
 */
export type RoleVariants = Record<string, string[]>;

export const MAX_VARIANTS_PER_ROLE = 4;
export const MAX_SEARCH_ROLES = 15;
/** Google for Jobs questions of one search: a person who searches by hand sees the cost first; the daily search asks fewer. */
export const MANUAL_JSEARCH_QUERIES = 20;
export const DAILY_JSEARCH_QUERIES = 10;
/** LinkedIn takes the titles in one request, up to 30. */
export const LINKEDIN_TITLES = 30;

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
const clean = (value: unknown, max = 60) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Already found by the role itself: its gender and number forms («cajera», «Cajeros», «Cajero/a») and any title that says it
 * («guardia de seguridad», «cajero vendedor»). Asking for those would only spend questions on the same ads.
 */
function coveredByRole(role: string, variant: string) {
  const base = fold(role), other = fold(variant).replace(/\/\s*a\b/g, '');
  if (base === other) return true;
  const stem = (base.endsWith('o') ? base.slice(0, -1) : base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${stem}(?:o|a|os|as|es|s)?($|[^\\p{L}\\p{N}])`, 'u').test(other);
}

/** The roles of a search: trimmed, at least two letters, each once, at most MAX_SEARCH_ROLES. */
export function searchRoles(values: unknown[]): string[] {
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const value of values) {
    const role = clean(value, 80);
    if (role.length < 2 || seen.has(fold(role))) continue;
    seen.add(fold(role));
    roles.push(role);
    if (roles.length >= MAX_SEARCH_ROLES) break;
  }
  return roles;
}

/**
 * The variants of each role as the model proposed them, kept only when they add something: never what the role already
 * finds, never another role of the search, each once, at most MAX_VARIANTS_PER_ROLE.
 */
export function cleanRoleVariants(roles: string[], proposed: Record<string, unknown> | null | undefined): RoleVariants {
  const taken = new Set(roles.map(fold));
  const result: RoleVariants = {};
  for (const role of roles) {
    const raw = proposed?.[role] ?? Object.entries(proposed || {}).find(([key]) => fold(key) === fold(role))?.[1];
    const list = Array.isArray(raw) ? raw : [];
    const kept: string[] = [];
    for (const item of list) {
      const variant = clean(item);
      if (variant.length < 2 || taken.has(fold(variant)) || coveredByRole(role, variant)) continue;
      taken.add(fold(variant));
      kept.push(variant);
      if (kept.length >= MAX_VARIANTS_PER_ROLE) break;
    }
    if (kept.length) result[role] = kept;
  }
  return result;
}

/** How a region is named in a job search: the Región Metropolitana is searched as Santiago. */
export function regionQueryName(region: string) {
  return region === 'Metropolitana' ? 'Santiago' : region;
}

/** The regions of «Tu cliente ideal» in «Perfil» («Santiago, Antofagasta y Calama») as the regions of the country. */
export function regionsFromPlaces(places: string[]): string[] {
  const found = new Set<string>();
  for (const place of places) {
    const region = chileanRegion(place) ?? CHILE_REGIONS.find(item => fold(item) === fold(place));
    if (region) found.add(region);
  }
  return CHILE_REGIONS.filter(region => found.has(region));
}

/**
 * The Google for Jobs questions of a search: each role in each region (or in all of Chile), the roles first and then their
 * variants, each once, up to `cap`. What does not fit is reported, so the screen can say it.
 */
export function hiringQueries(roles: string[], variants: RoleVariants, regions: string[], cap: number) {
  const places = regions.length ? regions.map(regionQueryName) : [''];
  const terms = [...roles, ...roles.flatMap(role => variants[role] || [])];
  const all: string[] = [];
  const seen = new Set<string>();
  for (const term of terms) {
    for (const place of places) {
      const query = place ? `${term} ${place}` : term;
      if (seen.has(fold(query))) continue;
      seen.add(fold(query));
      all.push(query);
    }
  }
  return { queries: all.slice(0, Math.max(0, cap)), left: Math.max(0, all.length - cap) };
}

/** The titles LinkedIn is asked for: the roles and then their variants, up to LINKEDIN_TITLES. */
export function linkedinTitles(roles: string[], variants: RoleVariants) {
  return [...new Set([...roles, ...roles.flatMap(role => variants[role] || [])])].slice(0, LINKEDIN_TITLES);
}

/** The places LinkedIn is asked for: each chosen region in Chile, or all of Chile. */
export function linkedinLocations(regions: string[]) {
  return regions.length ? regions.map(region => `${regionQueryName(region)}, Chile`) : ['Chile'];
}

import { ALL_SEARCH_RESULTS } from '@/lib/search/limits';
import { classifyTitles, rankByTitle, titleSearchTerms, type TitleAiDeps } from './title-ai';

/**
 * The people of one company found by title meaning (src/lib/server/search/title-ai.ts), with Apollo's people search (free, but 200 calls a
 * minute for the whole account, and a person can ask for fifteen companies at once):
 * - a company of up to SMALL_COMPANY people is read whole (one to three calls) and every title classified;
 * - a larger one is read by what Apollo can match: the asked titles as people write them (one call) and the words of their area (up to three
 *   calls: at Codelco, «seguridad», «salud», «medio ambiente», «incendios» and «riesgos» were 214 people), with the first page of everyone
 *   already read; then classified. At most five calls a company, in three rounds.
 * Exact first, then similar, then related. Without titles, everyone (for «0 = todos», up to ALL_SEARCH_RESULTS).
 * The list is kept a few minutes per company and question, so «Traer más» reads the next page from it instead of asking again.
 */

type Answer = { ok: true; json: any } | { ok: false; error: string };
export type RunSearch = (payload: Record<string, unknown>) => Promise<Answer>;

const PAGE = 100;
const PARALLEL = 3;
/** A company read whole when asking by title: up to three pages of a hundred. */
export const SMALL_COMPANY = 300;
/** Pages of the area words read at a larger company. */
const KEYWORD_PAGES = 3;
const CACHE_MS = 10 * 60 * 1_000;
const CACHE_ENTRIES = 200;
const cache = new Map<string, { at: number; people: any[]; scanned: number; total: number | null; strategy: Strategy }>();
type Strategy = 'everyone' | 'titles';

export function clearCompanyPeopleCache() {
  cache.clear();
}

const rawCount = (json: any) => Number(json?.raw_count ?? (Array.isArray(json?.leads) ? json.leads.length : 0));
const totalOf = (json: any) => (Number.isFinite(Number(json?.total_entries)) && json?.total_entries !== null ? Number(json.total_entries) : null);

/** People by Apollo id, once each, in the order they came. */
function collector() {
  const people: any[] = [];
  const seen = new Set<string>();
  return {
    people,
    add(json: any) {
      for (const lead of Array.isArray(json?.leads) ? json.leads : []) {
        const id = String(lead?.id || '').trim();
        if (id && !seen.has(id)) { seen.add(id); people.push(lead); }
      }
    },
  };
}

function asker(base: Record<string, unknown>, run: RunSearch) {
  return (page: number, titles: string[] = [], similar = false) => run({
    ...base, titles, include_similar_titles: titles.length ? similar : false, page, per_page: PAGE, exclude_person_ids: [],
  });
}

/** Pages from..to of one question, three at a time; a page that fails or comes short ends it (the list is shorter, never wrong). */
async function readPages(ask: (page: number) => Promise<Answer>, from: number, to: number, into: ReturnType<typeof collector>) {
  for (let page = from; page <= to; page += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL, to - page + 1) }, (_, index) => ask(page + index)));
    let short = false;
    for (const answer of batch) {
      if (!answer.ok) { short = true; break; }
      into.add(answer.json);
      if (rawCount(answer.json) < PAGE) short = true;
    }
    if (short) return;
  }
}

/** Everyone of the company Apollo has, up to `limit`: the first page says how many. */
async function everyone(base: Record<string, unknown>, run: RunSearch, limit: number):
  Promise<{ ok: true; people: any[]; total: number | null } | { ok: false; error: string }> {
  const ask = asker(base, run);
  const first = await ask(1);
  if (!first.ok) return first;
  const found = collector();
  found.add(first.json);
  const total = totalOf(first.json);
  const pages = rawCount(first.json) < PAGE ? 1 : Math.min(Math.ceil(limit / PAGE), Math.ceil((total ?? limit) / PAGE));
  await readPages(ask, 2, pages, found);
  return { ok: true, people: found.people, total };
}

/** The people a title search keeps reading: the whole company when it is small, else what Apollo can match by title and area words. */
async function forTitles(base: Record<string, unknown>, titles: string[], run: RunSearch, deps?: TitleAiDeps):
  Promise<{ ok: true; people: any[]; total: number | null; strategy: Strategy } | { ok: false; error: string }> {
  const ask = asker(base, run);
  const first = await ask(1);
  if (!first.ok) return first;
  const found = collector();
  found.add(first.json);
  const total = totalOf(first.json);
  if (rawCount(first.json) < PAGE || (total !== null && total <= SMALL_COMPANY)) {
    const pages = rawCount(first.json) < PAGE ? 1 : Math.min(SMALL_COMPANY / PAGE, Math.ceil((total ?? PAGE) / PAGE));
    await readPages(ask, 2, pages, found);
    return { ok: true, people: found.people, total, strategy: 'everyone' };
  }
  const terms = await titleSearchTerms(titles, deps).catch(() => ({ titles, keywords: [] as string[] }));
  const similar = base.include_similar_titles !== false;
  const [precise, area] = await Promise.all([
    ask(1, terms.titles, similar),
    terms.keywords.length ? ask(1, terms.keywords) : Promise.resolve(null),
  ]);
  if (precise.ok) found.add(precise.json);
  if (area?.ok) {
    found.add(area.json);
    if (rawCount(area.json) >= PAGE) await readPages((page) => ask(page, terms.keywords), 2, KEYWORD_PAGES, found);
  }
  return { ok: true, people: found.people, total, strategy: 'titles' };
}

export async function companyPeopleByTitle(input: {
  /** The organization_people payload of the search (provider, user, organization, seniorities, places). */
  base: Record<string, unknown>;
  titles: string[];
  page: number;
  perPage: number;
  /** «0 = todos»: the whole list in one answer. */
  all: boolean;
  excludeIds: string[];
  run: RunSearch;
  cacheKey: string;
  deps?: TitleAiDeps;
}): Promise<Answer> {
  let entry = cache.get(input.cacheKey);
  if (!entry || Date.now() - entry.at > CACHE_MS) {
    const found = input.titles.length
      ? await forTitles(input.base, input.titles, input.run, input.deps)
      : await everyone(input.base, input.run, ALL_SEARCH_RESULTS).then((answer) => (answer.ok ? { ...answer, strategy: 'everyone' as const } : answer));
    if (!found.ok) return found;
    const people = input.titles.length
      ? rankByTitle(found.people, await classifyTitles(input.titles, found.people.map((person) => String(person?.title || '')), input.deps))
      : found.people;
    entry = { at: Date.now(), people, scanned: found.people.length, total: found.total, strategy: found.strategy };
    if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(input.cacheKey, entry);
  }
  const excluded = new Set(input.excludeIds.map(String));
  const people = entry.people.filter((person) => !excluded.has(String(person?.id || '')));
  const perPage = input.all ? ALL_SEARCH_RESULTS : Math.max(1, input.perPage);
  const page = input.all ? 1 : Math.max(1, input.page);
  const slice = people.slice((page - 1) * perPage, page * perPage);
  return {
    ok: true,
    json: {
      count: slice.length,
      raw_count: slice.length,
      leads: slice,
      search_mode: 'organization_people',
      search_strategy: 'organizations_then_people',
      organization_id: input.base.organization_id,
      page,
      per_page: perPage,
      total_entries: people.length,
      total_pages: Math.max(1, Math.ceil(people.length / perPage)),
      enrichment_requested: false,
      organization_search_credits: 0,
      title_matching: input.titles.length ? 'ai' : undefined,
      title_strategy: input.titles.length ? entry.strategy : undefined,
      people_scanned: entry.scanned,
      company_people_total: entry.total,
    },
  };
}

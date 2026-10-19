import type { SupabaseClient } from '@supabase/supabase-js';
import {
  agencyKeyVariants, agencyTokens, bestAgencyMatch, foldForSearch, likePatterns, marketStats, normalizeRut, pickSimilar, searchWords, topicTokens, type MarketStats, type MarketTender,
} from '@/lib/public-procurement/market';

type Client = Pick<SupabaseClient, 'from' | 'rpc'>;

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST200', 'PGRST202', '42883']);

/** A row of public_procurement_search (or of the tables with their joins) as the pages and the model read it. */
export function toMarketTender(row: any): MarketTender {
  const bids = ((row.bids || []) as any[]).map(bid => ({
    rut: String(bid.rut ?? bid.supplier?.rut ?? ''), name: String(bid.name ?? bid.supplier?.name ?? ''), offered: bid.offered ?? bid.offered_amount ?? null,
    selected: Boolean(bid.selected), awarded: bid.awarded ?? bid.awarded_amount ?? null,
  })).filter(bid => bid.rut);
  return {
    id: Number(row.id), code: String(row.code), name: String(row.name), agency: (typeof row.agency === 'string' ? row.agency : row.agency?.name) ?? null, status: row.status, kind: row.kind ?? null,
    currency: row.currency ?? null, estimatedAmount: row.estimated_amount === null || row.estimated_amount === undefined ? null : Number(row.estimated_amount),
    awardedAmount: row.awarded_amount === null || row.awarded_amount === undefined ? null : Number(row.awarded_amount), bidders: row.bidders ?? null,
    publishedOn: row.published_on ?? null, awardedOn: row.awarded_on ?? null, durationMonths: row.duration_months === null || row.duration_months === undefined ? null : Number(row.duration_months),
    category: row.category ?? null, criteria: row.criteria ?? null,
    winners: bids.filter(bid => bid.selected).map(bid => ({ rut: bid.rut, name: bid.name, amount: bid.awarded === null ? null : Number(bid.awarded) }))
      .sort((a, b) => (b.amount || 0) - (a.amount || 0)),
    bids: bids.map(({ awarded: _awarded, ...bid }) => ({ ...bid, offered: bid.offered === null ? null : Number(bid.offered) }))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || (a.offered ?? Infinity) - (b.offered ?? Infinity)),
  };
}

/** Whether ChileCompra's history is loaded, and up to when: the views say «aún no cargamos el historial» otherwise. */
export async function readMarketCoverage(client: Client) {
  const { data, error } = await client.from('public_procurement_loads').select('source_month,scope,loaded_at').order('source_month', { ascending: false }).limit(60);
  if (error) return { available: false, from: null as string | null, to: null as string | null, loadedAt: null as string | null };
  const rows = (data || []) as Array<{ source_month: string; scope: string; loaded_at: string }>;
  if (!rows.length) return { available: false, from: null, to: null, loadedAt: null };
  return { available: true, from: rows.at(-1)!.source_month, to: rows[0].source_month, loadedAt: rows.map(row => row.loaded_at).sort().at(-1) || null };
}

export type MarketAgency = { ids: number[]; name: string; sector: string | null };

/**
 * The agency behind a buyer's name, as ChileCompra writes it: the same name or one of its spellings first, then the
 * agency whose name holds every word of the buyer's. ChileCompra gives one buyer several codes (one per unit), so the
 * answer carries every code with that name.
 */
export async function findAgency(client: Client, buyerName: string | null | undefined): Promise<MarketAgency | null> {
  const variants = agencyKeyVariants(buyerName);
  if (!variants.length) return null;
  const columns = 'id,name,sector,name_key';
  const exact = await client.from('public_procurement_agencies').select(columns).in('name_key', variants).limit(100);
  if (exact.error) { if (MISSING.has(String(exact.error.code))) return null; throw exact.error; }
  let rows = (exact.data || []) as Array<{ id: number; name: string; sector: string | null; name_key: string }>;
  let key = variants.find(variant => rows.some(row => row.name_key === variant)) ?? null;
  if (!key) {
    // The two longest words narrow the search; every word must then be in the name.
    const words = agencyTokens(buyerName).sort((a, b) => b.length - a.length).slice(0, 2);
    if (words.length < 2) return null;
    let query = client.from('public_procurement_agencies').select(columns);
    for (const word of words) query = query.ilike('name_key', `%${word}%`);
    const near = await query.limit(400);
    if (near.error || !near.data?.length) return null;
    rows = near.data as typeof rows;
    key = bestAgencyMatch(buyerName, rows)?.name_key ?? null;
  }
  if (!key) return null;
  const same = rows.filter(row => row.name_key === key);
  return { ids: same.map(row => Number(row.id)), name: same[0].name, sector: same[0].sector };
}

/** The tenders whose name or category says one of the words (or one of their other ways of saying it), newest first. */
async function tendersSaying(client: Client, words: string[], filter: { agencyIds?: number[]; since: string; limit: number }) {
  const patterns = likePatterns(searchWords(words), 10);
  if (!patterns.length) return [];
  const { data, error } = await client.rpc('public_procurement_search', { p_patterns: patterns, p_agency_ids: filter.agencyIds?.length ? filter.agencyIds : null,
    p_since: filter.since, p_limit: filter.limit });
  if (error) { if (MISSING.has(String(error.code))) return []; throw error; }
  return ((data || []) as any[]).map(toMarketTender);
}

const monthsAgo = (now: Date, months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)).toISOString().slice(0, 10);

export type AgencyHistory = {
  available: boolean;
  agency: MarketAgency | null;
  /** This buyer's past tenders most like this one, with who won and how many bid. */
  similar: Array<MarketTender & { score: number }>;
  agencyStats: MarketStats | null;
  /** The same kind of tender bought by other buyers in the last 12 months. */
  market: { similar: Array<MarketTender & { score: number }>; stats: MarketStats } | null;
  coverage: Awaited<ReturnType<typeof readMarketCoverage>>;
};

/**
 * «Este organismo» for one tender: what its buyer bought before that looks like it (36 months), and what the rest of the
 * market paid for the same in the last 12. Read only from ChileCompra's open data.
 */
export async function readAgencyHistory(client: Client, input: { title: string; buyerName: string | null }, now = new Date()): Promise<AgencyHistory> {
  const coverage = await readMarketCoverage(client);
  if (!coverage.available) return { available: false, agency: null, similar: [], agencyStats: null, market: null, coverage };
  const words = topicTokens(input.title).slice(0, 6);
  const agency = await findAgency(client, input.buyerName);
  const own = agency ? await tendersSaying(client, words, { agencyIds: agency.ids, since: monthsAgo(now, 36), limit: 300 }) : [];
  const similar = pickSimilar(input.title, own, 8).map(item => ({ ...item.tender, score: Math.round(item.score * 100) / 100 }));
  const others = (await tendersSaying(client, words, { since: monthsAgo(now, 12), limit: 400 })).filter(tender => !agency || tender.agency !== agency.name);
  const marketSimilar = pickSimilar(input.title, others, 30).map(item => ({ ...item.tender, score: Math.round(item.score * 100) / 100 }));
  return {
    available: true, agency, similar,
    agencyStats: similar.length ? marketStats(similar) : null,
    market: marketSimilar.length ? { similar: marketSimilar.slice(0, 8), stats: marketStats(marketSimilar) } : null,
    coverage,
  };
}

export type SupplierProfile = {
  supplier: { id: number; rut: string; name: string };
  bids: number;
  wins: number;
  awarded: number;
  /** Median of their offer against the buyer's estimate, in pesos. */
  medianOfferRatio: number | null;
  agencies: Array<{ name: string; bids: number; wins: number }>;
  categories: Array<{ name: string; bids: number; wins: number }>;
  recent: Array<Pick<MarketTender, 'code' | 'name' | 'agency' | 'publishedOn' | 'status' | 'estimatedAmount' | 'currency'> & { offered: number | null; won: boolean }>;
};

export async function findSupplier(client: Client, value: string) {
  const rut = normalizeRut(value);
  const query = client.from('public_procurement_suppliers').select('id,rut,name');
  const { data, error } = rut ? await query.eq('rut', rut).limit(1) : await query.eq('id', Number(value)).limit(1);
  if (error) { if (MISSING.has(String(error.code))) return null; throw error; }
  return (data?.[0] as { id: number; rut: string; name: string } | undefined) ?? null;
}

/** By RUT, or by name (at least 3 letters): the suppliers that bid in public tenders, most active first. */
export async function searchSuppliers(client: Client, query: string) {
  const rut = normalizeRut(query);
  if (rut && /\d{6,}/.test(query.replace(/\D/g, ''))) {
    const found = await findSupplier(client, rut);
    return found ? [found] : [];
  }
  const text = foldForSearch(query).replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 3) return [];
  const { data, error } = await client.rpc('public_procurement_find_suppliers', { p_pattern: `%${text}%`, p_limit: 20 });
  if (error) { if (MISSING.has(String(error.code))) return []; throw error; }
  return (data || []) as Array<{ id: number; rut: string; name: string }>;
}

/** What a supplier did in public tenders in the data: where it bids, how much it wins and at what price. */
export async function readSupplierProfile(client: Client, supplierId: number): Promise<SupplierProfile | null> {
  const supplier = await findSupplier(client, String(supplierId));
  if (!supplier) return null;
  const { data, error } = await client.from('public_procurement_bids')
    .select('selected,offered_amount,awarded_amount,tender:public_procurement_tenders(code,name,status,currency,estimated_amount,published_on,category,agency:public_procurement_agencies(name))')
    .eq('supplier_id', supplierId).limit(2000);
  if (error) throw error;
  const rows = ((data || []) as any[]).filter(row => row.tender);
  const count = (key: (row: any) => string | null) => {
    const map = new Map<string, { name: string; bids: number; wins: number }>();
    for (const row of rows) {
      const name = key(row); if (!name) continue;
      const entry = map.get(name) || { name, bids: 0, wins: 0 };
      entry.bids++; if (row.selected) entry.wins++;
      map.set(name, entry);
    }
    return [...map.values()].sort((a, b) => b.wins - a.wins || b.bids - a.bids).slice(0, 6);
  };
  const ratios = rows.filter(row => row.tender.currency === 'CLP' && row.tender.estimated_amount && row.offered_amount)
    .map(row => row.offered_amount / row.tender.estimated_amount).filter(ratio => ratio >= 0.2 && ratio <= 2).sort((a, b) => a - b);
  const medianRatio = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2) : null;
  return {
    supplier,
    bids: rows.length,
    wins: rows.filter(row => row.selected).length,
    awarded: rows.filter(row => row.selected && row.tender.currency === 'CLP').reduce((sum, row) => sum + (row.awarded_amount || 0), 0),
    medianOfferRatio: medianRatio,
    agencies: count(row => row.tender.agency?.name ?? null),
    categories: count(row => row.tender.category ?? null),
    recent: rows.sort((a, b) => String(b.tender.published_on || '').localeCompare(String(a.tender.published_on || ''))).slice(0, 10).map(row => ({
      code: row.tender.code, name: row.tender.name, agency: row.tender.agency?.name ?? null, publishedOn: row.tender.published_on, status: row.tender.status,
      estimatedAmount: row.tender.estimated_amount, currency: row.tender.currency, offered: row.offered_amount, won: Boolean(row.selected),
    })),
  };
}

/**
 * The competitors to watch: with the company's own RUT (its «Ficha para licitaciones»), whoever bids most in the same
 * tenders; without it, whoever wins most in the tenders that say the workspace's words.
 */
export async function suggestCompetitors(client: Client, input: { ownRut: string | null; words: string[] }, now = new Date()) {
  const since = monthsAgo(now, 12);
  const own = input.ownRut ? await findSupplier(client, input.ownRut) : null;
  if (own) {
    const { data, error } = await client.rpc('public_procurement_cobidders', { p_supplier: own.id, p_since: since, p_limit: 12 });
    if (!error && data?.length) {
      return { basis: 'cobidders' as const, own, items: (data as any[]).map(row => ({ id: row.supplier_id, rut: row.rut, name: row.name, shared: row.shared, wins: row.their_wins })) };
    }
  }
  const patterns = likePatterns(input.words, 25);
  if (!patterns.length) return { basis: 'none' as const, own, items: [] };
  const { data, error } = await client.rpc('public_procurement_top_winners', { p_patterns: patterns, p_since: since, p_limit: 12 });
  if (error) { if (MISSING.has(String(error.code)) || error.code === 'PGRST202') return { basis: 'none' as const, own, items: [] }; throw error; }
  return { basis: 'keywords' as const, own, items: ((data || []) as any[]).map(row => ({ id: row.supplier_id, rut: row.rut, name: row.name, bids: row.bids, wins: row.wins, awarded: Number(row.awarded) })) };
}

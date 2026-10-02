import { groupHiring, type JobAd } from '@/lib/commercial-opportunities/hiring';
import {
  HIRING_WINDOW_DAYS, hiringOpportunityRow, hiringSignalRow, type HiringOpportunityRow, type HiringSignalRow,
} from '@/lib/commercial-opportunities/records';
import { formatUsd } from '@/lib/commercial-opportunities/view';
import { JSEARCH_USD_PER_REQUEST, searchJSearch } from './jsearch';
import { fantasticUsdPerJob, searchFantasticJobs } from './fantastic-jobs';

/**
 * One search of «empresas contratando» (plan 8, phase 3): asks each source with a key for the ads of the profile's roles,
 * regroups every ad of the last 30 days by company and saves the companies with their evidence. Each source run is recorded
 * with what it brought and what it cost; the month's total is capped before anything is spent.
 */
export type HiringSyncSource = 'jsearch' | 'linkedin';
export type HiringSearchProfile = { id: string; name: string; offer: string; roles: string[]; regions: string[]; minAds: number };
export type HiringSyncEnvironment = { jsearchKey?: string; apifyToken?: string; usdPerJob: number };

export const JSEARCH_QUERIES = 10;
export const LINKEDIN_LIMIT = 200;
export const DEFAULT_MONTHLY_CAP_USD = 10;
/** A run still «running» after this long was cut (a deploy, a timeout) and no longer blocks a new search. */
const STALE_RUN_MS = 15 * 60_000;
const DAY = 86_400_000;
const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function hiringSyncEnvironment(env: Record<string, string | undefined> = process.env): HiringSyncEnvironment {
  return { jsearchKey: env.JSEARCH_API_KEY || undefined, apifyToken: env.APIFY_TOKEN || undefined, usdPerJob: fantasticUsdPerJob(env.APIFY_FANTASTIC_USD_PER_JOB) };
}

export function monthlyCapUsd(configured = process.env.OPPORTUNITIES_MONTHLY_USD_CAP) {
  const value = Number(configured);
  return configured !== undefined && configured !== '' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MONTHLY_CAP_USD;
}

/** What a search will ask and what it may cost, shown before the person runs it. A source without its key is listed as missing. */
export function hiringSyncPlan(profile: Pick<HiringSearchProfile, 'roles'>, env: HiringSyncEnvironment) {
  const queries = profile.roles.slice(0, JSEARCH_QUERIES);
  const sources = [
    { source: 'jsearch' as const, label: 'Google for Jobs (JSearch)', enabled: Boolean(env.jsearchKey) && queries.length > 0,
      requests: queries.length, estimateUsd: round(queries.length * JSEARCH_USD_PER_REQUEST), missing: env.jsearchKey ? null : 'JSEARCH_API_KEY' },
    { source: 'linkedin' as const, label: 'LinkedIn (Fantastic Jobs)', enabled: Boolean(env.apifyToken) && profile.roles.length > 0,
      requests: LINKEDIN_LIMIT, estimateUsd: round(LINKEDIN_LIMIT * env.usdPerJob), missing: env.apifyToken ? null : 'APIFY_TOKEN' },
  ];
  return { sources, estimateUsd: round(sources.filter(item => item.enabled).reduce((sum, item) => sum + item.estimateUsd, 0)) };
}
export type HiringSyncPlan = ReturnType<typeof hiringSyncPlan>;

export function monthStart(now: string) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

/** Where a sync reads and writes. The Supabase implementation is in store.ts; the tests use one in memory. */
export type HiringStore = {
  monthSpentUsd(since: string): Promise<number>;
  closeStaleRuns(before: string, now: string): Promise<void>;
  hasRunningRun(since: string): Promise<boolean>;
  startRun(input: { source: HiringSyncSource; status: 'running' | 'skipped'; error?: string; costUsd?: number; finishedAt?: string }): Promise<string>;
  finishRun(id: string, patch: { status: 'succeeded' | 'failed'; fetched: number; created: number; updated: number; costUsd: number; error: string | null; finishedAt: string }): Promise<void>;
  recentSignals(since: string): Promise<JobAd[]>;
  knownCompanies(): Promise<{ clients: string[]; contactsCompanies: string[] }>;
  existingKeys(keys: string[]): Promise<Set<string>>;
  saveOpportunities(rows: HiringOpportunityRow[]): Promise<Map<string, string>>;
  saveSignals(rows: HiringSignalRow[]): Promise<void>;
};

export class HiringSyncError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'HiringSyncError'; }
}

type Sources = { jsearch: typeof searchJSearch; fantastic: typeof searchFantasticJobs };
type SourceResult = { source: HiringSyncSource; runId: string; ads: JobAd[]; costUsd: number; error: string | null; failed: boolean };

/** A source's message is kept short and never carries a key (the clients already keep keys out of their errors). */
const message = (error: unknown) => (error instanceof Error ? error.message : 'Error desconocido.').slice(0, 300);

async function runJSearch(roles: string[], search: Sources['jsearch'], key: string) {
  const ads: JobAd[] = [];
  const failures: string[] = [];
  let costUsd = 0, asked = 0, answered = 0;
  // Three at a time: the whole search stays within seconds and under the plan's rate limit.
  for (let index = 0; index < roles.length; index += 3) {
    const batch = roles.slice(index, index + 3);
    asked += batch.length;
    const results = await Promise.allSettled(batch.map(role => search({ query: role, numPages: 1, datePosted: 'month' },
      { fetch: globalThis.fetch, key })));
    for (const result of results) {
      if (result.status === 'fulfilled') { answered++; ads.push(...result.value.ads); costUsd += result.value.costUsd; }
      else failures.push(message(result.reason));
    }
    // A rejected key or an exhausted plan fails every query: stop asking.
    if (failures.some(item => /clave|suscripci|cupo/i.test(item))) break;
  }
  return {
    ads, costUsd: round(costUsd), failed: answered === 0,
    error: failures.length ? `${failures.length} de ${asked} consultas fallaron: ${[...new Set(failures)].slice(0, 2).join(' ')}` : null,
  };
}

export async function runHiringSync(input: {
  store: HiringStore; profile: HiringSearchProfile; env: HiringSyncEnvironment; capUsd: number; organizationId: string;
  now?: string; sources?: Sources;
  /** Only these sources (the daily sync asks the cheap one); every source with its key when absent. */
  only?: HiringSyncSource[];
}) {
  const now = input.now ?? new Date().toISOString();
  const sources = input.sources ?? { jsearch: searchJSearch, fantastic: searchFantasticJobs };
  const { store, profile, env } = input;
  const full = hiringSyncPlan(profile, env);
  const chosen = full.sources.filter(item => !input.only || input.only.includes(item.source));
  const plan = { sources: chosen, estimateUsd: round(chosen.filter(item => item.enabled).reduce((sum, item) => sum + item.estimateUsd, 0)) };
  const enabled = plan.sources.filter(item => item.enabled);
  if (!profile.roles.length) throw new HiringSyncError('Agrega al menos un cargo a la búsqueda.', 400);
  if (!enabled.length) throw new HiringSyncError('No hay fuentes con su clave configurada (JSEARCH_API_KEY o APIFY_TOKEN).', 503);

  const staleBefore = new Date(Date.parse(now) - STALE_RUN_MS).toISOString();
  await store.closeStaleRuns(staleBefore, now);
  if (await store.hasRunningRun(staleBefore)) throw new HiringSyncError('Ya hay una búsqueda en curso. Espera a que termine.', 409);

  const spentUsd = await store.monthSpentUsd(monthStart(now));
  if (spentUsd + plan.estimateUsd > input.capUsd) {
    const error = `Tope mensual: ${formatUsd(spentUsd)} gastados de ${formatUsd(input.capUsd)}; esta búsqueda costaría hasta ${formatUsd(plan.estimateUsd)}.`;
    for (const item of enabled) await store.startRun({ source: item.source, status: 'skipped', error, finishedAt: now });
    return { status: 'capped' as const, spentUsd: round(spentUsd), capUsd: input.capUsd, estimateUsd: plan.estimateUsd, message: error };
  }

  const runs = await Promise.all(enabled.map(async item => ({ source: item.source, runId: await store.startRun({ source: item.source, status: 'running' }) })));
  const results: SourceResult[] = await Promise.all(runs.map(async ({ source, runId }): Promise<SourceResult> => {
    try {
      if (source === 'jsearch') {
        const result = await runJSearch(profile.roles.slice(0, JSEARCH_QUERIES), sources.jsearch, env.jsearchKey!);
        return { source, runId, ...result };
      }
      const result = await sources.fantastic({ titles: profile.roles, limit: LINKEDIN_LIMIT, timeRange: '7d' },
        { fetch: globalThis.fetch, token: env.apifyToken, usdPerJob: env.usdPerJob });
      return { source, runId, ads: result.ads, costUsd: result.costUsd, error: null, failed: false };
    } catch (error) {
      return { source, runId, ads: [], costUsd: 0, error: message(error), failed: true };
    }
  }));

  const finish = (result: SourceResult, counts: { created: number; updated: number }, error = result.error) => store.finishRun(result.runId, {
    status: result.failed ? 'failed' : 'succeeded', fetched: result.ads.length, ...counts, costUsd: result.costUsd, error,
    finishedAt: new Date().toISOString(),
  });
  try {
    const fresh = results.flatMap(result => result.ads);
    // Every ad of the window is regrouped, so a company with three ads yesterday and three today reaches the minimum.
    const byId = new Map<string, JobAd>();
    for (const ad of await store.recentSignals(new Date(Date.parse(now) - HIRING_WINDOW_DAYS * DAY).toISOString())) byId.set(`${ad.source}|${ad.externalId}`, ad);
    for (const ad of fresh) byId.set(`${ad.source}|${ad.externalId}`, ad);
    const known = await store.knownCompanies();
    // Every company with an ad is saved (minimum 1) so its ads are kept; the page lists those that reach the profile's minimum.
    const grouped = groupHiring([...byId.values()], { roles: profile.roles, regions: profile.regions, minAds: 1, ...known },
      { now, windowDays: HIRING_WINDOW_DAYS });
    const rows = grouped.opportunities.map(item => hiringOpportunityRow(item, { organizationId: input.organizationId, profileId: profile.id }, now));
    const existing = await store.existingKeys(rows.map(row => row.dedupe_key));
    const ids = rows.length ? await store.saveOpportunities(rows) : new Map<string, string>();
    const freshKeys = new Set(fresh.map(ad => `${ad.source}|${ad.externalId}`));
    const signals = grouped.opportunities.flatMap(item => {
      const opportunityId = ids.get(item.key.slice(0, 300));
      return opportunityId ? item.signals.filter(ad => freshKeys.has(`${ad.source}|${ad.externalId}`))
        .map(ad => hiringSignalRow(ad, { organizationId: input.organizationId, opportunityId }, now)) : [];
    });
    if (signals.length) await store.saveSignals(signals);

    // New and refreshed companies are counted for each source that brought one of their ads this time.
    const counts = new Map<HiringSyncSource, { created: number; updated: number }>(results.map(result => [result.source, { created: 0, updated: 0 }]));
    for (const item of grouped.opportunities) {
      const brought = new Set(item.signals.filter(ad => freshKeys.has(`${ad.source}|${ad.externalId}`)).map(ad => ad.source));
      for (const source of brought) {
        const count = counts.get(source as HiringSyncSource);
        if (count) existing.has(item.key.slice(0, 300)) ? count.updated++ : count.created++;
      }
    }
    for (const result of results) await finish(result, counts.get(result.source)!);
    const qualifying = grouped.opportunities.filter(item => item.ads >= profile.minAds);
    return {
      status: 'done' as const,
      fetched: fresh.length,
      companies: rows.length,
      qualifying: qualifying.length,
      created: rows.filter(row => !existing.has(row.dedupe_key)).length,
      newQualifying: qualifying.filter(item => !existing.has(item.key.slice(0, 300))).length,
      costUsd: round(results.reduce((sum, result) => sum + result.costUsd, 0)),
      skipped: grouped.skipped,
      sources: results.map(result => ({ source: result.source, fetched: result.ads.length, costUsd: result.costUsd, error: result.error })),
    };
  } catch (error) {
    const failure = `No se pudo guardar: ${message(error)}`;
    for (const result of results) await finish({ ...result, failed: true }, { created: 0, updated: 0 }, failure).catch(() => undefined);
    throw error;
  }
}

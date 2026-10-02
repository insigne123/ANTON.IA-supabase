import { jobAdFromFantastic, type JobAd } from '@/lib/commercial-opportunities/hiring';

/**
 * The LinkedIn Job Search API of Fantastic Jobs, run as an Apify actor with the APIFY_TOKEN the app already has. Apify bills
 * each job by plan (US$0.005 on the free and Bronze plans, 0.0035 on Silver, 0.0015 from Gold): APIFY_FANTASTIC_USD_PER_JOB
 * says which one applies. Agencies are removed at the source, descriptions are not requested, and the recruiter fields that
 * come with each job are dropped by jobAdFromFantastic.
 */
export const FANTASTIC_ACTOR = 'fantastic-jobs~advanced-linkedin-job-search-api';
const DEFAULT_USD_PER_JOB = 0.005;

export type FantasticQuery = { titles: string[]; locations?: string[]; timeRange?: '24h' | '7d' | '6m'; limit?: number };
type Dependencies = { fetch: typeof fetch; token: string | undefined; usdPerJob?: number };

export async function searchFantasticJobs(input: FantasticQuery, dependencies: Dependencies = {
  fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, usdPerJob: Number(process.env.APIFY_FANTASTIC_USD_PER_JOB) || DEFAULT_USD_PER_JOB,
}) {
  if (!dependencies.token) throw new Error('Falta el token de Apify (APIFY_TOKEN).');
  const limit = Math.max(10, Math.min(1000, input.limit ?? 200));
  const body = {
    timeRange: input.timeRange ?? '7d', limit, removeAgency: true, descriptionType: '',
    // «operari:*» also finds «operaria» and «operarios»; a title of several words goes as a phrase.
    titleSearch: input.titles.slice(0, 30).map(title => /\s/.test(title.trim()) ? title.trim() : `${title.trim().replace(/[oa]s?$/i, '')}:*`),
    locationSearch: input.locations?.length ? input.locations.slice(0, 20) : ['Chile'],
  };
  const response = await dependencies.fetch(`https://api.apify.com/v2/acts/${FANTASTIC_ACTOR}/run-sync-get-dataset-items?timeout=180&memory=1024`, {
    method: 'POST', headers: { authorization: `Bearer ${dependencies.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(200_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Apify rechazó el token.');
  if (response.status === 402) throw new Error('Apify: no queda saldo en la cuenta.');
  if (!response.ok) throw new Error(`Apify respondió ${response.status}.`);
  const items = await response.json() as unknown;
  const list = Array.isArray(items) ? items : [];
  const ads: JobAd[] = list.flatMap(item => {
    const ad = item && typeof item === 'object' ? jobAdFromFantastic(item as Record<string, unknown>) : null;
    return ad ? [ad] : [];
  });
  return { ads, fetched: list.length, costUsd: Math.round(list.length * (dependencies.usdPerJob ?? DEFAULT_USD_PER_JOB) * 10_000) / 10_000 };
}

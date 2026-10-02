import { jobAdFromJSearch, type JobAd } from '@/lib/commercial-opportunities/hiring';

/**
 * JSearch (OpenWeb Ninja, on RapidAPI): job ads from Google for Jobs, filtered to Chile. Each page is billed as one request;
 * on the Pro plan (US$25 for 10,000) that is US$0.0025. The key travels only in the request header and is never logged.
 */
export const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
export const JSEARCH_USD_PER_REQUEST = 0.0025;

export type JSearchQuery = { query: string; page?: number; numPages?: number; datePosted?: 'today' | '3days' | 'week' | 'month' };
type Dependencies = { fetch: typeof fetch; key: string | undefined };

export async function searchJSearch(input: JSearchQuery, dependencies: Dependencies = { fetch: globalThis.fetch, key: process.env.JSEARCH_API_KEY }) {
  if (!dependencies.key) throw new Error('Falta la clave de JSearch (JSEARCH_API_KEY).');
  const numPages = Math.max(1, Math.min(5, input.numPages ?? 1));
  const params = new URLSearchParams({ query: input.query.slice(0, 200), page: String(Math.max(1, input.page ?? 1)), num_pages: String(numPages),
    country: 'cl', date_posted: input.datePosted ?? 'month' });
  const response = await dependencies.fetch(`https://${JSEARCH_HOST}/search?${params}`, {
    headers: { 'x-rapidapi-key': dependencies.key, 'x-rapidapi-host': JSEARCH_HOST }, signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('JSearch rechazó la clave o la suscripción.');
  if (response.status === 429) throw new Error('JSearch: se acabó el cupo del plan este mes.');
  if (!response.ok) throw new Error(`JSearch respondió ${response.status}.`);
  const body = await response.json() as { data?: unknown };
  const ads: JobAd[] = (Array.isArray(body.data) ? body.data : []).flatMap(item => {
    const ad = item && typeof item === 'object' ? jobAdFromJSearch(item as Record<string, unknown>) : null;
    return ad ? [ad] : [];
  });
  return { ads, requests: numPages, costUsd: numPages * JSEARCH_USD_PER_REQUEST };
}

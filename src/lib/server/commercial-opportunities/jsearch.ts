import { jobAdFromJSearch, type JobAd } from '@/lib/commercial-opportunities/hiring';

/**
 * JSearch (OpenWeb Ninja, on RapidAPI): job ads from Google for Jobs, filtered to Chile. Each page is billed as one request;
 * on the Pro plan (US$25 for 10,000) that is US$0.0025. The key travels only in the request header and is never logged.
 */
export const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
export const JSEARCH_USD_PER_REQUEST = 0.0025;

export class JSearchRequestError extends Error {
  constructor(message: string, readonly costUsd: number, readonly ads: JobAd[] = [], readonly stopQueries = false) {
    super(message); this.name = 'JSearchRequestError';
  }
}

export type JSearchQuery = { query: string; page?: number; cursor?: string; numPages?: number; datePosted?: 'today' | '3days' | 'week' | 'month' };
type Dependencies = { fetch: typeof fetch; key: string | undefined };

export async function searchJSearch(input: JSearchQuery, dependencies: Dependencies = { fetch: globalThis.fetch, key: process.env.JSEARCH_API_KEY }):
Promise<{ ads: JobAd[]; requests: number; costUsd: number; cursor?: string | null }> {
  if (!dependencies.key) throw new Error('Falta la clave de JSearch (JSEARCH_API_KEY).');
  if (input.page != null && input.page !== 1) throw new Error('JSearch usa cursor para continuar; no admite saltar por número de página.');
  const numPages = Math.max(1, Math.min(5, input.numPages ?? 1));
  const rawQuery = input.query.trim().slice(0, 190);
  const query = /\bchile\b/i.test(rawQuery) ? rawQuery : `${rawQuery} Chile`;
  const ads = new Map<string, JobAd>();
  const seen = new Set<string>();
  let cursor = input.cursor || null;
  let requests = 0;
  for (let page = 0; page < numPages; page++) {
    const params = new URLSearchParams({ query, country: 'cl', language: 'es', date_posted: input.datePosted ?? 'month' });
    if (cursor) params.set('cursor', cursor);
    requests++;
    let response: Response;
    try {
      response = await dependencies.fetch(`https://${JSEARCH_HOST}/search-v2?${params}`, {
        headers: { 'x-rapidapi-key': dependencies.key, 'x-rapidapi-host': JSEARCH_HOST }, signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new JSearchRequestError('JSearch no respondió a tiempo. Conservamos los avisos de las páginas recibidas.', requests * JSEARCH_USD_PER_REQUEST, [...ads.values()], true);
    }
    const fail = (message: string, stopQueries = false, rejected = false): never => {
      throw new JSearchRequestError(message, (requests - (rejected ? 1 : 0)) * JSEARCH_USD_PER_REQUEST, [...ads.values()], stopQueries);
    };
    if (response.status === 401 || response.status === 403) fail('JSearch rechazó la clave o la suscripción.', true, true);
    if (response.status === 429) {
      // RapidAPI uses 429 both for burst limits and monthly quotas. Never call
      // a temporary rate limit "monthly quota exhausted" without evidence.
      const detail = await response.json().catch(() => ({})) as { message?: unknown } | null;
      const monthly = typeof detail?.message === 'string' && /monthly|month|cuota mensual/i.test(detail.message);
      fail(monthly ? 'JSearch: se acabó el cupo del plan este mes.' : 'JSearch limitó temporalmente las consultas. Espera un minuto antes de reintentar.', true, true);
    }
    if (!response.ok) fail(`JSearch respondió ${response.status}.`);
    const body = await response.json().catch(() => null) as { status?: string; data?: { jobs?: unknown[]; cursor?: unknown } } | null;
    if (body?.status !== 'OK' || !Array.isArray(body.data?.jobs)) {
      fail('JSearch respondió sin una lista de avisos válida.');
    }
    for (const item of body!.data!.jobs!) {
      const ad = item && typeof item === 'object' ? jobAdFromJSearch(item as Record<string, unknown>) : null;
      if (ad) ads.set(ad.externalId, ad);
    }
    const next = typeof body!.data!.cursor === 'string' && body!.data!.cursor.length <= 4096 ? body!.data!.cursor : null;
    if (!next || next === cursor || seen.has(next)) { cursor = null; break; }
    seen.add(next);
    cursor = next;
  }
  return { ads: [...ads.values()], requests, costUsd: requests * JSEARCH_USD_PER_REQUEST, cursor };
}

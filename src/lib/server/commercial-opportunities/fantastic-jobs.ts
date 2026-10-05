import { jobAdFromFantastic, type JobAd } from '@/lib/commercial-opportunities/hiring';

/**
 * The LinkedIn Job Search API of Fantastic Jobs, run as an Apify actor with the APIFY_TOKEN the app already has. Apify bills
 * each job by plan (US$0.005 on the free and Bronze plans, 0.0035 on Silver, 0.0015 from Gold): APIFY_FANTASTIC_USD_PER_JOB
 * says which one applies. Agencies are removed at the source, descriptions are not retained, and the recruiter fields that
 * come with each job are dropped by jobAdFromFantastic.
 */
export const FANTASTIC_ACTOR = 'fantastic-jobs~advanced-linkedin-job-search-api';
const DEFAULT_USD_PER_JOB = 0.005;
const DEFAULT_START_USD = 0.01;
const DEFAULT_MAX_RUN_USD = 1;
/** What one job costs on the Apify plan of the account (APIFY_FANTASTIC_USD_PER_JOB), shown before every search. */
export function fantasticUsdPerJob(configured = process.env.APIFY_FANTASTIC_USD_PER_JOB) {
  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_USD_PER_JOB;
}

export function fantasticStartUsd(configured = process.env.APIFY_FANTASTIC_START_USD) {
  const value = Number(configured);
  return configured !== undefined && configured !== '' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_START_USD;
}

export function fantasticMaxRunUsd(configured = process.env.APIFY_FANTASTIC_MAX_RUN_USD) {
  const value = Number(configured);
  return configured !== undefined && configured !== '' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAX_RUN_USD;
}

/** The request limit and the monthly estimate share the same startup fee and
 * provider-side hard cap. On Free, US$1 allows 198 jobs plus US$0.01 to start. */
export function fantasticRunPlan(requested = 200, usdPerJob = fantasticUsdPerJob(),
  maxRunUsd = fantasticMaxRunUsd(), startUsd = fantasticStartUsd()) {
  if (!Number.isFinite(usdPerJob) || usdPerJob <= 0 || !Number.isFinite(maxRunUsd) || maxRunUsd < 0
    || !Number.isFinite(startUsd) || startUsd < 0) throw new Error('El presupuesto de Apify no es válido.');
  const affordable = Math.max(0, Math.floor((maxRunUsd - startUsd + 1e-9) / usdPerJob));
  const desired = Number.isFinite(requested) ? Math.max(10, Math.min(1000, Math.floor(requested))) : 200;
  const limit = Math.min(desired, affordable);
  const enabled = limit >= 10;
  return { enabled, limit: enabled ? limit : 0, maxRunUsd, startUsd,
    estimateUsd: enabled ? Math.round((startUsd + limit * usdPerJob) * 10_000) / 10_000 : 0 };
}

export type FantasticQuery = { titles: string[]; locations?: string[]; timeRange?: '24h' | '7d' | '6m'; limit?: number };
type Dependencies = { fetch: typeof fetch; token: string | undefined; usdPerJob?: number; maxRunUsd?: number; startUsd?: number };

export class FantasticJobsError extends Error {
  constructor(message: string, readonly mayHaveCharged: boolean) { super(message); this.name = 'FantasticJobsError'; }
}

/** Apify error types that mean the run never started (Apify API, ErrorResponse.error.type), so nothing was charged. */
const REJECTED_BEFORE_START = new Set(['invalid-input', 'invalid-input-schema', 'run-input-body-not-valid-json', 'invalid-content-type-header']);
/**
 * What an Apify error means for the bill, read from its body (`{ error: { type, message } }`). Only a rejection before the
 * run starts is free: an invalid input (400 `invalid-input`), the token, the balance or the actor. A run that started and
 * failed (400 `run-failed`), that outlived the wait (408 `run-timeout-exceeded`, it keeps running at Apify) or a 400 that
 * does not say which it was may have charged, so the sync reserves the run's cap. Apify's own message is never shown: the
 * page gets ours, with the error type for the receipt.
 */
async function apifyFailure(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { type?: unknown } } | null;
  const type = typeof body?.error?.type === 'string' ? body.error.type.slice(0, 60) : null;
  const tag = type ? ` (${type})` : '';
  if (response.status === 401 || response.status === 403) return new FantasticJobsError('Apify rechazó el token; revisa el acceso a la cuenta.', false);
  if (response.status === 402) return new FantasticJobsError('Apify: no queda saldo en la cuenta.', false);
  if (response.status === 404) return new FantasticJobsError('El actor de búsqueda de LinkedIn no está disponible en Apify.', false);
  if (response.status === 429) return new FantasticJobsError('Apify limitó las consultas por un momento; no se inició la corrida.', false);
  if (response.status === 408 || type === 'run-timeout-exceeded') {
    return new FantasticJobsError('La corrida de Apify siguió más allá del tiempo de espera y puede haber cobrado.', true);
  }
  if (response.status === 400 && type && (REJECTED_BEFORE_START.has(type) || type.startsWith('invalid-'))) {
    return new FantasticJobsError(`Apify rechazó los parámetros de búsqueda${tag}; no se inició la corrida.`, false);
  }
  if (response.status === 400 && (type === 'run-failed' || type === 'actor-run-failed')) {
    return new FantasticJobsError(`La corrida de Apify empezó y falló${tag}.`, true);
  }
  if (response.status === 400) return new FantasticJobsError(`Apify respondió 400 sin decir si la corrida empezó${tag}.`, true);
  return new Error(`Apify respondió ${response.status}.`);
}

export async function searchFantasticJobs(input: FantasticQuery, dependencies: Dependencies = {
  fetch: globalThis.fetch, token: process.env.APIFY_TOKEN, usdPerJob: fantasticUsdPerJob(),
}) {
  if (!dependencies.token) throw new Error('Falta el token de Apify (APIFY_TOKEN).');
  const usdPerJob = dependencies.usdPerJob ?? fantasticUsdPerJob();
  const plan = fantasticRunPlan(input.limit, usdPerJob, dependencies.maxRunUsd, dependencies.startUsd);
  if (!plan.enabled) throw new Error('El tope por búsqueda de Apify no alcanza para consultar 10 avisos.');
  const limit = plan.limit;
  const body = {
    // The published enum accepts only text/html, not an empty string. Text is
    // discarded by jobAdFromFantastic; no recruiter add-on is requested.
    timeRange: input.timeRange ?? '7d', limit, removeAgency: true, descriptionType: 'text', recruiterOnly: false,
    // «operari:*» also finds «operaria» and «operarios»; a title of several words goes as a phrase.
    titleSearch: input.titles.slice(0, 30).map(title => /\s/.test(title.trim()) ? title.trim() : `${title.trim().replace(/[oa]s?$/i, '')}:*`),
    locationSearch: input.locations?.length ? input.locations.slice(0, 20) : ['Chile'],
  };
  const params = new URLSearchParams({ timeout: '110', memory: '1024', restartOnError: 'false',
    forcePermissionLevel: 'LIMITED_PERMISSIONS', maxTotalChargeUsd: String(plan.maxRunUsd) });
  const response = await dependencies.fetch(`https://api.apify.com/v2/acts/${FANTASTIC_ACTOR}/run-sync-get-dataset-items?${params}`, {
    method: 'POST', headers: { authorization: `Bearer ${dependencies.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw await apifyFailure(response);
  const items = await response.json() as unknown;
  if (!Array.isArray(items)) throw new Error('Apify no entregó una lista de avisos; no se puede confirmar el resultado ni el costo.');
  const list = items.slice(0, limit);
  const ads: JobAd[] = list.flatMap(item => {
    const ad = item && typeof item === 'object' ? jobAdFromFantastic(item as Record<string, unknown>) : null;
    return ad ? [ad] : [];
  });
  // The dataset response has no receipt. Keep the estimate explicit and never
  // undercount an actor that returned more rows than requested.
  return { ads, fetched: list.length, costUsd: Math.min(plan.maxRunUsd,
    Math.round((plan.startUsd + items.length * usdPerJob) * 10_000) / 10_000) };
}

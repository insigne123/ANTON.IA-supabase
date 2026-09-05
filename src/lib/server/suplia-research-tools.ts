import { cleanDomain } from '@/lib/commercial-intelligence';
import {
  buildSerperCacheKey,
  normalizeSerperSearchInput,
  searchSerper,
} from '@/lib/server/serper-search';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import type { SupliaToolContext } from '@/lib/server/suplia-tools';

const RESEARCH_UA = 'ANTON.IA SUPLIA Research/1.0 (+https://anton.ia)';
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_CACHE_TTL_SECONDS = 6 * 60 * 60;
const DEFAULT_ERROR_CACHE_TTL_SECONDS = 15 * 60;

type ResearchCacheEntry = {
  expiresAt: number;
  value: Record<string, unknown>;
};

const researchCache = new Map<string, ResearchCacheEntry>();

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function researchTimeoutMs() {
  return clampInt(process.env.SUPLIA_RESEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 15000);
}

function researchCacheTtlSeconds(status: unknown) {
  const fallback = status === 'completed' ? DEFAULT_CACHE_TTL_SECONDS : DEFAULT_ERROR_CACHE_TTL_SECONDS;
  return clampInt(
    status === 'completed' ? process.env.SUPLIA_RESEARCH_CACHE_TTL_SECONDS : process.env.SUPLIA_RESEARCH_ERROR_CACHE_TTL_SECONDS,
    fallback,
    60,
    24 * 60 * 60,
  );
}

function normalizeResearchDomain(value: unknown) {
  return cleanDomain(String(value || '').trim()).replace(/^m\./, '');
}

function cacheKey(provider: string, domain: string) {
  return `${provider}:${domain}`;
}

function withCacheMeta<T extends Record<string, unknown>>(value: T, hit: boolean): T & { cache: { hit: boolean } } {
  return { ...value, cache: { hit } };
}

function getResearchOrganizationId(context: SupliaToolContext | undefined) {
  return context?.auth?.organizationId || '';
}

function stripCacheMeta(value: Record<string, unknown>) {
  const { cache: _cache, ...payload } = value;
  return payload;
}

async function getPersistentResearchCache(context: SupliaToolContext | undefined, provider: string, key: string, enabled = true) {
  const organizationId = getResearchOrganizationId(context);
  if (!enabled || !organizationId || !key) return null;
  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('suplia_research_cache')
      .select('id,payload')
      .eq('organization_id', organizationId)
      .eq('provider', provider)
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error || !data?.payload) return null;

    void admin
      .from('suplia_research_cache')
      .update({ last_hit_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', data.id);

    return withCacheMeta(data.payload as Record<string, unknown>, true);
  } catch {
    return null;
  }
}

async function setPersistentResearchCache(context: SupliaToolContext | undefined, provider: string, key: string, value: Record<string, unknown>) {
  const organizationId = getResearchOrganizationId(context);
  if (!organizationId || !key) return;
  try {
    const admin = getSupabaseAdminClient();
    const expiresAt = new Date(Date.now() + researchCacheTtlSeconds(value.status) * 1000).toISOString();
    await admin
      .from('suplia_research_cache')
      .upsert({
        organization_id: organizationId,
        provider,
        cache_key: key,
        domain: typeof value.domain === 'string' ? value.domain : null,
        query: typeof value.query === 'string' ? value.query : null,
        status: typeof value.status === 'string' ? value.status : 'completed',
        payload: stripCacheMeta(value),
        expires_at: expiresAt,
        fetched_at: typeof value.fetchedAt === 'string' ? value.fetchedAt : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,provider,cache_key' });
  } catch {
    // Persistence is best-effort. Provider results should never fail because cache storage failed.
  }
}

function getCachedResearch(provider: string, domain: string) {
  const entry = researchCache.get(cacheKey(provider, domain));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    researchCache.delete(cacheKey(provider, domain));
    return null;
  }
  return withCacheMeta(entry.value, true);
}

function setCachedResearch(provider: string, domain: string, value: Record<string, unknown>) {
  const ttlSeconds = researchCacheTtlSeconds(value.status);
  researchCache.set(cacheKey(provider, domain), {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value,
  });
}

function mergeResearchHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (!headers.has('accept')) headers.set('accept', 'application/json,text/plain,*/*');
  if (!headers.has('user-agent')) headers.set('user-agent', RESEARCH_UA);
  return headers;
}

async function fetchWithTimeout(url: string, label: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), researchTimeoutMs());
  try {
    const res = await fetch(url, {
      ...init,
      headers: mergeResearchHeaders(init),
      signal: controller.signal,
      cache: init.cache || 'no-store',
    });
    return res;
  } catch (error: any) {
    const isAbort = error?.name === 'AbortError';
    throw new Error(isAbort ? `${label}_timeout` : `${label}_failed:${error?.message || 'unknown_error'}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url: string, label: string, init: RequestInit = {}) {
  try {
    const res = await fetchWithTimeout(url, label, init);
    if (!res.ok) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }
      return {
        ok: false as const,
        warning: `${label}_http_${res.status}${body ? `:${body.slice(0, 120)}` : ''}`,
      };
    }
    return { ok: true as const, data: await res.json() };
  } catch (error: any) {
    return { ok: false as const, warning: error?.message || `${label}_failed` };
  }
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(values: unknown[]) {
  for (const value of values) {
    const parsed = numeric(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function latestMonthlyVisitEstimate(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const latest = entries.sort(([a], [b]) => a.localeCompare(b)).at(-1)?.[1];
  return numeric(latest);
}

function parseSimilarwebPayload(domain: string, payload: any) {
  const engagements = payload?.Engagments || payload?.Engagements || {};
  const trafficSources = payload?.TrafficSources || {};
  const topCountries = Array.isArray(payload?.TopCountryShares) ? payload.TopCountryShares : [];
  const visitsMonthly = firstNumber([
    engagements?.Visits,
    payload?.Visits,
    payload?.visits,
    latestMonthlyVisitEstimate(payload?.EstimatedMonthlyVisits),
  ]);

  return {
    domain,
    status: 'completed',
    source: 'similarweb_public',
    provider: 'similarweb',
    fetchedAt: new Date().toISOString(),
    globalRank: firstNumber([payload?.GlobalRank?.Rank, payload?.GlobalRank]),
    countryRank: firstNumber([payload?.CountryRank?.Rank, payload?.CountryRank]),
    category: payload?.CategoryRank?.Category || payload?.Category || null,
    categoryRank: firstNumber([payload?.CategoryRank?.Rank]),
    visitsMonthly,
    bounceRate: firstNumber([engagements?.BounceRate, payload?.BounceRate]),
    pagesPerVisit: firstNumber([engagements?.PagePerVisit, engagements?.PagesPerVisit, payload?.PagePerVisit]),
    avgVisitDuration: engagements?.TimeOnSite || payload?.TimeOnSite || null,
    trafficSources: {
      direct: numeric(trafficSources?.Direct),
      searchOrganic: numeric(trafficSources?.SearchOrganic),
      searchPaid: numeric(trafficSources?.SearchPaid),
      referrals: numeric(trafficSources?.Referrals),
      social: numeric(trafficSources?.SocialOrganic || trafficSources?.Social),
      mail: numeric(trafficSources?.Mail),
      displayAds: numeric(trafficSources?.DisplayAds),
    },
    topCountries: topCountries.slice(0, 5).map((country: any) => ({
      country: country?.CountryCode || country?.country || null,
      share: numeric(country?.Value ?? country?.share),
    })),
    warnings: visitsMonthly == null ? ['similarweb_no_visit_estimate'] : [],
    note: 'Trafico estimado desde endpoint publico de SimilarWeb. Sin costo; usar como senal direccional.',
  };
}

function parseWhoisPayload(domain: string, payload: any) {
  const registrar = payload?.registrar || payload?.registrarName || payload?.registrar_name || null;
  const created = payload?.creationDate || payload?.created || payload?.createdDate || payload?.created_date || null;
  const expires = payload?.expiryDate || payload?.expires || payload?.expiresDate || payload?.expires_date || null;
  const updated = payload?.updatedDate || payload?.updated || payload?.updated_date || null;
  const nameservers = Array.isArray(payload?.nameServers)
    ? payload.nameServers
    : Array.isArray(payload?.nameservers)
      ? payload.nameservers
      : [];

  return {
    domain,
    status: 'completed',
    source: 'domaindetails',
    provider: 'domaindetails',
    fetchedAt: new Date().toISOString(),
    registrar,
    created,
    expires,
    updated,
    available: typeof payload?.available === 'boolean' ? payload.available : null,
    nameservers: nameservers.slice(0, 6).map((item: unknown) => String(item || '').trim()).filter(Boolean),
    warnings: !registrar && !created ? ['whois_sparse_response'] : [],
    note: 'WHOIS publico del dominio. Sin costo; usar como senal de identidad y antiguedad.',
  };
}

function unavailableResearch(provider: string, source: string, domain: string, warning: string) {
  return {
    domain,
    status: 'unavailable',
    source,
    provider,
    fetchedAt: new Date().toISOString(),
    warnings: [warning],
    note: 'No pudimos obtener esta senal ahora. Continua con otras fuentes antes de concluir.',
  };
}

function needEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name} para esta tool de research.`);
  return value;
}

async function consumePremiumResearchCredit(context: SupliaToolContext) {
  if (!context.consumeResearchCredit) throw new Error('RESEARCH_CREDIT_RESERVATION_REQUIRED');
  await context.consumeResearchCredit();
}

function asText(value: unknown) {
  return String(value || '').trim();
}

function buildSerpQuery(kind: string, input: Record<string, unknown>) {
  const domain = normalizeResearchDomain(input.domain || input.companyDomain || input.website || input.url);
  const company = asText(input.company || input.companyName || input.name) || domain;
  const location = asText(input.location || input.country || input.market);
  const base = company || domain;
  if (!base) throw new Error(`Falta company o domain para research.${kind}.`);
  const quotedCompany = company ? `"${company.replace(/"/g, '').slice(0, 180)}"` : domain;

  if (kind === 'serp_company_profile') return [quotedCompany, domain, 'productos servicios industria empleados oficinas clientes'].filter(Boolean).join(' ');
  if (kind === 'serp_company_news') return `${quotedCompany} noticias novedades expansión alianza lanzamiento${domain ? ` -site:${domain}` : ''}`;
  if (kind === 'serp_competitors') return `${base} competidores alternativas mercado`;
  if (kind === 'serp_jobs_signals') return domain
    ? `site:${domain} (careers OR jobs OR empleo OR vacantes OR trabajar)`
    : `${quotedCompany} hiring jobs careers contratando ${location}`.trim();
  if (kind === 'brand_mentions') return domain ? `"${company}" -site:${domain}` : `"${company}" menciones prensa redes`;
  return base;
}

async function researchSerp(input: Record<string, unknown>, context: SupliaToolContext, kind: 'serp_company_profile' | 'serp_company_news' | 'serp_competitors' | 'serp_jobs_signals' | 'brand_mentions') {
  const query = asText(input.query) || buildSerpQuery(kind, input);
  const search = normalizeSerperSearchInput({
    organizationId: getResearchOrganizationId(context),
    kind: kind === 'serp_company_news' ? 'news' : 'organic',
    query,
    language: input.language,
    countryCode: input.countryCode || input.country,
    location: input.location,
    limit: input.limit,
  });
  const cacheKey = buildSerperCacheKey(search);
  const cached = await getPersistentResearchCache(context, 'serper', cacheKey, input.cache !== false);
  if (cached) return cached;

  needEnv('SERPER_API_KEY');
  await consumePremiumResearchCredit(context);
  const result = await searchSerper(search);
  const output = {
    status: 'completed',
    source: 'serper',
    provider: 'serper',
    kind,
    query: result.query,
    fetchedAt: new Date().toISOString(),
    localization: result.localization,
    limit: result.limit,
    items: result.items,
    answerBox: result.answerBox,
    relatedQuestions: result.relatedQuestions,
    searchInformation: result.searchInformation,
    estimatedCreditUse: { provider: 'serper', searches: 1 },
    note: 'Busqueda externa con Serper. Consume creditos y fue ejecutada solo tras aprobacion.',
  };
  await setPersistentResearchCache(context, 'serper', cacheKey, output);
  return output;
}

export async function researchSimilarweb(input: Record<string, unknown>, context: SupliaToolContext) {
  const domain = normalizeResearchDomain(input.domain || input.companyDomain || input.website || input.url || input.company);
  if (!domain) throw new Error('Falta domain para research.similarweb.');

  if (input.cache !== false) {
    const cached = getCachedResearch('similarweb', domain);
    if (cached) return cached;
    const persistent = await getPersistentResearchCache(context, 'similarweb', domain, true);
    if (persistent) {
      setCachedResearch('similarweb', domain, persistent);
      return persistent;
    }
  }

  const result = await fetchJsonWithTimeout(`https://data.similarweb.com/api/v1/data?domain=${encodeURIComponent(domain)}`, 'similarweb');
  const output = result.ok
    ? parseSimilarwebPayload(domain, result.data)
    : unavailableResearch('similarweb', 'similarweb_public', domain, result.warning);
  setCachedResearch('similarweb', domain, output);
  await setPersistentResearchCache(context, 'similarweb', domain, output);
  return withCacheMeta(output, false);
}

export async function researchWhois(input: Record<string, unknown>, context: SupliaToolContext) {
  const domain = normalizeResearchDomain(input.domain || input.companyDomain || input.website || input.url);
  if (!domain) throw new Error('Falta domain para research.whois.');

  if (input.cache !== false) {
    const cached = getCachedResearch('whois', domain);
    if (cached) return cached;
    const persistent = await getPersistentResearchCache(context, 'whois', domain, true);
    if (persistent) {
      setCachedResearch('whois', domain, persistent);
      return persistent;
    }
  }

  const result = await fetchJsonWithTimeout(`https://mcp.domaindetails.com/lookup/${encodeURIComponent(domain)}`, 'whois');
  const output = result.ok
    ? parseWhoisPayload(domain, result.data)
    : unavailableResearch('domaindetails', 'domaindetails', domain, result.warning);
  setCachedResearch('whois', domain, output);
  await setPersistentResearchCache(context, 'whois', domain, output);
  return withCacheMeta(output, false);
}

export async function researchBrand(input: Record<string, unknown>, context: SupliaToolContext) {
  const domain = normalizeResearchDomain(input.domain || input.companyDomain || input.website || input.url);
  if (!domain) throw new Error('Falta domain para research.brand.');
  const cached = await getPersistentResearchCache(context, 'brand.dev', domain, input.cache !== false);
  if (cached) return cached;

  const apiKey = needEnv('BRANDDEV_API_KEY');
  await consumePremiumResearchCredit(context);
  const result = await fetchJsonWithTimeout(`https://api.brand.dev/v1/brand/retrieve?domain=${encodeURIComponent(domain)}`, 'branddev', {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!result.ok) throw new Error(result.warning);

  const brand = result.data?.brand || result.data || {};
  const output = {
    domain,
    status: 'completed',
    source: 'brand.dev',
    provider: 'brand.dev',
    fetchedAt: new Date().toISOString(),
    name: brand?.name || null,
    description: brand?.description || null,
    industry: brand?.industry || (Array.isArray(brand?.industries) ? brand.industries[0] : null) || null,
    colors: Array.isArray(brand?.colors) ? brand.colors.slice(0, 8) : [],
    logos: Array.isArray(brand?.logos) ? brand.logos.slice(0, 5) : [],
    fonts: Array.isArray(brand?.fonts) ? brand.fonts.slice(0, 5) : [],
    estimatedCreditUse: { provider: 'brand.dev', requests: 1 },
    note: 'Brand profile via Brand.dev. Consume creditos y fue ejecutado solo tras aprobacion.',
  };
  await setPersistentResearchCache(context, 'brand.dev', domain, output);
  return output;
}

export async function researchSerpCompanyNews(input: Record<string, unknown>, context: SupliaToolContext) {
  return researchSerp(input, context, 'serp_company_news');
}

export async function researchSerpCompanyProfile(input: Record<string, unknown>, context: SupliaToolContext) {
  return researchSerp(input, context, 'serp_company_profile');
}

export async function researchSerpCompetitors(input: Record<string, unknown>, context: SupliaToolContext) {
  return researchSerp(input, context, 'serp_competitors');
}

export async function researchSerpJobsSignals(input: Record<string, unknown>, context: SupliaToolContext) {
  return researchSerp(input, context, 'serp_jobs_signals');
}

export async function researchBrandMentions(input: Record<string, unknown>, context: SupliaToolContext) {
  return researchSerp(input, context, 'brand_mentions');
}

export function clearSupliaResearchCache() {
  researchCache.clear();
}

export const supliaResearchTestInternals = {
  normalizeResearchDomain,
  parseSimilarwebPayload,
  parseWhoisPayload,
  buildSerpQuery,
};

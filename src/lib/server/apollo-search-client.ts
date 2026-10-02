import { ApolloGatewayError, executeApolloEnrichment } from './apollo-provider/apollo';
import { consumeEndpointRateLimit, getGatewayConfig } from './apollo-provider/gateway';
import { executeProviderLeadSearch } from './apollo-provider/lead-provider';
import { validateLeadSearchInput } from './apollo-provider/validation';
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

export class ApolloSearchClientError extends Error {
  constructor(readonly status: 400 | 429 | 502 | 503 | 504, readonly code: string) {
    super(code);
  }
}

function getApolloApiKey(environment: Record<string, string | undefined>) {
  return String(environment.APOLLO_API_KEY || '').trim();
}

function timeoutMs(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_SEARCH_TIMEOUT_MS || environment.LEADS_N8N_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.floor(configured))) : 20_000;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('APOLLO_SEARCH_TIMEOUT');
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
    if (typeof (timer as unknown as { unref?: unknown })?.unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function requestApolloSearch(
  payload: Record<string, unknown>,
  environment: Record<string, string | undefined> = process.env,
): Promise<any> {
  const config = getGatewayConfig(environment);
  if (!getApolloApiKey(environment)) {
    throw new ApolloSearchClientError(503, 'APOLLO_SEARCH_AUTH_NOT_CONFIGURED');
  }

  const rateLimit = consumeEndpointRateLimit('lead-search', config);
  if (!rateLimit.allowed) {
    throw new ApolloSearchClientError(429, 'RATE_LIMITED');
  }

  // The provider only runs Apollo: force it the same way the former
  // gateway hop did, so retired provider names can never reach Apollo.
  const profile = payload.search_mode === 'profile';
  const linkedinUrl = profile && typeof payload.linkedin_url === 'string'
    ? normalizeLinkedinProfileUrl(payload.linkedin_url) : '';
  if (profile && (!linkedinUrl || linkedinUrl.length > 500
    || payload.reveal_email === true || payload.reveal_phone === true
    || Number(payload.max_results ?? 1) !== 1 || Number(payload.per_page ?? 1) !== 1 || Number(payload.page ?? 1) !== 1
    || ['titles', 'industry_keywords', 'person_locations', 'seniorities', 'organization_domains', 'organization_ids',
      'company_location', 'company_keywords', 'employee_ranges'].some(field => payload[field] != null
        && (!Array.isArray(payload[field]) || (payload[field] as unknown[]).length > 0)))) {
    throw new ApolloSearchClientError(400, 'INVALID_REQUEST');
  }
  const input = profile ? null : validateLeadSearchInput({ ...(payload || {}), provider: 'apollo' }, config);
  if (input && !input.ok) {
    throw new ApolloSearchClientError(400, 'INVALID_REQUEST');
  }

  try {
    if (profile) {
      const found = await withTimeout(executeApolloEnrichment({
        lead: { linkedinUrl }, revealEmail: false, revealPhone: false, enrichmentLevel: 'basic', matchOnly: true,
      }, getApolloApiKey(environment), config), timeoutMs(environment));
      const person = found.extracted_data;
      if (!found.success || !person) return { leads: [], count: 0, search_mode: 'profile' };
      const id = person.apollo_id || person.source_provider_id;
      if (!id || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !person.full_name?.trim()) {
        throw new ApolloSearchClientError(502, 'APOLLO_SEARCH_INVALID_RESPONSE');
      }
      // Identity was corroborated by executeApolloEnrichment. No contact data
      // is revealed or kept by this search, even if the provider returns it.
      return { leads: [{ id, name: person.full_name, title: person.title,
        linkedin_url: person.linkedin_url || linkedinUrl, organization: person.organization,
        organization_name: person.organization_name, industry: person.organization_industry,
        organization_size: person.organization_size, city: person.city, country: person.country }], count: 1, search_mode: 'profile' };
    }
    if (!input?.ok) throw new ApolloSearchClientError(400, 'INVALID_REQUEST');
    const body = await withTimeout(
      executeProviderLeadSearch(input.value, config, environment),
      timeoutMs(environment),
    );
    if (!body || !(input.value.searchMode === 'organization_search'
      ? Array.isArray((body as { organizations?: unknown }).organizations)
      : Array.isArray((body as { leads?: unknown }).leads))) {
      throw new ApolloSearchClientError(502, 'APOLLO_SEARCH_INVALID_RESPONSE');
    }
    return body;
  } catch (error) {
    if (error instanceof ApolloSearchClientError) throw error;
    if (error instanceof ApolloGatewayError) {
      if (error.code === 'APOLLO_UPSTREAM_TIMEOUT') {
        throw new ApolloSearchClientError(504, 'APOLLO_SEARCH_TIMEOUT');
      }
      const status = error.status === 429 ? 429 : error.status === 503 ? 503 : error.status === 504 ? 504 : 502;
      throw new ApolloSearchClientError(status, error.code);
    }
    if ((error as { name?: string } | null)?.name === 'TimeoutError') {
      throw new ApolloSearchClientError(504, 'APOLLO_SEARCH_TIMEOUT');
    }
    throw new ApolloSearchClientError(502, 'APOLLO_SEARCH_FAILED');
  }
}

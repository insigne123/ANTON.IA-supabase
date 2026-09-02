const DEFAULT_LEAD_SEARCH_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-search';

export class ApolloSearchClientError extends Error {
  constructor(readonly status: 400 | 429 | 502 | 503 | 504, readonly code: string) {
    super(code);
  }
}

function configuredUrl(environment: Record<string, string | undefined>) {
  const value = String(environment.ANTONIA_LEAD_SEARCH_URL || environment.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL).trim();
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    return parsed.toString();
  } catch {
    throw new ApolloSearchClientError(503, 'APOLLO_SEARCH_URL_NOT_CONFIGURED');
  }
}

function configuredSecret(environment: Record<string, string | undefined>) {
  const secret = String(environment.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!secret) throw new ApolloSearchClientError(503, 'APOLLO_SEARCH_AUTH_NOT_CONFIGURED');
  return secret;
}

function timeoutMs(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_SEARCH_TIMEOUT_MS || environment.LEADS_N8N_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.floor(configured))) : 20_000;
}

export async function requestApolloSearch(
  payload: Record<string, unknown>,
  environment: Record<string, string | undefined> = process.env,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(environment));
  try {
    const response = await fetch(configuredUrl(environment), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-secret-key': configuredSecret(environment),
      },
      body: JSON.stringify({ ...payload, provider: 'apollo' }),
      cache: 'no-store',
      signal: controller.signal,
    });
    const raw = await response.text();
    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status === 400 ? 400 : response.status === 503 ? 503 : 502;
      throw new ApolloSearchClientError(status, String(body?.error || 'APOLLO_SEARCH_FAILED'));
    }
    if (!body || !Array.isArray(body.leads)) {
      throw new ApolloSearchClientError(502, 'APOLLO_SEARCH_INVALID_RESPONSE');
    }
    return body;
  } catch (error) {
    if (error instanceof ApolloSearchClientError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new ApolloSearchClientError(504, 'APOLLO_SEARCH_TIMEOUT');
    }
    throw new ApolloSearchClientError(502, 'APOLLO_SEARCH_FAILED');
  } finally {
    clearTimeout(timeout);
  }
}

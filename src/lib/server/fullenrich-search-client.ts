const DEFAULT_LEAD_SEARCH_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/lead-search';

export class FullEnrichSearchClientError extends Error {
  constructor(readonly status: 400 | 429 | 502 | 503 | 504, readonly code: string) {
    super(code);
  }
}

function configuredUrl() {
  const value = String(process.env.ANTONIA_LEAD_SEARCH_URL || process.env.LEAD_SEARCH_URL || DEFAULT_LEAD_SEARCH_URL).trim();
  try {
    const parsed = new URL(value);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    return parsed.toString();
  } catch {
    throw new FullEnrichSearchClientError(503, 'FULLENRICH_SEARCH_URL_NOT_CONFIGURED');
  }
}

function configuredSecret() {
  const secret = String(process.env.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!secret) throw new FullEnrichSearchClientError(503, 'FULLENRICH_SEARCH_AUTH_NOT_CONFIGURED');
  return secret;
}

function timeoutMs() {
  const configured = Number(process.env.FULLENRICH_SEARCH_TIMEOUT_MS || process.env.LEADS_N8N_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(60_000, Math.floor(configured))) : 20_000;
}

export async function requestFullEnrichSearch(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(configuredUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-secret-key': configuredSecret(),
      },
      body: JSON.stringify({ ...payload, provider: 'fullenrich' }),
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
      throw new FullEnrichSearchClientError(status, String(body?.error || 'FULLENRICH_SEARCH_FAILED'));
    }
    if (!body || !Array.isArray(body.leads)) {
      throw new FullEnrichSearchClientError(502, 'FULLENRICH_SEARCH_INVALID_RESPONSE');
    }
    return body;
  } catch (error) {
    if (error instanceof FullEnrichSearchClientError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new FullEnrichSearchClientError(504, 'FULLENRICH_SEARCH_TIMEOUT');
    }
    throw new FullEnrichSearchClientError(502, 'FULLENRICH_SEARCH_FAILED');
  } finally {
    clearTimeout(timeout);
  }
}

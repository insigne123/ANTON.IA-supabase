const DEFAULT_ORGANIZATION_ENRICHMENT_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/organization-enrich';

type JsonRecord = Record<string, unknown>;

export class ApolloOrganizationEnrichmentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly providerOutcomeUnknown: boolean,
  ) {
    super(code);
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function timeoutMs(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_ORGANIZATION_ENRICHMENT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.floor(configured)))
    : 25_000;
}

export function assertApolloOrganizationEnrichmentConfigured(
  environment: Record<string, string | undefined> = process.env,
) {
  if (!String(environment.ENRICHMENT_SERVICE_SECRET || '').trim()) {
    throw new ApolloOrganizationEnrichmentError(503, 'BACKEND_AUTH_NOT_CONFIGURED', false);
  }
}

export async function submitApolloOrganizationEnrichment(input: {
  domain: string;
  requestId: string;
  environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment || process.env;
  const url = String(environment.APOLLO_ORGANIZATION_ENRICHMENT_URL || DEFAULT_ORGANIZATION_ENRICHMENT_URL).trim();
  const secret = String(environment.ENRICHMENT_SERVICE_SECRET || '').trim();
  assertApolloOrganizationEnrichmentConfigured(environment);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(environment));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-secret-key': secret,
        'x-request-id': input.requestId,
      },
      body: JSON.stringify({ domain: input.domain }),
      signal: controller.signal,
    });
    const payload = record(await response.json().catch(() => null));
    if (!response.ok) {
      const code = String(payload.error || `APOLLO_ORGANIZATION_HTTP_${response.status}`).slice(0, 100);
      throw new ApolloOrganizationEnrichmentError(response.status, code, response.status >= 500);
    }
    if (payload.provider !== 'apollo' || !['completed', 'no_data'].includes(String(payload.status || ''))) {
      throw new ApolloOrganizationEnrichmentError(502, 'APOLLO_ORGANIZATION_INVALID_RESPONSE', true);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApolloOrganizationEnrichmentError) throw error;
    throw new ApolloOrganizationEnrichmentError(409, 'APOLLO_ORGANIZATION_OUTCOME_UNKNOWN', true);
  } finally {
    clearTimeout(timeout);
  }
}

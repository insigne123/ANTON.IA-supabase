const DEFAULT_ENRICHMENT_SERVICE_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/enrich';
const DEFAULT_GATEWAY_BASE_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app';

type JsonRecord = Record<string, unknown>;

export class ApolloEnrichmentError extends Error {
  constructor(
    readonly status: 409 | 429 | 502 | 503 | 504,
    readonly code: string,
    readonly providerOutcomeUnknown: boolean,
  ) {
    super(code);
  }
}

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function timeoutMs(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_ENRICHMENT_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.floor(configured)))
    : 25_000;
}

function gatewayConfiguration(environment: Record<string, string | undefined>) {
  const enrichmentUrl = String(environment.ENRICHMENT_SERVICE_URL || DEFAULT_ENRICHMENT_SERVICE_URL).trim();
  const gatewayBaseUrl = String(environment.BACKEND_HOSTED_APP_URL || DEFAULT_GATEWAY_BASE_URL).trim().replace(/\/$/, '');
  const secret = String(environment.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!secret) throw new ApolloEnrichmentError(503, 'ENRICHMENT_SERVICE_SECRET_NOT_CONFIGURED', false);
  return { enrichmentUrl, gatewayBaseUrl, secret };
}

export function assertApolloEnrichmentConfigured(
  environment: Record<string, string | undefined> = process.env,
) {
  gatewayConfiguration(environment);
}

async function gatewayRequest(
  url: string,
  init: RequestInit,
  environment: Record<string, string | undefined>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(environment));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) throw new ApolloEnrichmentError(502, 'APOLLO_GATEWAY_INVALID_RESPONSE', true);
    }
    if (!response.ok) {
      const code = text(object(payload)?.error, 100) || `APOLLO_GATEWAY_HTTP_${response.status}`;
      const unknown = code === 'APOLLO_UPSTREAM_TIMEOUT'
        || code === 'APOLLO_UPSTREAM_INVALID_RESPONSE'
        || code === 'APOLLO_UPSTREAM_ERROR'
        || code === 'BACKEND_ERROR';
      const status = response.status === 429 ? 429
        : response.status === 503 ? 503
          : response.status === 504 ? 504
            : 502;
      throw new ApolloEnrichmentError(status, code, unknown);
    }
    const result = object(payload);
    if (!result) throw new ApolloEnrichmentError(502, 'APOLLO_GATEWAY_INVALID_RESPONSE', true);
    return result;
  } catch (error) {
    if (error instanceof ApolloEnrichmentError) throw error;
    if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') {
      throw new ApolloEnrichmentError(504, 'APOLLO_GATEWAY_TIMEOUT', true);
    }
    throw new ApolloEnrichmentError(502, 'APOLLO_GATEWAY_UNREACHABLE', true);
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitApolloEnrichment(input: {
  lead: {
    id?: string;
    sourceProviderId?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    linkedinUrl?: string;
    organizationName?: string;
    organizationDomain?: string;
  };
  revealEmail: boolean;
  revealPhone: boolean;
  webhookUrl?: string;
  matchOnly?: boolean;
  environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment || process.env;
  const config = gatewayConfiguration(environment);
  const payload = await gatewayRequest(config.enrichmentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-secret-key': config.secret,
    },
    body: JSON.stringify({
      lead: {
        id: input.lead.id,
        source_provider_id: input.lead.sourceProviderId,
        first_name: input.lead.firstName,
        last_name: input.lead.lastName,
        full_name: input.lead.fullName,
        linkedin_url: input.lead.linkedinUrl,
        organization_name: input.lead.organizationName,
        organization_domain: input.lead.organizationDomain,
      },
      reveal_email: input.revealEmail,
      reveal_phone: input.revealPhone,
      enrichment_level: input.revealPhone ? 'deep' : 'basic',
      requested_data: { email: input.revealEmail, phone: input.revealPhone },
      requested_fields: [
        ...(input.revealEmail ? ['email'] : []),
        ...(input.revealPhone ? ['phone'] : []),
      ],
      match_only: Boolean(input.matchOnly),
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
    }),
  }, environment);

  const extractedData = object(payload.extracted_data);
  return {
    success: payload.success === true,
    enrichmentStatus: text(payload.enrichment_status, 64) || 'unknown',
    providerRequestId: text(payload.provider_request_id, 255),
    creditsConsumed: typeof payload.credits_consumed === 'number' ? payload.credits_consumed : undefined,
    extractedData,
  };
}

export async function pollApolloWebhookResult(input: {
  providerRequestId: string;
  environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment || process.env;
  const config = gatewayConfiguration(environment);
  const providerRequestId = text(input.providerRequestId, 255);
  if (!providerRequestId) throw new ApolloEnrichmentError(502, 'INVALID_APOLLO_PROVIDER_REQUEST_ID', false);
  const payload = await gatewayRequest(
    `${config.gatewayBaseUrl}/api/webhook-result/${encodeURIComponent(providerRequestId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', 'x-api-secret-key': config.secret },
    },
    environment,
  );

  return {
    providerRequestId: text(payload.provider_request_id, 255) || providerRequestId,
    status: text(payload.status, 64) || 'unknown',
    retryAfterSeconds: typeof payload.retry_after_seconds === 'number' ? payload.retry_after_seconds : undefined,
    candidate: object(payload.candidate),
  };
}

import {
  ApolloGatewayError,
  executeApolloEnrichment,
  getApolloApiKey,
  getApolloWebhookResult,
} from './apollo-provider/apollo';
import { consumeEndpointRateLimit, getGatewayConfig } from './apollo-provider/gateway';
import { validateEnrichmentInput } from './apollo-provider/validation';

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

function getProviderApiKey(environment: Record<string, string | undefined>) {
  const apiKey = getApolloApiKey(environment);
  if (!apiKey) throw new ApolloEnrichmentError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED', false);
  return apiKey;
}

export function assertApolloEnrichmentConfigured(
  environment: Record<string, string | undefined> = process.env,
) {
  getProviderApiKey(environment);
}

function withTimeout<T>(work: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(code);
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

function isUnknownProviderCode(code: string) {
  return code === 'APOLLO_UPSTREAM_TIMEOUT'
    || code === 'APOLLO_UPSTREAM_INVALID_RESPONSE'
    || code === 'APOLLO_UPSTREAM_ERROR';
}

function providerStatus(error: ApolloGatewayError): 429 | 502 | 503 | 504 {
  return error.status === 429 ? 429
    : error.status === 503 ? 503
      : error.status === 504 ? 504
        : 502;
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
  const config = getGatewayConfig(environment);
  const apiKey = getProviderApiKey(environment);

  const gatewayInput = {
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
  };
  const validated = validateEnrichmentInput(gatewayInput);
  if (!validated.ok) {
    throw new ApolloEnrichmentError(502, 'INVALID_REQUEST', false);
  }

  const rateLimit = consumeEndpointRateLimit('enrich', config);
  if (!rateLimit.allowed) {
    throw new ApolloEnrichmentError(429, 'RATE_LIMITED', false);
  }

  try {
    const payload = await withTimeout(
      executeApolloEnrichment(validated.value, apiKey, config),
      timeoutMs(environment),
      'APOLLO_GATEWAY_TIMEOUT',
    );
    const extractedData = object(payload.extracted_data);
    return {
      success: payload.success === true,
      enrichmentStatus: text(payload.enrichment_status, 64) || 'unknown',
      providerRequestId: text(payload.provider_request_id, 255),
      creditsConsumed: typeof payload.credits_consumed === 'number' ? payload.credits_consumed : undefined,
      extractedData,
    };
  } catch (error) {
    if (error instanceof ApolloEnrichmentError) throw error;
    if (error instanceof ApolloGatewayError) {
      throw new ApolloEnrichmentError(providerStatus(error), error.code, isUnknownProviderCode(error.code));
    }
    if ((error as { name?: string } | null)?.name === 'TimeoutError') {
      throw new ApolloEnrichmentError(504, 'APOLLO_GATEWAY_TIMEOUT', true);
    }
    throw new ApolloEnrichmentError(502, 'APOLLO_UPSTREAM_ERROR', true);
  }
}

export async function pollApolloWebhookResult(input: {
  providerRequestId: string;
  environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment || process.env;
  const config = getGatewayConfig(environment);
  const apiKey = getProviderApiKey(environment);
  const providerRequestId = text(input.providerRequestId, 255);
  if (!providerRequestId) throw new ApolloEnrichmentError(502, 'INVALID_APOLLO_PROVIDER_REQUEST_ID', false);

  try {
    const payload = await withTimeout(
      getApolloWebhookResult(providerRequestId, apiKey, config),
      timeoutMs(environment),
      'APOLLO_GATEWAY_TIMEOUT',
    );
    return {
      providerRequestId: text(payload.provider_request_id, 255) || providerRequestId,
      status: text(payload.status, 64) || 'unknown',
      retryAfterSeconds: typeof payload.retry_after_seconds === 'number' ? payload.retry_after_seconds : undefined,
      candidate: object(payload.candidate),
    };
  } catch (error) {
    if (error instanceof ApolloEnrichmentError) throw error;
    if (error instanceof ApolloGatewayError) {
      throw new ApolloEnrichmentError(providerStatus(error), error.code, isUnknownProviderCode(error.code));
    }
    if ((error as { name?: string } | null)?.name === 'TimeoutError') {
      throw new ApolloEnrichmentError(504, 'APOLLO_GATEWAY_TIMEOUT', true);
    }
    throw new ApolloEnrichmentError(502, 'APOLLO_UPSTREAM_ERROR', true);
  }
}

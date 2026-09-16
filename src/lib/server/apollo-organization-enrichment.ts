import {
  ApolloGatewayError,
  executeApolloOrganizationEnrichment,
  getApolloApiKey,
} from './apollo-provider/apollo';
import { consumeEndpointRateLimit, getGatewayConfig } from './apollo-provider/gateway';
import { validateOrganizationEnrichmentInput } from './apollo-provider/validation';

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
  if (!String(environment.APOLLO_API_KEY || '').trim()) {
    throw new ApolloOrganizationEnrichmentError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED', false);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('APOLLO_ORGANIZATION_OUTCOME_UNKNOWN');
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

export async function submitApolloOrganizationEnrichment(input: {
  domain: string;
  requestId: string;
  environment?: Record<string, string | undefined>;
}) {
  const environment = input.environment || process.env;
  const config = getGatewayConfig(environment);
  assertApolloOrganizationEnrichmentConfigured(environment);
  const apiKey = getApolloApiKey(environment);

  const validated = validateOrganizationEnrichmentInput({ domain: input.domain });
  if (!validated.ok) {
    throw new ApolloOrganizationEnrichmentError(400, 'INVALID_REQUEST', false);
  }

  const rateLimit = consumeEndpointRateLimit('enrich', config);
  if (!rateLimit.allowed) {
    throw new ApolloOrganizationEnrichmentError(429, 'RATE_LIMITED', false);
  }

  try {
    const result = await withTimeout(
      executeApolloOrganizationEnrichment(validated.value, apiKey, config),
      timeoutMs(environment),
    );
    const payload = {
      provider: 'apollo' as const,
      status: result.status,
      credits_consumed: result.credits_consumed,
      organization: result.organization,
    };
    if (payload.provider !== 'apollo' || !['completed', 'no_data'].includes(String(payload.status || ''))) {
      throw new ApolloOrganizationEnrichmentError(502, 'APOLLO_ORGANIZATION_INVALID_RESPONSE', true);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApolloOrganizationEnrichmentError) throw error;
    if (error instanceof ApolloGatewayError) {
      throw new ApolloOrganizationEnrichmentError(error.status, error.code, error.status >= 500);
    }
    throw new ApolloOrganizationEnrichmentError(409, 'APOLLO_ORGANIZATION_OUTCOME_UNKNOWN', true);
  }
}

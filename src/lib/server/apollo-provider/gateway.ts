import { randomUUID, timingSafeEqual } from 'node:crypto';

export const INTERNAL_AUTH_HEADER = 'x-api-secret-key';
export const INTERNAL_AUTH_ENV = 'ENRICHMENT_SERVICE_SECRET';

export type GatewayEnvironment = Record<string, string | undefined>;
export const LEAD_PROVIDERS = ['apollo'] as const;
export type LeadProvider = (typeof LEAD_PROVIDERS)[number];

export type GatewayConfig = {
  maxRequestBytes: number;
  maxSearchResults: number;
  providerTimeoutMs: number;
  defaultProvider: LeadProvider;
  rateLimitWindowMs: number;
  /** Searches a minute for the whole instance: the ceiling that protects the provider. */
  leadSearchMaxRequests: number;
  /** Searches a minute for one person, inside that ceiling, so one person's burst does not block the rest. */
  leadSearchMaxPerPerson: number;
  enrichMaxRequests: number;
};

function boundedInteger(
  environment: GatewayEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(environment[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function configuredLeadProvider(environment: GatewayEnvironment): LeadProvider {
  const configured = String(environment.LEADS_PROVIDER_DEFAULT || '').trim().toLowerCase();
  return LEAD_PROVIDERS.find((provider) => provider === configured) || 'apollo';
}

export function getGatewayConfig(environment: GatewayEnvironment = process.env): GatewayConfig {
  return {
    maxRequestBytes: boundedInteger(environment, 'APOLLO_BACKEND_MAX_REQUEST_BYTES', 65_536, 1_024, 262_144),
    maxSearchResults: boundedInteger(environment, 'APOLLO_BACKEND_MAX_SEARCH_RESULTS', 100, 1, 100),
    providerTimeoutMs: boundedInteger(environment, 'APOLLO_BACKEND_PROVIDER_TIMEOUT_MS', 20_000, 1_000, 60_000),
    defaultProvider: configuredLeadProvider(environment),
    rateLimitWindowMs: boundedInteger(environment, 'APOLLO_BACKEND_RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
    // 20 a minute for everyone, left from the external gateway, stopped one person searching contacts in 15 companies at
    // once (five at a time) on 2 Nov 2026, with «Llegaste al límite disponible por hoy» on screen. Apollo's own limit still
    // answers APOLLO_RATE_LIMITED.
    leadSearchMaxRequests: boundedInteger(environment, 'APOLLO_BACKEND_LEAD_SEARCH_MAX_REQUESTS', 180, 1, 1_000),
    leadSearchMaxPerPerson: boundedInteger(environment, 'APOLLO_BACKEND_LEAD_SEARCH_MAX_PER_PERSON', 60, 1, 1_000),
    enrichMaxRequests: boundedInteger(environment, 'APOLLO_BACKEND_ENRICH_MAX_REQUESTS', 60, 1, 1_000),
  };
}

function safelyEqualSecrets(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: 'INTERNAL_AUTH_REQUIRED' | 'INTERNAL_AUTH_NOT_CONFIGURED' };

export function authenticateInternalRequest(headers: Headers, environment: GatewayEnvironment = process.env): InternalAuthResult {
  const expected = String(environment[INTERNAL_AUTH_ENV] || '').trim();

  // There is intentionally no local-development bypass. A missing production
  // secret therefore fails closed instead of exposing the provider gateway.
  if (!expected) {
    return { ok: false, status: 503, code: 'INTERNAL_AUTH_NOT_CONFIGURED' };
  }

  const provided = String(headers.get(INTERNAL_AUTH_HEADER) || '').trim();
  if (!provided || !safelyEqualSecrets(expected, provided)) {
    return { ok: false, status: 401, code: 'INTERNAL_AUTH_REQUIRED' };
  }

  return { ok: true };
}

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | {
    ok: false;
    status: 400 | 413 | 415;
    code: 'INVALID_JSON' | 'REQUEST_BODY_REQUIRED' | 'REQUEST_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE';
  };

export async function readBoundedJsonBody(request: Request, maxBytes: number): Promise<BoundedJsonResult> {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return { ok: false, status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, code: 'REQUEST_TOO_LARGE' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, code: 'REQUEST_BODY_REQUIRED' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, code: 'REQUEST_TOO_LARGE' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON' };
  } finally {
    reader.releaseLock();
  }

  if (total === 0) return { ok: false, status: 400, code: 'REQUEST_BODY_REQUIRED' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, code: 'INVALID_JSON' };
  }
}

type RateBucket = { used: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const bucketOf = (name: string, config: GatewayConfig, now: number): RateBucket => {
  const bucket = rateBuckets.get(name);
  return !bucket || bucket.resetAt <= now ? { used: 0, resetAt: now + config.rateLimitWindowMs } : bucket;
};
const refused = (limit: number, bucket: RateBucket, now: number): RateLimitResult => ({
  allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
});

/**
 * One request of the route in this minute, when there is room: the instance's ceiling for everyone and, for a search with
 * the person who asked, that person's own share. Without a person, only the ceiling counts.
 */
export function consumeEndpointRateLimit(route: 'lead-search' | 'enrich', config: GatewayConfig, now = Date.now(), person?: string | null): RateLimitResult {
  const limit = route === 'lead-search' ? config.leadSearchMaxRequests : config.enrichMaxRequests;
  const shared = bucketOf(route, config, now);
  if (shared.used >= limit) return refused(limit, shared, now);
  const key = route === 'lead-search' && String(person || '').trim() ? `${route}:${String(person).trim()}` : '';
  if (key) {
    const own = bucketOf(key, config, now);
    if (own.used >= config.leadSearchMaxPerPerson) return refused(config.leadSearchMaxPerPerson, own, now);
    own.used += 1;
    rateBuckets.set(key, own);
  }
  shared.used += 1;
  rateBuckets.set(route, shared);
  // The people's minutes that ended are dropped now and then, so the map stays the size of who searches.
  if (rateBuckets.size > 500) for (const [name, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(name);
  return { allowed: true, limit, remaining: Math.max(0, limit - shared.used), retryAfterSeconds: 0 };
}

/**
 * The same, but a request that arrives seconds before the minute turns waits for it instead of failing: a burst of searches
 * (contacts in many companies at once) takes a little longer rather than leaving companies without results.
 */
export async function waitForEndpointRateLimit(route: 'lead-search' | 'enrich', config: GatewayConfig, person?: string | null, options: {
  maxWaitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number;
} = {}): Promise<RateLimitResult> {
  const now = options.now ?? Date.now;
  const first = consumeEndpointRateLimit(route, config, now(), person);
  if (first.allowed || first.retryAfterSeconds * 1_000 > (options.maxWaitMs ?? 20_000)) return first;
  await (options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))))(first.retryAfterSeconds * 1_000);
  return consumeEndpointRateLimit(route, config, now(), person);
}

export function getRequestId(headers: Headers) {
  const supplied = String(headers.get('x-request-id') || '').trim();
  if (/^[a-zA-Z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  return randomUUID();
}

export type GatewayAuditEvent = {
  route: 'lead-search' | 'enrich' | 'organization-enrich' | 'webhook-result' | 'usage';
  requestId: string;
  status: number;
  outcome: string;
  durationMs: number;
  metrics?: Record<string, number | boolean | string | undefined>;
};

export function auditGatewayRequest(event: GatewayAuditEvent) {
  // Keep audit fields aggregate-only: Cloud Logging should never receive secrets
  // or request payloads containing contact data.
  console.info('[lead-provider-backend-audit]', JSON.stringify({
    service: 'lead-provider-backend',
    timestamp: new Date().toISOString(),
    route: event.route,
    requestId: event.requestId,
    status: event.status,
    outcome: event.outcome,
    durationMs: Math.max(0, Math.round(event.durationMs)),
    ...(event.metrics ? { metrics: event.metrics } : {}),
  }));
}

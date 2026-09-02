import { randomUUID } from 'node:crypto';

import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

const DEFAULT_GATEWAY_USAGE_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/usage';

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function timeoutMs(environment: Record<string, string | undefined>) {
  const configured = Number(environment.APOLLO_USAGE_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.max(1_000, Math.min(60_000, Math.floor(configured)))
    : 25_000;
}

async function loadGatewayUsage(environment: Record<string, string | undefined>) {
  const url = String(environment.APOLLO_USAGE_SERVICE_URL || DEFAULT_GATEWAY_USAGE_URL).trim();
  const secret = String(environment.ENRICHMENT_SERVICE_SECRET || '').trim();
  if (!secret) throw new Error('ENRICHMENT_SERVICE_SECRET_NOT_CONFIGURED');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs(environment));
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'x-api-secret-key': secret,
      },
      signal: controller.signal,
    });
    const payload = object(await response.json().catch(() => null));
    if (!response.ok) throw new Error(text(payload.error, 100) || `APOLLO_USAGE_GATEWAY_HTTP_${response.status}`);
    if (!text(payload.captured_at, 64)) throw new Error('APOLLO_USAGE_GATEWAY_INVALID_RESPONSE');
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureApolloCreditUsageSnapshot(input: {
  requestId?: string;
  sourceRoute?: string;
  environment?: Record<string, string | undefined>;
} = {}) {
  const environment = input.environment || process.env;
  const requestId = text(input.requestId, 128) || randomUUID();
  const sourceRoute = text(input.sourceRoute, 200) || 'internal:apollo-usage';
  const payload = await loadGatewayUsage(environment);
  const capturedAt = text(payload.captured_at, 64) || new Date().toISOString();
  const identity = object(payload.identity);
  const providerUserId = text(identity.user_id, 255);
  const providerTeamId = text(identity.team_id, 255);

  const snapshots = [
    {
      provider: 'apollo',
      scope_type: 'team',
      provider_account_id: providerTeamId,
      provider_user_id: providerUserId,
      cycle_start: null,
      cycle_end: null,
      usage: {
        endpoint: 'usage_stats/credit_usage_stats',
        creditUsage: object(payload.credit_usage),
        providerTeamId,
        captured_at: capturedAt,
      },
      source: 'apollo_gateway',
      request_id: requestId,
      captured_at: capturedAt,
    },
    {
      provider: 'apollo',
      scope_type: 'user',
      provider_account_id: providerTeamId,
      provider_user_id: providerUserId,
      cycle_start: null,
      cycle_end: null,
      usage: {
        endpoint: 'usage_stats/api_usage_stats',
        apiUsage: object(payload.api_usage),
        profileCreditUsage: object(payload.profile_credit_usage),
        providerTeamId,
        providerUserId,
        captured_at: capturedAt,
      },
      source: 'apollo_gateway',
      request_id: requestId,
      captured_at: capturedAt,
    },
  ];

  const { data, error } = await getSupabaseAdminClient()
    .from('antonia_provider_usage_snapshots')
    .insert(snapshots)
    .select('id, provider, scope_type, provider_account_id, provider_user_id, captured_at');
  if (error) throw error;

  await safeAppendAntoniaEvent({
    eventKey: `apollo:usage_snapshot:${requestId}`,
    eventType: 'provider.usage_snapshot',
    actorType: 'provider',
    sourceSystem: 'apollo',
    sourceRoute,
    provider: 'apollo',
    providerRequestId: requestId,
    requestId,
    operationId: requestId,
    status: 'completed',
    outcome: 'captured',
    metrics: { snapshotCount: Array.isArray(data) ? data.length : 0 },
    payload: { providerTeamId, providerUserId },
  });

  return {
    provider: 'apollo',
    requestId,
    capturedAt,
    identity: { userId: providerUserId, teamId: providerTeamId },
    snapshots: data || [],
  };
}

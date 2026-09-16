import { randomUUID } from 'node:crypto';

import { getApolloUsageSnapshot } from '@/lib/server/apollo-provider/apollo';
import { getGatewayConfig } from '@/lib/server/apollo-provider/gateway';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

async function loadProviderUsage(environment: Record<string, string | undefined>) {
  const apiKey = String(environment.APOLLO_API_KEY || '').trim();
  if (!apiKey) throw new Error('APOLLO_PROVIDER_NOT_CONFIGURED');

  const config = getGatewayConfig(environment);
  const usageTimeout = Number(environment.APOLLO_USAGE_TIMEOUT_MS);
  const snapshot = await getApolloUsageSnapshot(apiKey, {
    ...config,
    providerTimeoutMs: Number.isFinite(usageTimeout)
      ? Math.max(1_000, Math.min(60_000, Math.floor(usageTimeout)))
      : 25_000,
  });
  const payload = object(snapshot);
  if (!text(payload.captured_at, 64)) throw new Error('APOLLO_USAGE_INVALID_RESPONSE');
  return payload;
}

export async function captureApolloCreditUsageSnapshot(input: {
  requestId?: string;
  sourceRoute?: string;
  environment?: Record<string, string | undefined>;
} = {}) {
  const environment = input.environment || process.env;
  const requestId = text(input.requestId, 128) || randomUUID();
  const sourceRoute = text(input.sourceRoute, 200) || 'internal:apollo-usage';
  const payload = await loadProviderUsage(environment);
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
      source: 'apollo_direct',
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
      source: 'apollo_direct',
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

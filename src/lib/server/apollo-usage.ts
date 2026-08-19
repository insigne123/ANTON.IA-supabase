import { randomUUID } from 'node:crypto';
import { appendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';
const APOLLO_TIMEOUT_MS = 20_000;

type JsonRecord = Record<string, unknown>;

export type ApolloUsageCapture = {
  requestId?: string;
  sourceRoute?: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeProviderValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeProviderValue(item, depth + 1));

  return Object.keys(value as JsonRecord)
    .filter((key) => !/(api[_-]?key|token|secret|password|authorization|cookie)/i.test(key))
    .slice(0, 200)
    .reduce<JsonRecord>((result, key) => {
      const child = (value as JsonRecord)[key];
      result[key] = /(^|_)(email|phone|mobile)(_|$)/i.test(key)
        ? (text(child) ? '[REDACTED]' : child)
        : sanitizeProviderValue(child, depth + 1);
      return result;
    }, {});
}

function extractCycle(source: JsonRecord) {
  const candidates = [
    source.current_credit_cycle,
    source.credit_cycle,
    source.current_cycle,
    source.cycle,
  ];

  for (const candidate of candidates) {
    const cycle = asRecord(candidate);
    const start = text(cycle.start || cycle.start_date || cycle.starts_at || cycle.from);
    const end = text(cycle.end || cycle.end_date || cycle.ends_at || cycle.to);
    if (start || end) return { start, end };
  }

  return { start: null, end: null };
}

function extractProviderIdentity(profile: JsonRecord, usage: JsonRecord) {
  const profileUser = asRecord(profile.user);
  const profileTeam = asRecord(profile.team);
  const usageTeam = asRecord(usage.team);
  const userId = text(profileUser.id || profile.user_id || profile.id);
  const teamId = text(profileTeam.id || usageTeam.id || profile.team_id || usage.team_id);
  return { userId, teamId };
}

function summarizeCreditFields(value: unknown): JsonRecord {
  const source = asRecord(value);
  const result: JsonRecord = {};
  for (const key of [
    'num_credits_remaining',
    'num_lead_credits',
    'num_lead_credits_used',
    'effective_num_lead_credits',
    'num_direct_dial_credits',
    'num_direct_dial_credits_used',
    'effective_num_direct_dial_credits',
    'total_unified_credits_used',
    'remaining',
    'consumed',
    'used',
    'limit',
  ]) {
    const number = numberOrNull(source[key]);
    if (number !== null) result[key] = number;
  }
  return result;
}

async function fetchApolloJson(path: string, init: RequestInit, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APOLLO_TIMEOUT_MS);
  try {
    const response = await fetch(`${APOLLO_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        ...(init.headers || {}),
      },
    });
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = { raw: raw.slice(0, 500) };
    }
    if (!response.ok) {
      const providerError = asRecord(payload);
      throw new Error(`APOLLO_USAGE_HTTP_${response.status}:${text(providerError.message || providerError.error || raw) || 'unknown_error'}`);
    }
    return asRecord(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureApolloCreditUsageSnapshot(params: ApolloUsageCapture = {}) {
  const apiKey = String(process.env.APOLLO_API_KEY || '').trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY missing');

  const requestId = text(params.requestId) || randomUUID();
  const sourceRoute = text(params.sourceRoute) || 'internal:apollo-usage';
  const capturedAt = new Date().toISOString();

  const [usageStats, profile] = await Promise.all([
    fetchApolloJson('/usage_stats/credit_usage_stats', { method: 'POST', body: '{}' }, apiKey),
    fetchApolloJson('/users/api_profile?include_credit_usage=true', { method: 'GET' }, apiKey),
  ]);

  const identity = extractProviderIdentity(profile, usageStats);
  const usageCycle = extractCycle(usageStats);
  const profileCycle = extractCycle(profile);
  const cycleStart = usageCycle.start || profileCycle.start;
  const cycleEnd = usageCycle.end || profileCycle.end;
  const usagePayload = {
    creditFields: summarizeCreditFields(usageStats),
    cycle: sanitizeProviderValue(usageStats.current_credit_cycle || usageStats.credit_cycle || usageStats.current_cycle || usageStats.cycle),
    creditUsage: sanitizeProviderValue(usageStats.credit_usage || usageStats.credit_usage_stats || usageStats.usage || usageStats.stats),
  };
  const profilePayload = {
    creditFields: summarizeCreditFields(profile),
    cycle: sanitizeProviderValue(profile.current_credit_cycle || profile.credit_cycle || profile.current_cycle || profile.cycle),
    creditUsage: sanitizeProviderValue(profile.credit_usage || profile.credit_usage_stats || profile.usage || profile.stats),
  };

  const snapshots = [
    {
      provider: 'apollo',
      scope_type: 'team',
      provider_account_id: identity.teamId,
      provider_user_id: identity.userId,
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
      usage: {
        endpoint: 'usage_stats/credit_usage_stats',
        ...usagePayload,
        providerTeamId: identity.teamId,
        captured_at: capturedAt,
      },
      source: 'apollo_api',
      request_id: requestId,
      captured_at: capturedAt,
    },
    {
      provider: 'apollo',
      scope_type: 'user',
      provider_account_id: identity.teamId,
      provider_user_id: identity.userId,
      cycle_start: cycleStart || profileCycle.start,
      cycle_end: cycleEnd || profileCycle.end,
      usage: {
        endpoint: 'users/api_profile?include_credit_usage=true',
        ...profilePayload,
        providerTeamId: identity.teamId,
        providerUserId: identity.userId,
        captured_at: capturedAt,
      },
      source: 'apollo_api',
      request_id: requestId,
      captured_at: capturedAt,
    },
  ];

  const { data, error } = await getSupabaseAdminClient()
    .from('antonia_provider_usage_snapshots')
    .insert(snapshots)
    .select('id, provider, scope_type, provider_account_id, provider_user_id, cycle_start, cycle_end, captured_at');
  if (error) throw error;

  await appendAntoniaEvent({
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
    metrics: {
      snapshotCount: Array.isArray(data) ? data.length : 0,
      team: summarizeCreditFields(usageStats),
      user: summarizeCreditFields(profile),
    },
    payload: {
      scope: 'team_and_user',
      providerTeamId: identity.teamId,
      providerUserId: identity.userId,
      cycleStart,
      cycleEnd,
    },
  });

  return {
    provider: 'apollo',
    requestId,
    capturedAt,
    cycle: { start: cycleStart, end: cycleEnd },
    identity,
    snapshots: data || [],
    team: summarizeCreditFields(usageStats),
    user: summarizeCreditFields(profile),
  };
}

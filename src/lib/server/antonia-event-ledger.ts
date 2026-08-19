import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export type AntoniaActorType = 'user' | 'agent' | 'worker' | 'cron' | 'webhook' | 'provider' | 'system';
export type AntoniaSourceConfidence = 'observed' | 'derived' | 'backfill' | 'unknown_actor' | 'diagnostic_test';
export type AntoniaPrivacyClass = 'operational' | 'sensitive' | 'redacted';

export type AntoniaEventInput = {
  eventKey?: string;
  eventType: string;
  eventVersion?: number;
  occurredAt?: string | Date;
  organizationId?: string | null;
  actorId?: string | null;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;
  actorType?: AntoniaActorType;
  entityType?: string | null;
  entityId?: string | null;
  leadId?: string | null;
  externalEntityId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  campaignId?: string | null;
  campaignStepId?: string | null;
  contactedId?: string | null;
  researchJobId?: string | null;
  dispatchId?: string | null;
  sourceSystem?: string;
  sourceRoute?: string | null;
  provider?: string | null;
  providerRequestId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  operationId?: string | null;
  idempotencyKey?: string | null;
  attemptNumber?: number;
  status?: string | null;
  outcome?: string | null;
  severity?: string | null;
  errorCode?: string | null;
  durationMs?: number | null;
  metrics?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  payloadHash?: string | null;
  sourceConfidence?: AntoniaSourceConfidence;
  privacyClass?: AntoniaPrivacyClass;
  payloadRetentionUntil?: string | Date | null;
  retentionUntil?: string | Date | null;
  message?: string | null;
};

export type AntoniaEventResult = {
  id: string;
  event_key: string;
  created: boolean;
};

export type AntoniaEventQuery = {
  organizationId?: string;
  actorUserId?: string;
  eventType?: string;
  entityType?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
};

export type AntoniaRollupQuery = {
  organizationId?: string;
  actorUserId?: string;
  eventType?: string;
  from?: string | Date;
  to?: string | Date;
  limit?: number;
};

const SECRET_KEY_PATTERN = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|session)/i;
const PII_KEY_PATTERN = /(^|_)(email|phone|mobile|linkedin|url|address|name)(_|$)/i;
const MAX_STRING_LENGTH = 500;

function normalizeString(value: unknown, maxLength = 300): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function toIso(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function toUtcDate(value: string | Date | null | undefined): string | undefined {
  const normalized = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return toIso(value)?.slice(0, 10);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function redactValue(value: unknown, key = '', depth = 0): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return '[REDACTED]';

  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 4) return '[TRUNCATED]';

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (PII_KEY_PATTERN.test(key) && normalized) return `sha256:${sha256(normalized.toLowerCase())}`;
    return normalized.slice(0, MAX_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, key, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .slice(0, 100)
      .reduce<Record<string, unknown>>((result, childKey) => {
        result[childKey] = redactValue((value as Record<string, unknown>)[childKey], childKey, depth + 1);
        return result;
      }, {});
  }

  return String(value).slice(0, MAX_STRING_LENGTH);
}

function normalizePayload(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const result = redactValue(value || {}) as Record<string, unknown>;
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

function redactMessage(value: unknown): string | null {
  const normalized = normalizeString(value, MAX_STRING_LENGTH);
  if (!normalized) return null;
  return normalized
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL_REDACTED]')
    .replace(/\+?[0-9][0-9().\s-]{7,}[0-9]/g, '[PHONE_REDACTED]');
}

function buildEventKey(input: AntoniaEventInput, occurredAt: string | undefined): string {
  const explicit = normalizeString(input.eventKey, 300);
  if (explicit) return explicit;

  const dedupeSeed = {
    eventType: input.eventType,
    sourceSystem: input.sourceSystem || 'antonia',
    operationId: input.operationId || null,
    idempotencyKey: input.idempotencyKey || null,
    correlationId: input.correlationId || null,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    attemptNumber: input.attemptNumber || 1,
    occurredAt: occurredAt || null,
  };

  if (!dedupeSeed.operationId && !dedupeSeed.idempotencyKey && !dedupeSeed.correlationId) {
    dedupeSeed.occurredAt = randomUUID();
  }

  return `antonia:${sha256(stableJson(dedupeSeed))}`;
}

function normalizeEvent(input: AntoniaEventInput): Record<string, unknown> {
  const eventType = normalizeString(input.eventType, 150);
  if (!eventType) throw new Error('eventType is required');

  const occurredAt = toIso(input.occurredAt);
  const retentionUntil = toIso(input.retentionUntil);
  const payloadRetentionUntil = toIso(input.payloadRetentionUntil);
  const payload = normalizePayload(input.payload);
  const metrics = normalizePayload(input.metrics);
  const actorId = normalizeString(input.actorId || input.actorUserId, 300);
  const organizationId = normalizeString(input.organizationId, 300);

  return {
    event_key: buildEventKey(input, occurredAt),
    event_type: eventType,
    event_version: Math.max(1, Math.trunc(Number(input.eventVersion) || 1)),
    ...(occurredAt ? { occurred_at: occurredAt } : {}),
    ...(organizationId ? { organization_id: organizationId } : {}),
    ...(actorId ? { actor_id: actorId, actor_user_id: actorId } : {}),
    ...(input.initiatedByUserId ? { initiated_by_user_id: normalizeString(input.initiatedByUserId, 300) } : {}),
    actor_type: input.actorType || 'system',
    ...(normalizeString(input.entityType) ? { entity_type: normalizeString(input.entityType) } : {}),
    ...(normalizeString(input.entityId, 500) ? { entity_id: normalizeString(input.entityId, 500) } : {}),
    ...(normalizeString(input.leadId, 500) ? { lead_id: normalizeString(input.leadId, 500) } : {}),
    ...(normalizeString(input.externalEntityId, 500) ? { external_entity_id: normalizeString(input.externalEntityId, 500) } : {}),
    ...(normalizeString(input.missionId, 500) ? { mission_id: normalizeString(input.missionId, 500) } : {}),
    ...(normalizeString(input.taskId, 500) ? { task_id: normalizeString(input.taskId, 500) } : {}),
    ...(normalizeString(input.campaignId, 500) ? { campaign_id: normalizeString(input.campaignId, 500) } : {}),
    ...(normalizeString(input.campaignStepId, 500) ? { campaign_step_id: normalizeString(input.campaignStepId, 500) } : {}),
    ...(normalizeString(input.contactedId, 500) ? { contacted_id: normalizeString(input.contactedId, 500) } : {}),
    ...(normalizeString(input.researchJobId, 500) ? { research_job_id: normalizeString(input.researchJobId, 500) } : {}),
    ...(normalizeString(input.dispatchId, 500) ? { dispatch_id: normalizeString(input.dispatchId, 500) } : {}),
    source_system: normalizeString(input.sourceSystem, 100) || 'antonia',
    ...(normalizeString(input.sourceRoute, 300) ? { source_route: normalizeString(input.sourceRoute, 300) } : {}),
    ...(normalizeString(input.provider, 100) ? { provider: normalizeString(input.provider, 100) } : {}),
    ...(normalizeString(input.providerRequestId, 300) ? { provider_request_id: normalizeString(input.providerRequestId, 300) } : {}),
    ...(normalizeString(input.requestId, 300) ? { request_id: normalizeString(input.requestId, 300) } : {}),
    ...(normalizeString(input.correlationId, 300) ? { correlation_id: normalizeString(input.correlationId, 300) } : {}),
    ...(normalizeString(input.causationId, 300) ? { causation_id: normalizeString(input.causationId, 300) } : {}),
    ...(normalizeString(input.operationId, 300) ? { operation_id: normalizeString(input.operationId, 300) } : {}),
    ...(normalizeString(input.idempotencyKey, 300) ? { idempotency_key: normalizeString(input.idempotencyKey, 300) } : {}),
    attempt_number: Math.max(1, Math.trunc(Number(input.attemptNumber) || 1)),
    ...(normalizeString(input.status, 100) ? { status: normalizeString(input.status, 100) } : {}),
    ...(normalizeString(input.outcome, 150) ? { outcome: normalizeString(input.outcome, 150) } : {}),
    ...(normalizeString(input.severity, 50) ? { severity: normalizeString(input.severity, 50) } : {}),
    ...(normalizeString(input.errorCode, 150) ? { error_code: normalizeString(input.errorCode, 150) } : {}),
    ...(Number.isFinite(Number(input.durationMs)) ? { duration_ms: Math.max(0, Math.trunc(Number(input.durationMs))) } : {}),
    metrics,
    redacted_payload: payload,
    payload_hash: normalizeString(input.payloadHash, 200) || `sha256:${sha256(stableJson(payload))}`,
    source_confidence: input.sourceConfidence || 'observed',
    privacy_class: input.privacyClass || 'operational',
    ...(payloadRetentionUntil ? { payload_retention_until: payloadRetentionUntil } : {}),
    ...(retentionUntil ? { retention_until: retentionUntil } : {}),
    ...(redactMessage(input.message) ? { message: redactMessage(input.message) } : {}),
  };
}

export async function appendAntoniaEvent(input: AntoniaEventInput): Promise<AntoniaEventResult> {
  const { data, error } = await getSupabaseAdminClient().rpc('append_antonia_event_v1', {
    p_event: normalizeEvent(input),
  });

  if (error) throw error;
  const result = data as Partial<AntoniaEventResult> | null;
  if (!result?.id || !result.event_key || typeof result.created !== 'boolean') {
    throw new Error('Invalid append_antonia_event_v1 response');
  }

  return result as AntoniaEventResult;
}

export async function safeAppendAntoniaEvent(input: AntoniaEventInput): Promise<AntoniaEventResult | null> {
  if (!String(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
    || !String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) {
    return null;
  }

  try {
    return await appendAntoniaEvent(input);
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null
      ? String((error as { code?: unknown }).code || '')
      : '';
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (['PGRST202', 'PGRST205'].includes(errorCode)
      || /append_antonia_event_v1|schema cache/i.test(errorMessage)) {
      return null;
    }
    console.error('[antonia-event-ledger] append failed', {
      eventType: input.eventType,
      sourceSystem: input.sourceSystem,
      error: error instanceof Error
        ? error.message
        : typeof error === 'object'
          ? JSON.stringify(error)
          : String(error),
    });
    return null;
  }
}

export async function queryAntoniaEvents(filters: AntoniaEventQuery = {}) {
  const { data, error } = await (getSupabaseAdminClient() as any).rpc('query_antonia_event_ledger_v1', {
    p_organization_id: filters.organizationId || null,
    p_actor_user_id: filters.actorUserId || null,
    p_event_type: filters.eventType || null,
    p_entity_type: filters.entityType || null,
    p_from: toIso(filters.from) || null,
    p_to: toIso(filters.to) || null,
    p_limit: Math.max(1, Math.min(1000, Math.trunc(Number(filters.limit) || 200))),
  });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function summarizeAntoniaEvents(filters: Pick<AntoniaEventQuery, 'organizationId' | 'actorUserId' | 'from' | 'to'> = {}) {
  const { data, error } = await (getSupabaseAdminClient() as any).rpc('summarize_antonia_events_v1', {
    p_organization_id: filters.organizationId || null,
    p_actor_user_id: filters.actorUserId || null,
    p_from: toIso(filters.from) || null,
    p_to: toIso(filters.to) || null,
  });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function queryAntoniaDailyRollups(filters: AntoniaRollupQuery = {}) {
  const { data, error } = await (getSupabaseAdminClient() as any).rpc('query_antonia_event_rollups_daily_v1', {
    p_organization_id: filters.organizationId || null,
    p_actor_user_id: filters.actorUserId || null,
    p_event_type: filters.eventType || null,
    p_from: toUtcDate(filters.from) || null,
    p_to: toUtcDate(filters.to) || null,
    p_limit: Math.max(1, Math.min(5000, Math.trunc(Number(filters.limit) || 1000))),
  });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function refreshAntoniaDailyRollups(filters: Pick<AntoniaRollupQuery, 'from' | 'to'> = {}) {
  const params: Record<string, string> = {};
  const from = toUtcDate(filters.from);
  const to = toUtcDate(filters.to);
  if (from) params.p_from = from;
  if (to) params.p_to = to;

  const { data, error } = await (getSupabaseAdminClient() as any).rpc('refresh_antonia_event_rollups_daily_v1', params);
  if (error) throw error;
  return Math.max(0, Number(data) || 0);
}

export async function redactExpiredAntoniaEventPayloads(limit = 500) {
  const { data, error } = await (getSupabaseAdminClient() as any).rpc('redact_expired_antonia_event_payloads_v1', {
    p_limit: Math.max(1, Math.min(5000, Math.trunc(Number(limit) || 500))),
  });

  if (error) {
    const errorCode = String(error.code || '');
    if (['PGRST202', 'PGRST205'].includes(errorCode) || /schema cache/i.test(String(error.message || ''))) return 0;
    throw error;
  }
  return Math.max(0, Number(data) || 0);
}

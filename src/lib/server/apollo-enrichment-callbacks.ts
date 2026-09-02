import { createHash, randomBytes } from 'node:crypto';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const APOLLO_TARGET_TABLES = [
  'enriched_leads',
  'enriched_opportunities',
  'people_search_leads',
] as const;

export const APOLLO_REQUESTED_FIELDS = [
  'person.email',
  'person.phone_numbers',
] as const;

export type ApolloTargetTable = (typeof APOLLO_TARGET_TABLES)[number];
export type ApolloRequestedField = (typeof APOLLO_REQUESTED_FIELDS)[number];

type JsonRecord = Record<string, unknown>;
type ServiceClient = any;

export type ApolloWebhookCandidate = {
  apollo_person_id?: string;
  email?: string;
  email_status?: string;
  phone_numbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
    position: string;
    status: string;
  }>;
  primary_phone?: string;
};

export type ParsedApolloWebhook = {
  providerRequestId: string;
  providerStatus: string;
  candidate: ApolloWebhookCandidate;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TARGETS = new Set<string>(APOLLO_TARGET_TABLES);
const ALLOWED_FIELDS = new Set<string>(APOLLO_REQUESTED_FIELDS);

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function requiredUuid(value: string, name: string) {
  const normalized = text(value, 36);
  if (!normalized || !UUID_RE.test(normalized)) throw new Error(`INVALID_APOLLO_${name}`);
  return normalized.toLowerCase();
}

function requiredText(value: string, name: string, maxLength: number) {
  const normalized = text(value, maxLength);
  if (!normalized) throw new Error(`INVALID_APOLLO_${name}`);
  return normalized;
}

function normalizeRequestedFields(fields: readonly string[]) {
  const normalized = [...new Set(fields.map((field) => String(field || '').trim()))]
    .filter((field): field is ApolloRequestedField => ALLOWED_FIELDS.has(field));
  if (normalized.length === 0 || normalized.length !== fields.length) {
    throw new Error('INVALID_APOLLO_REQUESTED_FIELDS');
  }
  return normalized;
}

export function hashApolloCallbackToken(token: string) {
  if (!TOKEN_RE.test(token)) throw new Error('INVALID_APOLLO_CALLBACK_TOKEN');
  return createHash('sha256').update(token).digest('hex');
}

export function resolveApolloWebhookUrl(
  token: string,
  environment: Record<string, string | undefined> = process.env,
) {
  if (!TOKEN_RE.test(token)) return null;
  const base = String(
    environment.CANONICAL_APP_URL
    || environment.NEXT_PUBLIC_APP_URL
    || environment.NEXT_PUBLIC_BASE_URL
    || '',
  ).trim();
  if (!base) return null;

  try {
    const url = new URL(`/api/apollo-webhook/${token}`, base);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function callbackIdempotencyKey(operationId: string, targetTable: string, targetId: string) {
  return createHash('sha256')
    .update(`${operationId}\n${targetTable}\n${targetId}`)
    .digest('hex');
}

export async function createApolloEnrichmentCallback(
  input: {
    operationId: string;
    claimToken: string;
    userId: string;
    organizationId: string;
    quotaResource: 'enrich' | 'investigate';
    targetTable: ApolloTargetTable;
    targetId: string;
    apolloPersonId?: string;
    requestedFields: readonly ApolloRequestedField[];
    expiresAt?: Date;
    environment?: Record<string, string | undefined>;
  },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  const targetTable = String(input.targetTable || '').trim();
  if (!ALLOWED_TARGETS.has(targetTable)) throw new Error('INVALID_APOLLO_TARGET_TABLE');
  const operationId = requiredText(input.operationId, 'OPERATION_ID', 200);
  const claimToken = requiredUuid(input.claimToken, 'CLAIM_TOKEN');
  const userId = requiredUuid(input.userId, 'USER_ID');
  const organizationId = requiredUuid(input.organizationId, 'ORGANIZATION_ID');
  const targetId = requiredText(input.targetId, 'TARGET_ID', 255);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashApolloCallbackToken(token);
  const webhookUrl = resolveApolloWebhookUrl(token, input.environment);
  if (!webhookUrl) throw new Error('APOLLO_WEBHOOK_URL_NOT_CONFIGURED');
  const expiresAt = input.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1_000);

  const { data, error } = await client.rpc('create_apollo_enrichment_callback_v1', {
    p_user_id: userId,
    p_organization_id: organizationId,
    p_quota_resource: input.quotaResource,
    p_target_table: targetTable,
    p_target_id: targetId,
    p_apollo_person_id: text(input.apolloPersonId, 255),
    p_token_hash: tokenHash,
    p_idempotency_key: callbackIdempotencyKey(operationId, targetTable, targetId),
    p_operation_id: operationId,
    p_claim_token: claimToken,
    p_requested_fields: normalizeRequestedFields(input.requestedFields),
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error('APOLLO_CALLBACK_CREATE_FAILED');

  const result = object(data);
  const outcome = text(result?.outcome, 64);
  const callbackId = text(result?.callbackId, 36);
  if (outcome === 'replay' && callbackId && UUID_RE.test(callbackId)) {
    const { data: replacementData, error: replacementError } = await client.rpc(
      'replace_unsubmitted_apollo_callback_v1',
      {
        p_callback_id: callbackId,
        p_user_id: userId,
        p_organization_id: organizationId,
        p_operation_id: operationId,
        p_claim_token: claimToken,
        p_token_hash: tokenHash,
        p_expires_at: expiresAt.toISOString(),
      },
    );
    if (replacementError) throw new Error('APOLLO_CALLBACK_REPLACEMENT_FAILED');
    if (text(object(replacementData)?.outcome, 64) === 'replaced') {
      return { callbackId, token, tokenHash, webhookUrl, claimToken };
    }
    throw new Error('APOLLO_CALLBACK_REPLAY_REQUIRES_OPERATION_RESPONSE');
  }
  if (outcome !== 'created' || !callbackId || !UUID_RE.test(callbackId)) {
    if (outcome === 'target_not_found') throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
    if (outcome === 'target_suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
    if (outcome === 'target_busy') throw new Error('APOLLO_ENRICHMENT_TARGET_BUSY');
    if (outcome === 'quota_claim_not_owned') throw new Error('APOLLO_QUOTA_CLAIM_NOT_OWNED');
    if (outcome === 'idempotency_conflict') throw new Error('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
    throw new Error('INVALID_APOLLO_CALLBACK_CREATE_RESPONSE');
  }

  return { callbackId, token, tokenHash, webhookUrl, claimToken };
}

export async function markApolloEnrichmentCallbackSubmitted(
  input: { callbackId: string; tokenHash: string; claimToken: string },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  if (!SHA256_RE.test(input.tokenHash)) throw new Error('INVALID_APOLLO_TOKEN_HASH');
  const { data, error } = await client.rpc('mark_apollo_enrichment_callback_submitted_v1', {
    p_callback_id: requiredUuid(input.callbackId, 'CALLBACK_ID'),
    p_token_hash: input.tokenHash,
    p_claim_token: requiredUuid(input.claimToken, 'CLAIM_TOKEN'),
  });
  if (error) throw new Error('APOLLO_CALLBACK_SUBMISSION_MARK_FAILED');
  const outcome = text(object(data)?.outcome, 64);
  if (outcome !== 'submitted') {
    if (outcome === 'provider_outcome_unknown') throw new Error('APOLLO_PROVIDER_OUTCOME_UNKNOWN');
    if (outcome === 'quota_claim_not_owned') throw new Error('APOLLO_QUOTA_CLAIM_NOT_OWNED');
    if (outcome === 'target_suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
    if (outcome === 'target_not_found') throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
    throw new Error('INVALID_APOLLO_CALLBACK_SUBMISSION_RESPONSE');
  }
}

export async function bindApolloEnrichmentCallback(
  input: { callbackId: string; providerRequestId: string; apolloPersonId?: string },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  const { data, error } = await client.rpc('bind_apollo_enrichment_callback_v1', {
    p_callback_id: requiredUuid(input.callbackId, 'CALLBACK_ID'),
    p_provider_request_id: requiredText(input.providerRequestId, 'PROVIDER_REQUEST_ID', 255),
    p_apollo_person_id: text(input.apolloPersonId, 255),
  });
  if (error) throw new Error('APOLLO_CALLBACK_BIND_FAILED');
  const outcome = text(object(data)?.outcome, 64);
  if (outcome === 'bound' || outcome === 'unknown_callback' || outcome === 'provider_request_mismatch' || outcome === 'apollo_person_mismatch') {
    return outcome;
  }
  throw new Error('INVALID_APOLLO_CALLBACK_BIND_RESPONSE');
}

export async function applyApolloEnrichmentCandidate(
  input: {
    tokenHash: string;
    providerRequestId: string;
    providerStatus: string;
    payloadHash: string;
    candidate: ApolloWebhookCandidate;
  },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  if (!SHA256_RE.test(input.tokenHash) || !SHA256_RE.test(input.payloadHash)) {
    throw new Error('INVALID_APOLLO_CALLBACK_HASH');
  }
  const { data, error } = await client.rpc('apply_apollo_enrichment_callback_v1', {
    p_token_hash: input.tokenHash,
    p_provider_request_id: requiredText(input.providerRequestId, 'PROVIDER_REQUEST_ID', 255),
    p_provider_status: requiredText(input.providerStatus, 'PROVIDER_STATUS', 64),
    p_payload_hash: input.payloadHash,
    p_candidate: input.candidate,
  });
  if (error) throw new Error('APOLLO_CALLBACK_APPLY_FAILED');
  const outcome = text(object(data)?.outcome, 64);
  if (outcome === 'processed' || outcome === 'duplicate' || outcome === 'unknown_callback'
    || outcome === 'provider_request_mismatch' || outcome === 'apollo_person_mismatch'
    || outcome === 'target_not_found' || outcome === 'unsupported_provider_status') {
    return outcome;
  }
  throw new Error('INVALID_APOLLO_CALLBACK_APPLY_RESPONSE');
}

export async function settleApolloEnrichmentCallback(
  input: {
    callbackId: string;
    terminalState: 'no_data' | 'failed' | 'cancelled' | 'expired';
    errorCode?: string;
  },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  const { data, error } = await client.rpc('settle_apollo_enrichment_callback_v1', {
    p_callback_id: requiredUuid(input.callbackId, 'CALLBACK_ID'),
    p_terminal_state: input.terminalState,
    p_error_code: text(input.errorCode, 100),
  });
  if (error) throw new Error('APOLLO_CALLBACK_SETTLEMENT_FAILED');
  const outcome = text(object(data)?.outcome, 64);
  if (outcome === 'settled' || outcome === 'duplicate' || outcome === 'unknown_callback' || outcome === 'target_not_found') {
    return outcome;
  }
  throw new Error('INVALID_APOLLO_CALLBACK_SETTLEMENT_RESPONSE');
}

function normalizePhone(value: unknown) {
  const input = object(value);
  const raw = text(
    input?.sanitized_number
    || input?.raw_number
    || input?.number
    || input?.phone_number,
    64,
  );
  if (!raw) return null;
  const sanitized = raw.replace(/[^+\d]/g, '');
  if (!/^\+?\d{3,20}$/.test(sanitized)) return null;
  return {
    raw_number: raw,
    sanitized_number: sanitized,
    type: text(input?.type || input?.type_cd, 32) || 'phone',
    position: text(input?.position, 32) || 'current',
    status: text(input?.status, 32) || 'unknown',
  };
}

export function parseApolloWebhookPayload(payload: unknown, requestIdHeader?: string | null): ParsedApolloWebhook | null {
  const root = object(payload);
  if (!root) return null;
  const data = object(root.data);
  const people = Array.isArray(root.people) ? root.people : [];
  const person = object(root.person) || object(data?.person) || object(people[0]) || data || root;
  const providerRequestId = text(
    root.request_id || root.requestId || data?.request_id || requestIdHeader,
    255,
  );
  if (!providerRequestId) return null;

  const apolloPersonId = text(person.id || person.person_id || person.apollo_id, 255);
  const email = text(person.email || person.work_email, 320);
  const emailStatus = text(person.email_status, 64);
  const rawPhones = Array.isArray(person.phone_numbers) ? person.phone_numbers.slice(0, 20) : [];
  const extraPhones = [person.phone_number, person.mobile_phone, person.work_phone]
    .filter(Boolean)
    .map((number) => ({ number }));
  const phones = [...rawPhones, ...extraPhones]
    .map(normalizePhone)
    .filter((phone): phone is NonNullable<typeof phone> => phone !== null);
  const uniquePhones = [...new Map(phones.map((phone) => [phone.sanitized_number, phone])).values()].slice(0, 20);
  const candidate: ApolloWebhookCandidate = {};
  if (apolloPersonId) candidate.apollo_person_id = apolloPersonId;
  if (email && EMAIL_RE.test(email)) candidate.email = email;
  if (emailStatus) candidate.email_status = emailStatus;
  if (uniquePhones.length > 0) {
    candidate.phone_numbers = uniquePhones;
    candidate.primary_phone = uniquePhones[0].sanitized_number;
  }

  const rawStatus = text(root.status || data?.status, 64)?.toUpperCase();
  const providerStatus = rawStatus || (Object.keys(candidate).length > 0 ? 'SUCCEEDED' : 'NO_DATA');
  return { providerRequestId, providerStatus, candidate };
}

export async function processApolloWebhookDelivery(
  input: { token: string; rawBody: Buffer; requestIdHeader?: string | null },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  let tokenHash: string;
  try {
    tokenHash = hashApolloCallbackToken(input.token);
  } catch {
    return { kind: 'unauthorized' as const };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    return { kind: 'invalid_payload' as const };
  }
  const parsed = parseApolloWebhookPayload(payload, input.requestIdHeader);
  if (!parsed) return { kind: 'invalid_payload' as const };

  const outcome = await applyApolloEnrichmentCandidate({
    tokenHash,
    providerRequestId: parsed.providerRequestId,
    providerStatus: parsed.providerStatus,
    payloadHash: createHash('sha256').update(input.rawBody).digest('hex'),
    candidate: parsed.candidate,
  }, client);
  return { kind: 'processed' as const, outcome };
}

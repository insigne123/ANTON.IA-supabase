import { createHmac, timingSafeEqual } from 'node:crypto';

import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const FULLENRICH_CALLBACK_CUSTOM_KEY = 'fullenrich_callback_id';

export const FULLENRICH_TARGET_TABLES = [
  'enriched_leads',
  'enriched_opportunities',
  'people_search_leads',
] as const;

export const FULLENRICH_REQUESTED_FIELDS = [
  'contact.work_emails',
  'contact.phones',
] as const;

export const FULLENRICH_TERMINAL_PROVIDER_STATUSES = [
  'FINISHED',
  'CANCELED',
  'CREDITS_INSUFFICIENT',
  'RATE_LIMIT',
  'UNKNOWN',
] as const;

export type FullEnrichTargetTable = (typeof FULLENRICH_TARGET_TABLES)[number];
export type FullEnrichRequestedField = (typeof FULLENRICH_REQUESTED_FIELDS)[number];

type JsonRecord = Record<string, unknown>;
type ServiceClient = any;

type EmailCandidate = {
  email: string;
  status?: string;
};

type PhoneCandidate = {
  number: string;
  region?: string;
};

type FullEnrichContactResult = {
  workEmail: EmailCandidate | null;
  phones: PhoneCandidate[];
};

export type FullEnrichWebhookCandidate = {
  work_email?: EmailCandidate;
  phone_numbers?: Array<Record<string, string>>;
  primary_phone?: string;
};

export type ParsedFullEnrichWebhook = {
  providerEnrichmentId: string;
  providerStatus: string;
  entries: Array<{
    callbackId: string;
    candidate: FullEnrichWebhookCandidate;
  }>;
};

export type FullEnrichWebhookProcessingResult =
  | { kind: 'unauthorized' }
  | { kind: 'invalid_payload' }
  | {
    kind: 'processed';
    received: number;
    processed: number;
    duplicates: number;
    ignored: number;
  };

export type FullEnrichRetrievedResultProcessingResult =
  | { kind: 'invalid_payload' }
  | { kind: 'in_progress' }
  | {
    kind: 'processed';
    providerStatus: string;
    callbackIds: string[];
    received: number;
    processed: number;
    duplicates: number;
    ignored: number;
  };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA1_RE = /^[0-9a-f]{40}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+0-9().\-\s]{3,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_.:-]+$/;
const ALLOWED_FIELDS = new Set<string>(FULLENRICH_REQUESTED_FIELDS);
const ALLOWED_TARGET_TABLES = new Set<string>(FULLENRICH_TARGET_TABLES);
const TERMINAL_PROVIDER_STATUSES = new Set<string>(FULLENRICH_TERMINAL_PROVIDER_STATUSES);

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function token(value: unknown, maxLength: number): string | null {
  const normalized = text(value, maxLength);
  return normalized && TOKEN_RE.test(normalized) ? normalized : null;
}

function uuid(value: unknown): string | null {
  const normalized = text(value, 36);
  return normalized && UUID_RE.test(normalized) ? normalized.toLowerCase() : null;
}

function email(value: unknown): EmailCandidate | null {
  const input = object(value);
  const address = text(input?.email, 320);
  if (!address || !EMAIL_RE.test(address)) return null;

  const status = token(input?.status, 64);
  return status ? { email: address, status } : { email: address };
}

function firstEmail(primary: unknown, list: unknown): EmailCandidate | null {
  const primaryEmail = email(primary);
  if (primaryEmail) return primaryEmail;
  if (!Array.isArray(list) || list.length > 50) return null;

  for (const value of list) {
    const item = email(value);
    if (item) return item;
  }
  return null;
}

function phone(value: unknown): PhoneCandidate | null {
  const input = object(value);
  const raw = text(input?.number, 64);
  if (!raw || !PHONE_RE.test(raw)) return null;

  const normalized = raw.replace(/[^+\d]/g, '');
  if (!/^\+?\d{3,20}$/.test(normalized)) return null;

  const region = text(input?.region, 2);
  return region && /^[A-Za-z]{2}$/.test(region)
    ? { number: normalized, region: region.toUpperCase() }
    : { number: normalized };
}

function phones(primary: unknown, list: unknown): PhoneCandidate[] {
  const values = [primary, ...(Array.isArray(list) && list.length <= 50 ? list : [])];
  const unique = new Map<string, PhoneCandidate>();

  for (const value of values) {
    const item = phone(value);
    if (!item || unique.has(item.number)) continue;
    unique.set(item.number, item);
    if (unique.size === 20) break;
  }

  return [...unique.values()];
}

function contactResult(value: unknown): FullEnrichContactResult {
  const input = object(value);
  return {
    workEmail: firstEmail(input?.most_probable_work_email, input?.work_emails),
    phones: phones(input?.most_probable_phone, input?.phones),
  };
}

export function verifyFullEnrichWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | null | undefined,
  apiKey: string | null | undefined,
): boolean {
  const signature = String(signatureHeader || '').trim().toLowerCase();
  const secret = String(apiKey || '').trim();
  if (!secret || !SHA1_RE.test(signature)) return false;

  const expected = createHmac('sha1', secret).update(rawBody).digest();
  const provided = Buffer.from(signature, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function fullEnrichWebhookPayloadFingerprint(rawBody: Buffer, apiKey: string): string {
  return createHmac('sha256', apiKey).update(rawBody).digest('hex');
}

export function isFullEnrichTerminalProviderStatus(value: unknown) {
  return TERMINAL_PROVIDER_STATUSES.has(String(value || '').trim().toUpperCase());
}

export function parseFullEnrichWebhookPayload(payload: unknown): ParsedFullEnrichWebhook | null {
  const input = object(payload);
  const providerEnrichmentId = token(input?.id, 200);
  const providerStatus = token(input?.status, 64);
  const data = input?.data;

  if (!providerEnrichmentId || !providerStatus || !Array.isArray(data) || data.length > 100) return null;

  const entries: ParsedFullEnrichWebhook['entries'] = [];
  for (const rawEntry of data) {
    const entry = object(rawEntry);
    const custom = object(entry?.custom);
    const callbackId = uuid(custom?.[FULLENRICH_CALLBACK_CUSTOM_KEY]);
    if (!callbackId) continue;

    entries.push({
      callbackId,
      candidate: buildFullEnrichWebhookCandidate(contactResult(entry?.contact_info)),
    });
  }

  return {
    providerEnrichmentId,
    providerStatus: providerStatus.toUpperCase(),
    entries,
  };
}

export function buildFullEnrichWebhookCandidate(result: FullEnrichContactResult): FullEnrichWebhookCandidate {
  const candidate: FullEnrichWebhookCandidate = {};

  if (result.workEmail) candidate.work_email = result.workEmail;
  if (result.phones.length > 0) {
    candidate.phone_numbers = result.phones.map((item) => ({
      raw_number: item.number,
      sanitized_number: item.number,
      type: 'mobile',
      position: 'current',
      status: 'verified',
      ...(item.region ? { region: item.region } : {}),
    }));
    candidate.primary_phone = result.phones[0].number;
  }

  return candidate;
}

function normalizeRequestedFields(fields: readonly string[]): FullEnrichRequestedField[] {
  const normalized = [...new Set(fields.map((field) => String(field || '').trim()))]
    .filter((field): field is FullEnrichRequestedField => ALLOWED_FIELDS.has(field));
  if (normalized.length !== fields.length || normalized.length === 0) {
    throw new Error('INVALID_FULLENRICH_REQUESTED_FIELDS');
  }
  return normalized;
}

function requiredUuid(value: string, name: string): string {
  const normalized = uuid(value);
  if (!normalized) throw new Error(`INVALID_FULLENRICH_${name}`);
  return normalized;
}

function requiredText(value: string, name: string, maxLength: number): string {
  const normalized = text(value, maxLength);
  if (!normalized) throw new Error(`INVALID_FULLENRICH_${name}`);
  return normalized;
}

export async function createFullEnrichEnrichmentCallback(
  input: {
    operationId: string;
    userId: string;
    organizationId: string;
    quotaResource: 'enrich' | 'investigate';
    targetTable: FullEnrichTargetTable;
    targetId: string;
    requestedFields: readonly FullEnrichRequestedField[];
  },
  client: ServiceClient = getSupabaseAdminClient(),
): Promise<{ callbackId: string; custom: Record<typeof FULLENRICH_CALLBACK_CUSTOM_KEY, string> }> {
  const targetTable = String(input.targetTable || '').trim();
  if (!ALLOWED_TARGET_TABLES.has(targetTable)) throw new Error('INVALID_FULLENRICH_TARGET_TABLE');

  const { data, error } = await client
    .from('fullenrich_enrichment_callbacks')
    .upsert({
      operation_id: requiredText(input.operationId, 'OPERATION_ID', 200),
      user_id: requiredUuid(input.userId, 'USER_ID'),
      organization_id: requiredUuid(input.organizationId, 'ORGANIZATION_ID'),
      quota_resource: input.quotaResource,
      target_table: targetTable,
      target_id: requiredText(input.targetId, 'TARGET_ID', 255),
      requested_fields: normalizeRequestedFields(input.requestedFields),
    }, {
      onConflict: 'operation_id,quota_resource,target_table,target_id',
    })
    .select('callback_id')
    .single();

  if (error) {
    if (String(error.code || '') === '23505') {
      throw new Error('FULLENRICH_CALLBACK_IN_FLIGHT');
    }
    throw new Error('FULLENRICH_CALLBACK_CREATE_FAILED');
  }
  const callbackId = uuid((data as JsonRecord | null)?.callback_id);
  if (!callbackId) throw new Error('INVALID_FULLENRICH_CALLBACK_CREATE_RESPONSE');

  return {
    callbackId,
    custom: { [FULLENRICH_CALLBACK_CUSTOM_KEY]: callbackId },
  };
}

export async function cancelFullEnrichEnrichmentCallbacks(
  input: { callbackIds: readonly string[]; errorCode: string },
  client: ServiceClient = getSupabaseAdminClient(),
) {
  const callbackIds = [...new Set(input.callbackIds.map((callbackId) => requiredUuid(callbackId, 'CALLBACK_ID')))].slice(0, 100);
  if (callbackIds.length === 0) return;

  const { error } = await client
    .from('fullenrich_enrichment_callbacks')
    .update({
      status: 'terminal',
      terminal_state: 'cancelled',
      terminal_at: new Date().toISOString(),
      last_error_code: requiredText(input.errorCode, 'ERROR_CODE', 100),
    })
    .in('callback_id', callbackIds)
    .in('status', ['pending', 'processing']);
  if (error) throw new Error('FULLENRICH_CALLBACK_CANCEL_FAILED');
}

export async function bindFullEnrichEnrichmentCallbacks(
  input: {
    callbackIds: readonly string[];
    providerEnrichmentId: string;
  },
  client: ServiceClient = getSupabaseAdminClient(),
): Promise<'bound' | 'unknown_callback' | 'provider_enrichment_mismatch'> {
  const callbackIds = [...new Set(input.callbackIds.map((callbackId) => requiredUuid(callbackId, 'CALLBACK_ID')))];
  if (callbackIds.length === 0 || callbackIds.length > 100) throw new Error('INVALID_FULLENRICH_CALLBACK_IDS');

  const { data, error } = await client.rpc('bind_fullenrich_enrichment_callbacks_v1', {
    p_callback_ids: callbackIds,
    p_provider_enrichment_id: requiredText(input.providerEnrichmentId, 'PROVIDER_ENRICHMENT_ID', 200),
  });
  if (error) throw new Error('FULLENRICH_CALLBACK_BIND_FAILED');

  const outcome = text(object(data)?.outcome, 64);
  if (outcome === 'bound' || outcome === 'unknown_callback' || outcome === 'provider_enrichment_mismatch') {
    return outcome;
  }
  throw new Error('INVALID_FULLENRICH_CALLBACK_BIND_RESPONSE');
}

async function applyFullEnrichWebhookEntry(
  input: {
    callbackId: string;
    providerEnrichmentId: string;
    providerStatus: string;
    payloadFingerprint: string;
    candidate: FullEnrichWebhookCandidate;
  },
  client: ServiceClient,
): Promise<'processed' | 'duplicate' | 'unknown_callback' | 'provider_enrichment_mismatch' | 'target_not_found'> {
  const { data, error } = await client.rpc('apply_fullenrich_enrichment_callback_v1', {
    p_callback_id: input.callbackId,
    p_provider_enrichment_id: input.providerEnrichmentId,
    p_provider_status: input.providerStatus,
    p_payload_fingerprint: input.payloadFingerprint,
    p_candidate: input.candidate,
  });
  if (error) throw new Error('FULLENRICH_CALLBACK_APPLY_FAILED');

  const outcome = text(object(data)?.outcome, 64);
  if (
    outcome === 'processed'
    || outcome === 'duplicate'
    || outcome === 'unknown_callback'
    || outcome === 'provider_enrichment_mismatch'
    || outcome === 'target_not_found'
  ) {
    return outcome;
  }
  throw new Error('INVALID_FULLENRICH_CALLBACK_APPLY_RESPONSE');
}

async function processFullEnrichEntries(
  input: {
    providerEnrichmentId: string;
    providerStatus: string;
    payloadFingerprint: string;
    entries: ParsedFullEnrichWebhook['entries'];
  },
  client: ServiceClient,
) {
  let processed = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const entry of input.entries) {
    const outcome = await applyFullEnrichWebhookEntry({
      callbackId: entry.callbackId,
      providerEnrichmentId: input.providerEnrichmentId,
      providerStatus: input.providerStatus,
      payloadFingerprint: input.payloadFingerprint,
      candidate: entry.candidate,
    }, client);

    if (outcome === 'duplicate') duplicates += 1;
    else if (outcome === 'unknown_callback' || outcome === 'provider_enrichment_mismatch') ignored += 1;
    else processed += 1;
  }

  return { processed, duplicates, ignored };
}

export async function processFullEnrichWebhookDelivery(
  input: {
    rawBody: Buffer;
    signatureHeader: string | null | undefined;
    apiKey: string;
  },
  client: ServiceClient = getSupabaseAdminClient(),
): Promise<FullEnrichWebhookProcessingResult> {
  if (!verifyFullEnrichWebhookSignature(input.rawBody, input.signatureHeader, input.apiKey)) {
    return { kind: 'unauthorized' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    return { kind: 'invalid_payload' };
  }

  const parsed = parseFullEnrichWebhookPayload(payload);
  if (!parsed) return { kind: 'invalid_payload' };

  const outcome = await processFullEnrichEntries({
    providerEnrichmentId: parsed.providerEnrichmentId,
    providerStatus: parsed.providerStatus,
    payloadFingerprint: fullEnrichWebhookPayloadFingerprint(input.rawBody, input.apiKey),
    entries: parsed.entries,
  }, client);

  return {
    kind: 'processed',
    received: parsed.entries.length,
    ...outcome,
  };
}

/**
 * This path is intentionally separate from webhook processing. The payload is
 * fetched with FullEnrich Bearer authentication, while webhook deliveries must
 * continue to pass raw-body HMAC verification above.
 */
export async function processFullEnrichRetrievedResult(
  input: {
    rawBody: Buffer;
    apiKey: string;
    expectedProviderEnrichmentId?: string;
  },
  client: ServiceClient = getSupabaseAdminClient(),
): Promise<FullEnrichRetrievedResultProcessingResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    return { kind: 'invalid_payload' };
  }

  const parsed = parseFullEnrichWebhookPayload(payload);
  if (!parsed) return { kind: 'invalid_payload' };
  if (
    input.expectedProviderEnrichmentId
    && parsed.providerEnrichmentId !== requiredText(input.expectedProviderEnrichmentId, 'PROVIDER_ENRICHMENT_ID', 200)
  ) {
    return { kind: 'invalid_payload' };
  }
  if (!isFullEnrichTerminalProviderStatus(parsed.providerStatus)) return { kind: 'in_progress' };

  const outcome = await processFullEnrichEntries({
    providerEnrichmentId: parsed.providerEnrichmentId,
    providerStatus: parsed.providerStatus,
    payloadFingerprint: fullEnrichWebhookPayloadFingerprint(input.rawBody, input.apiKey),
    entries: parsed.entries,
  }, client);
  return {
    kind: 'processed',
    providerStatus: parsed.providerStatus,
    callbackIds: parsed.entries.map((entry) => entry.callbackId),
    received: parsed.entries.length,
    ...outcome,
  };
}

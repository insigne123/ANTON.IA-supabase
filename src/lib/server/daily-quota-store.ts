import { createClient } from '@supabase/supabase-js';
import { DEFAULT_DAILY_QUOTA_LIMITS } from '@/lib/daily-quota-limits';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';

// Use a service role client for reliable quota updates (bypassing RLS if needed for atomic increments)
// or standard client if we trust RLS. For atomic increments via RPC + security definer, service role is safest or
// standard client if the user has execute permission. 
// However, here we are in a library that might be called by API routes.
// Let's assume we pass the supabase client or use a global admin one.
// Since 'daily-quota-store' is server-side only, we can instantiate a service-role client.

let supabaseAdminClient: ReturnType<typeof createClient> | null = null;

function getSupabaseAdmin() {
  if (supabaseAdminClient) return supabaseAdminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase admin credentials for quota store');
  }

  supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  return supabaseAdminClient;
}

export type DailyQuotaResult = {
  allowed: boolean;
  count: number;
  limit: number;
  dayKey: string;
  resetAtISO: string;
};

export type EnrichmentQuotaOperationStatus = 'claimed' | 'submitted' | 'completed' | 'failed';

export type EnrichmentQuotaOperationClaim = DailyQuotaResult & {
  operationId: string;
  status: EnrichmentQuotaOperationStatus;
  claimed: boolean;
  reused: boolean;
  claimToken: string | null;
  providerState: 'not_started' | 'processing' | 'unknown' | 'completed' | 'failed';
  consumed: number;
  responseStatus: number | null;
  responsePayload: Record<string, unknown> | null;
};

function parseEnrichmentQuotaOperationResult(
  result: Record<string, any>,
  operationId: string,
  reused: boolean,
): EnrichmentQuotaOperationClaim {
  const status = String(result.status || '') as EnrichmentQuotaOperationStatus;
  const count = Number(result.count ?? result.quota_count_after);
  const limit = Number(result.limit ?? result.quota_limit);
  const providerState = String(result.provider_state || (
    status === 'claimed'
      ? 'not_started'
      : status === 'submitted'
        ? 'processing'
        : status === 'completed'
          ? 'completed'
          : 'failed'
  ));
  if (typeof result.allowed !== 'boolean'
    || !['claimed', 'submitted', 'completed', 'failed'].includes(status)
    || !['not_started', 'processing', 'unknown', 'completed', 'failed'].includes(providerState)
    || !Number.isFinite(count)
    || !Number.isFinite(limit)) {
    throw new Error('Invalid enrichment quota operation response');
  }

  const responsePayload = result.response_payload;
  const responseStatus = Number(result.response_status);
  return {
    allowed: result.allowed,
    count,
    limit,
    dayKey: String(result.day_key || result.quota_day || todayKeyUTC()),
    resetAtISO: nextDayStartISOUTC(),
    operationId,
    status,
    claimed: Boolean(result.claimed),
    reused,
    claimToken: typeof result.claim_token === 'string' ? result.claim_token : null,
    providerState: providerState as EnrichmentQuotaOperationClaim['providerState'],
    consumed: Math.max(0, Number(result.consumed ?? result.consumed_count ?? 0)),
    responseStatus: Number.isInteger(responseStatus) && responseStatus >= 100 && responseStatus <= 599
      ? responseStatus
      : null,
    responsePayload: responsePayload && typeof responsePayload === 'object' && !Array.isArray(responsePayload)
      ? responsePayload as Record<string, unknown>
      : null,
  };
}

export async function getEnrichmentQuotaOperation(params: {
  userId: string;
  organizationId: string;
  resource: 'enrich' | 'investigate';
  operationId: string;
  requestFingerprint: string;
}) {
  const { data, error } = await getSupabaseAdmin()
    .from('antonia_quota_operations')
    .select('request_fingerprint, quota_allowed, quota_count_after, quota_limit, quota_day, consumed_count, status, claimed_at, submitted_at, response_status, response_payload')
    .eq('organization_id', params.organizationId)
    .eq('user_id', params.userId)
    .eq('resource', params.resource)
    .eq('operation_id', params.operationId)
    .maybeSingle();
  if (error) throw error;
  const operation = data as Record<string, any> | null;
  if (!operation) return null;
  if (String(operation.request_fingerprint || '') !== params.requestFingerprint) {
    throw new Error('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
  }
  // Quota denials may become claimable after reset or a limit change; the atomic RPC decides that case.
  if (!operation.quota_allowed && Number(operation.response_status) === 429) return null;
  const claimedAt = Date.parse(String(operation.claimed_at || ''));
  if (operation.status === 'claimed' && Number.isFinite(claimedAt) && claimedAt < Date.now() - 300_000) {
    return null;
  }

  const submittedAt = Date.parse(String(operation.submitted_at || ''));
  const providerState = operation.status === 'submitted'
    ? (Number.isFinite(submittedAt) && submittedAt < Date.now() - 300_000 ? 'unknown' : 'processing')
    : undefined;
  return parseEnrichmentQuotaOperationResult({
    ...operation,
    allowed: Boolean(operation.quota_allowed),
    claimed: false,
    provider_state: providerState,
  }, params.operationId, true);
}

type EnrichmentQuotaOperationIdentity = {
  userId: string;
  organizationId: string;
  resource: 'enrich' | 'investigate';
  operationId: string;
  claimToken: string;
};

export async function claimEnrichmentQuotaOperation(params: {
  userId: string;
  organizationId?: string;
  resource: 'enrich' | 'investigate';
  operationId: string;
  requestFingerprint: string;
  limit: number;
  count: number;
  staleAfterSeconds?: number;
}): Promise<EnrichmentQuotaOperationClaim> {
  const userId = String(params.userId || '').trim();
  const operationId = String(params.operationId || '').trim();
  const requestFingerprint = String(params.requestFingerprint || '').trim().toLowerCase();
  const requestedCount = Math.trunc(Number(params.count));
  if (!userId || !operationId || operationId.length > 200 || !/^[0-9a-f]{64}$/.test(requestFingerprint)) {
    throw new Error('Invalid enrichment quota operation identity');
  }
  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    throw new Error('Invalid enrichment quota operation count');
  }

  const organizationId = await resolveOrganizationIdForQuota(userId, params.organizationId);
  const quota = await resolveUserScopedQuotaContext({
    userId,
    fallbackLimit: Math.max(0, Number(params.limit) || 0),
    resource: params.resource,
  });
  const { data, error } = await (getSupabaseAdmin() as any).rpc('claim_antonia_quota_operation_v1', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_scope: quota.scope,
    p_resource: params.resource,
    p_operation_id: operationId,
    p_request_fingerprint: requestFingerprint,
    p_requested_count: requestedCount,
    p_limit: quota.limit,
    p_stale_after_seconds: Math.max(60, Math.trunc(Number(params.staleAfterSeconds) || 300)),
  });
  if (error) throw error;

  const result = data as Record<string, any> | null;
  if (!result) {
    throw new Error('Invalid enrichment quota operation claim response');
  }
  return parseEnrichmentQuotaOperationResult(result, operationId, Boolean(result.reused));
}

export async function markEnrichmentQuotaOperationSubmitted(params: EnrichmentQuotaOperationIdentity) {
  const { data, error } = await (getSupabaseAdmin() as any).rpc('mark_antonia_quota_operation_submitted_v1', {
    p_organization_id: params.organizationId,
    p_user_id: params.userId,
    p_resource: params.resource,
    p_operation_id: params.operationId,
    p_claim_token: params.claimToken,
  });
  if (error) throw error;
  if (data !== true) throw new Error('Enrichment quota operation is no longer owned');
}

export async function completeEnrichmentQuotaOperation(params: EnrichmentQuotaOperationIdentity & {
  status: Extract<EnrichmentQuotaOperationStatus, 'completed' | 'failed'>;
  responseStatus: number;
  responsePayload: Record<string, unknown>;
}) {
  const { data, error } = await (getSupabaseAdmin() as any).rpc('complete_antonia_quota_operation_v1', {
    p_organization_id: params.organizationId,
    p_user_id: params.userId,
    p_resource: params.resource,
    p_operation_id: params.operationId,
    p_claim_token: params.claimToken,
    p_status: params.status,
    p_response_status: params.responseStatus,
    p_response_payload: params.responsePayload,
  });
  if (error) throw error;
  if (data !== true) throw new Error('Enrichment quota operation completion lost its claim');
}

export async function releaseEnrichmentQuotaOperation(params: EnrichmentQuotaOperationIdentity) {
  const { data, error } = await (getSupabaseAdmin() as any).rpc('release_antonia_quota_operation_v1', {
    p_organization_id: params.organizationId,
    p_user_id: params.userId,
    p_resource: params.resource,
    p_operation_id: params.operationId,
    p_claim_token: params.claimToken,
  });
  if (error) throw error;
  return data === true;
}

export async function getContactQuotaUsage(params: { userId: string; organizationId?: string; limit: number }) {
  const organizationId = await resolveOrganizationIdForQuota(params.userId, params.organizationId);
  const quota = await resolveContactQuotaContext({ userId: params.userId, fallbackLimit: params.limit });
  const dayKey = todayKeyUTC();
  const historicalCount = await countContactsToday({
    userId: params.userId,
    organizationId,
    dayKey,
    scope: quota.scope,
  });
  const scopeKey = `${quota.scope}:${quota.scope === 'user' ? params.userId : organizationId}`;
  const { data: bucket, error: bucketError } = await getSupabaseAdmin()
    .from('outbound_contact_quota_buckets')
    .select('baseline_count, reservation_count')
    .eq('scope_key', scopeKey)
    .eq('quota_day', dayKey)
    .maybeSingle();
  if (bucketError && !isMissingOutboundQuotaBucketsTable(bucketError)) throw bucketError;
  const bucketRow = bucket as { baseline_count: number; reservation_count: number } | null;
  const count = bucketRow
    ? Math.max(0, Number(bucketRow.baseline_count || 0)) + Math.max(0, Number(bucketRow.reservation_count || 0))
    : historicalCount;
  return { organizationId, scope: quota.scope, historicalCount, count, limit: quota.limit };
}

export async function reserveOutboundContactQuota(params: {
  dispatchId: string;
  userId: string;
  organizationId?: string;
  limit: number;
}) {
  const dispatchId = String(params.dispatchId || '').trim();
  const userId = String(params.userId || '').trim();
  const requestedOrganizationId = String(params.organizationId || '').trim() || undefined;
  if (!dispatchId || !userId) throw new Error('Dispatch and user are required for quota reservation');

  const { data: dispatch, error: dispatchError } = await getSupabaseAdmin()
    .from('outbound_dispatches')
    .select('organization_id, user_id, status')
    .eq('id', dispatchId)
    .maybeSingle();
  if (dispatchError) throw dispatchError;
  const dispatchRow = dispatch as { organization_id: string; user_id: string; status: string } | null;
  if (!dispatchRow || !['sending', 'failed'].includes(String(dispatchRow.status))) {
    throw new Error(`Outbound dispatch ${dispatchId} is not available for quota reservation`);
  }
  if (String(dispatchRow.user_id) !== userId) {
    throw new Error('Quota reservation user does not match outbound dispatch');
  }
  if (requestedOrganizationId && String(dispatchRow.organization_id) !== requestedOrganizationId) {
    throw new Error('Quota reservation organization does not match outbound dispatch');
  }

  if (dispatchRow.status === 'failed') {
    const { data: reservation, error: reservationError } = await getSupabaseAdmin()
      .from('outbound_quota_reservations')
      .select('organization_id, user_id')
      .eq('dispatch_id', dispatchId)
      .maybeSingle();
    if (reservationError) throw reservationError;
    const reservationRow = reservation as { organization_id: string; user_id: string } | null;
    if (!reservationRow
      || String(reservationRow.user_id) !== userId
      || String(reservationRow.organization_id) !== String(dispatchRow.organization_id)) {
      throw new Error(`Outbound dispatch ${dispatchId} has no matching quota reservation`);
    }
  }

  const usage = await getContactQuotaUsage(params);
  if (String(dispatchRow.organization_id) !== usage.organizationId) {
    throw new Error('Resolved quota organization does not match outbound dispatch');
  }
  const { data, error } = await (getSupabaseAdmin() as any).rpc('reserve_outbound_contact_quota_v1', {
    p_dispatch_id: dispatchId,
    p_organization_id: usage.organizationId,
    p_user_id: userId,
    p_scope: usage.scope,
    p_limit: usage.limit,
    p_base_count: usage.historicalCount,
  });
  if (error) throw error;
  const reservation = data as { allowed?: boolean; count?: number; limit?: number } | null;
  return {
    allowed: Boolean(reservation?.allowed),
    count: Number(reservation?.count ?? usage.historicalCount),
    limit: Number(reservation?.limit || usage.limit),
  };
}

export type EffectiveDailyQuotaLimits = {
  leadSearch: number;
  enrich: number;
  research: number;
  contact: number;
};

const RESOURCE_TO_COLUMN: Record<string, string> = {
  'leadSearch': 'leads_searched',
  'enrich': 'leads_enriched',
  'investigate': 'leads_investigated',
  'research': 'leads_investigated',
};

type AtomicDailyQuotaResource = 'leadSearch' | 'search' | 'enrich' | 'investigate' | 'research';
const ATOMIC_DAILY_QUOTA_RESOURCES = new Set<AtomicDailyQuotaResource>([
  'leadSearch',
  'search',
  'enrich',
  'investigate',
  'research',
]);

function todayKeyUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function positiveInt(value: any, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function nextDayStartISOUTC(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

async function resolveOrganizationIdForQuota(userId: string, organizationId?: string) {
  if (organizationId) return organizationId;

  const { data, error } = await getSupabaseAdmin()
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const resolvedOrgId = (data as { organization_id?: string } | null)?.organization_id;
  if (!resolvedOrgId) throw new Error(`User ${userId} has no organization for quota`);
  return resolvedOrgId;
}

type ContactQuotaContext = {
  limit: number;
  scope: 'organization' | 'user';
};

type UserScopedQuotaResource = 'contact' | 'enrich' | 'investigate' | 'research';

type UserScopedQuotaContext = {
  limit: number;
  scope: 'organization' | 'user';
};

function readQuotaLimitOverride(value: any, resource: UserScopedQuotaResource) {
  const overrideKey = resource === 'research' ? 'daily_investigate_limit' : `daily_${resource}_limit`;
  const limit = Number(value?.[overrideKey] ?? 0);
  return Number.isFinite(limit) && limit > 0 ? limit : 0;
}

function isMissingUserQuotaOverridesTable(error: any) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST205' || message.includes("could not find the table 'public.user_quota_overrides'");
}

function isMissingOutboundQuotaBucketsTable(error: any) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST205'
    && message.includes("could not find the table 'public.outbound_contact_quota_buckets'");
}

async function resolveUserScopedQuotaContext(params: { userId: string; fallbackLimit: number; resource: UserScopedQuotaResource }) {
  const { userId, fallbackLimit, resource } = params;
  let overrideRow: any = null;
  const overrideColumn = resource === 'research' ? 'daily_investigate_limit' : `daily_${resource}_limit`;
  const { data, error } = await getSupabaseAdmin()
    .from('user_quota_overrides')
    .select(overrideColumn)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (!isMissingUserQuotaOverridesTable(error)) throw error;
  } else {
    overrideRow = data;
  }

  const overrideLimit = readQuotaLimitOverride(overrideRow, resource);

  if (Number.isFinite(overrideLimit) && overrideLimit > 0) {
    return { limit: overrideLimit, scope: 'user' } satisfies UserScopedQuotaContext;
  }

  return {
    limit: Math.max(0, Number(fallbackLimit) || 0),
    scope: 'organization',
  } satisfies UserScopedQuotaContext;
}

async function resolveContactQuotaContext(params: { userId: string; fallbackLimit: number }) {
  return resolveUserScopedQuotaContext({ ...params, resource: 'contact' });
}

export async function getEffectiveDailyQuotaLimits(params: { userId: string; organizationId?: string }): Promise<EffectiveDailyQuotaLimits> {
  // A mission controls its own automated work, not the account allowance shown
  // across the workspace. Resolve membership here so invalid callers still fail closed.
  await resolveOrganizationIdForQuota(params.userId, params.organizationId);
  const enrichQuota = await resolveUserScopedQuotaContext({
    userId: params.userId,
    fallbackLimit: DEFAULT_DAILY_QUOTA_LIMITS.enrich,
    resource: 'enrich',
  });
  const researchQuota = await resolveUserScopedQuotaContext({
    userId: params.userId,
    fallbackLimit: DEFAULT_DAILY_QUOTA_LIMITS.research,
    resource: 'investigate',
  });
  const contactQuota = await resolveContactQuotaContext({
    userId: params.userId,
    fallbackLimit: DEFAULT_DAILY_QUOTA_LIMITS.contact,
  });

  return {
    leadSearch: DEFAULT_DAILY_QUOTA_LIMITS.leadSearch,
    enrich: enrichQuota.limit,
    research: researchQuota.limit,
    contact: contactQuota.limit,
  };
}

async function countContactsToday(params: { userId: string; organizationId: string; dayKey: string; scope: ContactQuotaContext['scope'] }) {
  let query = getSupabaseAdmin()
    .from('contacted_leads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${params.dayKey}T00:00:00Z`);

  query = params.scope === 'user'
    ? query.eq('user_id', params.userId)
    : query.eq('organization_id', params.organizationId);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function countUserLeadQuotaEventsToday(params: {
  userId: string;
  organizationId: string;
  dayKey: string;
  resource: Exclude<UserScopedQuotaResource, 'contact'>;
  scope: UserScopedQuotaContext['scope'];
}) {
  if (params.scope !== 'user') return 0;

  const timestampColumn = params.resource === 'enrich' ? 'last_enriched_at' : 'last_investigated_at';
  const { count, error } = await getSupabaseAdmin()
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', params.organizationId)
    .eq('user_id', params.userId)
    .gte(timestampColumn, `${params.dayKey}T00:00:00Z`);

  if (error) throw error;
  return count || 0;
}

async function getUserLeadQuotaUsageToday(params: {
  userId: string;
  organizationId: string;
  dayKey: string;
  resource: Exclude<UserScopedQuotaResource, 'contact' | 'research'>;
}) {
  const { data, error } = await getSupabaseAdmin()
    .from('antonia_user_daily_usage')
    .select('usage_count')
    .eq('organization_id', params.organizationId)
    .eq('user_id', params.userId)
    .eq('date', params.dayKey)
    .eq('resource', params.resource)
    .maybeSingle();

  if (error) throw error;
  const bucket = data as { usage_count?: number } | null;
  if (bucket) return Math.max(0, Number(bucket.usage_count || 0));

  return countUserLeadQuotaEventsToday({
    ...params,
    scope: 'user',
  });
}

export async function getUserScopedAntoniaQuotaStatus(params: {
  userId: string;
  organizationId?: string;
  resource: Exclude<UserScopedQuotaResource, 'research'>;
  limit: number;
  organizationCount?: number;
}): Promise<DailyQuotaResult> {
  const orgId = await resolveOrganizationIdForQuota(params.userId, params.organizationId);
  const dayKey = todayKeyUTC();
  const quota = await resolveUserScopedQuotaContext({
    userId: params.userId,
    fallbackLimit: params.limit,
    resource: params.resource,
  });

  if (params.resource === 'contact') {
    const { count: used } = await getContactQuotaUsage({
      userId: params.userId,
      organizationId: orgId,
      limit: params.limit,
    });
    return { allowed: used < quota.limit, count: used, limit: quota.limit, dayKey, resetAtISO: nextDayStartISOUTC() };
  }

  const used = quota.scope === 'user'
    ? await getUserLeadQuotaUsageToday({
      userId: params.userId,
      organizationId: orgId,
      dayKey,
      resource: params.resource,
    })
    : Math.max(0, Number(params.organizationCount || 0));

  return {
    allowed: used < quota.limit,
    count: used,
    limit: quota.limit,
    dayKey,
    resetAtISO: nextDayStartISOUTC(),
  };
}

async function recordQuotaDecision(params: {
  userId: string;
  organizationId: string;
  resource: string;
  requestedCount: number;
  scope: 'organization' | 'user';
  result: DailyQuotaResult;
}) {
  await safeAppendAntoniaEvent({
    eventType: params.result.allowed ? 'quota.reserved' : 'quota.denied',
    actorId: params.userId,
    actorType: 'user',
    organizationId: params.organizationId,
    entityType: 'quota',
    entityId: `${params.resource}:${params.result.dayKey}`,
    sourceSystem: 'daily-quota-store',
    status: params.result.allowed ? 'allowed' : 'denied',
    outcome: params.result.allowed ? 'reserved' : 'quota_exceeded',
    severity: params.result.allowed ? 'info' : 'warning',
    metrics: {
      resource: params.resource,
      scope: params.scope,
      requestedCount: params.requestedCount,
      count: params.result.count,
      limit: params.result.limit,
    },
    payload: {
      resource: params.resource,
      quotaDay: params.result.dayKey,
    },
  });
}

export async function checkAndConsumeDailyQuota(
  params: {
    userId: string;
    organizationId?: string;
    resource: string;
    limit: number;
    count?: number;
  }
): Promise<DailyQuotaResult> {
  const { userId, resource, limit, count = 1 } = params;
  const orgId = await resolveOrganizationIdForQuota(userId, params.organizationId);
  const date = todayKeyUTC();

  if (resource === 'contact') {
    const contactQuota = await getContactQuotaUsage({ userId, organizationId: orgId, limit });
    const used = contactQuota.count;

    if (used + count > contactQuota.limit) {
      const result = { allowed: false, count: used, limit: contactQuota.limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
      await recordQuotaDecision({ userId, organizationId: orgId, resource, requestedCount: count, scope: contactQuota.scope, result });
      return result;
    }

    const result = { allowed: true, count: used + count, limit: contactQuota.limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    await recordQuotaDecision({ userId, organizationId: orgId, resource, requestedCount: count, scope: contactQuota.scope, result });
    return result;
  }

  if (!ATOMIC_DAILY_QUOTA_RESOURCES.has(resource as AtomicDailyQuotaResource)) {
    throw new Error(`Unknown quota resource: ${resource}`);
  }

  const atomicResource = resource as AtomicDailyQuotaResource;
  let effectiveLimit = Math.max(0, Number(limit) || 0);

  const quota = atomicResource === 'enrich' || atomicResource === 'investigate' || atomicResource === 'research'
    ? await resolveUserScopedQuotaContext({
      userId,
      fallbackLimit: effectiveLimit,
      resource: atomicResource,
    })
    : { limit: effectiveLimit, scope: 'organization' as const };
  effectiveLimit = quota.limit;

  const { data, error } = await (getSupabaseAdmin() as any).rpc('consume_antonia_daily_quota_v1', {
    p_organization_id: orgId,
    p_user_id: userId,
    p_scope: quota.scope,
    p_resource: atomicResource,
    p_requested_count: count,
    p_limit: quota.limit,
  });
  if (error) throw error;

  const rawResult = data as { allowed?: boolean; count?: number; limit?: number } | null;
  if (!rawResult || typeof rawResult.allowed !== 'boolean' || !Number.isFinite(Number(rawResult.count))) {
    throw new Error('Invalid atomic quota response');
  }

  const result = {
    allowed: rawResult.allowed,
    count: Number(rawResult.count),
    limit: Number(rawResult.limit ?? quota.limit),
    dayKey: date,
    resetAtISO: nextDayStartISOUTC(),
  };
  await recordQuotaDecision({ userId, organizationId: orgId, resource, requestedCount: count, scope: quota.scope, result });
  return result;
}

export async function getDailyQuotaStatus(
  params: { userId: string; organizationId?: string; resource: string; limit: number }
): Promise<DailyQuotaResult> {
  // Similar to above but read-only
  const { userId, resource, limit } = params;
  let orgId: string;
  try {
    orgId = await resolveOrganizationIdForQuota(userId, params.organizationId);
  } catch {
    return { allowed: false, count: 0, limit, dayKey: todayKeyUTC(), resetAtISO: nextDayStartISOUTC() };
  }

  const date = todayKeyUTC();

  if (resource === 'contact') {
    try {
      const contactQuota = await getContactQuotaUsage({ userId, organizationId: orgId, limit });
      const used = contactQuota.count;
      return { allowed: used < contactQuota.limit, count: used, limit: contactQuota.limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    } catch {
      return { allowed: false, count: 0, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    }
  }

  const userScopedResource = resource === 'research' ? 'investigate' : resource;
  if (userScopedResource === 'enrich' || userScopedResource === 'investigate') {
    try {
      const quota = await resolveUserScopedQuotaContext({
        userId,
        fallbackLimit: limit,
        resource: userScopedResource,
      });
      if (quota.scope === 'user') {
        const count = await getUserLeadQuotaUsageToday({
          userId,
          organizationId: orgId,
          dayKey: date,
          resource: userScopedResource,
        });
        return {
          allowed: count < quota.limit,
          count,
          limit: quota.limit,
          dayKey: date,
          resetAtISO: nextDayStartISOUTC(),
        };
      }
    } catch {
      return { allowed: false, count: 0, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };
    }
  }

  let col = RESOURCE_TO_COLUMN[resource];
  if (resource === 'search') col = 'search_runs';

  if (!col) return { allowed: false, count: 0, limit, dayKey: date, resetAtISO: nextDayStartISOUTC() };

  const { data: usage } = await getSupabaseAdmin()
    .from('antonia_daily_usage')
    .select(col)
    .eq('organization_id', orgId)
    .eq('date', date)
    .maybeSingle();

  const val = usage ? (usage as any)[col] || 0 : 0;

  return {
    allowed: val < limit,
    count: val,
    limit,
    dayKey: date,
    resetAtISO: nextDayStartISOUTC()
  };
}

export const tryConsumeDailyQuota = checkAndConsumeDailyQuota;
export const ensureDailyQuota = checkAndConsumeDailyQuota;
export const canConsumeDailyQuota = getDailyQuotaStatus;

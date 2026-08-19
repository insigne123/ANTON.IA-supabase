import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import {
  claimEnrichmentQuotaOperation,
  completeEnrichmentQuotaOperation,
  getEnrichmentQuotaOperation,
  getEffectiveDailyQuotaLimits,
  markEnrichmentQuotaOperationSubmitted,
  releaseEnrichmentQuotaOperation,
  type EnrichmentQuotaOperationClaim,
} from '@/lib/server/daily-quota-store';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { enrichPersonWithPDL, pickPdlEmail, pickPdlPhones } from '@/lib/providers/pdl';
import { isPdlFallbackEnabled, resolveLeadProvider } from '@/lib/server/provider-routing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_ENRICHMENT_SERVICE_URL = 'https://backend-antonia--backend-apollo-leads-prod.us-central1.hosted.app/api/enrich';

const ALLOWED_TABLES = new Set(['enriched_opportunities', 'enriched_leads']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUE_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);
type EnrichmentMode = 'normal' | 'deep';

function isUuid(x?: string | null) {
  const v = String(x || '').trim();
  return !!v && UUID_RE.test(v);
}

function resolveTableName(raw?: string) {
  const v = String(raw || '').trim();
  if (!v) return null;
  return ALLOWED_TABLES.has(v) ? v : null;
}

function parseRequestedFlag(raw: unknown, defaultValue: boolean) {
  if (raw == null) return { ok: true as const, value: defaultValue };
  if (typeof raw === 'boolean') return { ok: true as const, value: raw };
  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true as const, value: true };
    if (raw === 0) return { ok: true as const, value: false };
    return { ok: false as const };
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return { ok: true as const, value: defaultValue };
    if (TRUE_FLAG_VALUES.has(normalized)) return { ok: true as const, value: true };
    if (FALSE_FLAG_VALUES.has(normalized)) return { ok: true as const, value: false };
  }
  return { ok: false as const };
}

function resolveRequestedFields(revealEmail: boolean, revealPhone: boolean) {
  const requestedFields: string[] = [];
  if (revealEmail) requestedFields.push('email');
  if (revealPhone) requestedFields.push('phone');
  return requestedFields;
}

function resolveRequestedEnrichmentLevel(mode: EnrichmentMode) {
  return mode === 'deep' ? 'deep' : 'basic';
}

function resolveEnrichmentMode(rawMode: unknown, trustedInternalCaller: boolean, revealPhone: boolean) {
  const fieldDerivedMode: EnrichmentMode = revealPhone ? 'deep' : 'normal';
  const normalizedMode = String(rawMode ?? '').trim().toLowerCase();

  if (!normalizedMode) {
    return { ok: true as const, mode: fieldDerivedMode };
  }
  if (normalizedMode !== 'normal' && normalizedMode !== 'deep') {
    return { ok: false as const, error: 'invalid enrichment mode' };
  }
  if (!trustedInternalCaller) {
    return { ok: false as const, error: 'explicit enrichment mode is reserved for internal requests' };
  }
  if (normalizedMode !== fieldDerivedMode) {
    return { ok: false as const, error: 'enrichment mode does not match requested fields' };
  }

  return { ok: true as const, mode: normalizedMode as EnrichmentMode };
}

function resolveQuotaResource(mode: EnrichmentMode): 'enrich' | 'investigate' {
  return mode === 'deep' ? 'investigate' : 'enrich';
}

function resolveEnrichmentOperationId(req: NextRequest, body: { operationId?: unknown; idempotencyKey?: unknown }) {
  const candidates = [
    req.headers.get('idempotency-key'),
    req.headers.get('x-idempotency-key'),
    body.operationId,
    body.idempotencyKey,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    return { ok: false as const, error: 'IDEMPOTENCY_KEY_REQUIRED' };
  }
  if (unique.length > 1) {
    return { ok: false as const, error: 'IDEMPOTENCY_KEY_CONFLICT' };
  }
  if (unique[0].length > 200) {
    return { ok: false as const, error: 'IDEMPOTENCY_KEY_TOO_LONG' };
  }
  return { ok: true as const, operationId: unique[0] };
}

function buildEnrichmentRequestFingerprint(params: {
  leads: EnrichInput['leads'];
  revealEmail: boolean;
  revealPhone: boolean;
  mode: EnrichmentMode;
  requestedProvider?: 'apollo' | 'pdl';
  tableName: string;
}) {
  const normalized = {
    version: 1,
    revealEmail: params.revealEmail,
    revealPhone: params.revealPhone,
    mode: params.mode,
    requestedProvider: params.requestedProvider || null,
    tableName: params.tableName,
    leads: params.leads.map((lead) => ({
      fullName: String(lead.fullName || '').trim(),
      linkedinUrl: normalizeLinkedin(String(lead.linkedinUrl || '').trim()),
      companyName: String(lead.companyName || '').trim(),
      companyDomain: cleanDomain(String(lead.companyDomain || '').trim()) || '',
      title: String(lead.title || '').trim(),
      sourceOpportunityId: String(lead.sourceOpportunityId || '').trim(),
      clientRef: String(lead.clientRef || '').trim(),
      email: String(lead.email || '').trim().toLowerCase(),
      existingRecordId: String(lead.existingRecordId || '').trim(),
      apolloId: String(lead.apolloId || '').trim(),
      id: String(lead.id || '').trim(),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function resolveApolloProviderConfiguration() {
  if (!String(process.env.APOLLO_API_KEY || '').trim()) {
    return { ok: false as const, error: 'APOLLO_API_KEY missing' };
  }
  const externalUrl = (process.env.ENRICHMENT_SERVICE_URL || DEFAULT_ENRICHMENT_SERVICE_URL).trim();
  const backendSecret = (
    process.env.BACKEND_ENRICH_SECRET ||
    process.env.ENRICHMENT_SERVICE_SECRET ||
    process.env.API_SECRET_KEY ||
    ''
  ).trim();
  if (!externalUrl) return { ok: false as const, error: 'ENRICHMENT_SERVICE_URL missing' };
  try {
    const parsed = new URL(externalUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { ok: false as const, error: 'ENRICHMENT_SERVICE_URL invalid' };
  }
  if (!backendSecret) return { ok: false as const, error: 'ENRICHMENT_SERVICE_SECRET missing' };
  return { ok: true as const, externalUrl, backendSecret };
}

function resolvePdlProviderConfiguration() {
  if (!String(process.env.PDL_API_KEY || '').trim()) {
    return { ok: false as const, error: 'PDL_API_KEY missing' };
  }
  const baseUrl = String(process.env.PDL_BASE_URL || 'https://api.peopledatalabs.com/v5').trim();
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch {
    return { ok: false as const, error: 'PDL_BASE_URL invalid' };
  }
  return { ok: true as const };
}

function operationUsage(claim: EnrichmentQuotaOperationClaim) {
  return {
    consumed: claim.consumed,
    count: claim.count,
    limit: claim.limit,
    reused: claim.reused,
  };
}

function operationStateResponse(claim: EnrichmentQuotaOperationClaim) {
  if (claim.responsePayload && claim.responseStatus) {
    const response = NextResponse.json({
      ...claim.responsePayload,
      operationId: claim.operationId,
      operationStatus: claim.status,
      usage: operationUsage(claim),
    }, { status: claim.responseStatus });
    if (claim.reused) response.headers.set('x-idempotent-replay', 'true');
    response.headers.set('x-operation-id', claim.operationId);
    return response;
  }

  const unknown = claim.providerState === 'unknown';
  const response = NextResponse.json({
    error: unknown ? 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN' : 'ENRICHMENT_OPERATION_PROCESSING',
    operationId: claim.operationId,
    operationStatus: claim.status,
    providerState: claim.providerState,
    usage: operationUsage(claim),
  }, { status: unknown ? 409 : 202 });
  response.headers.set('retry-after', unknown ? '0' : '5');
  response.headers.set('x-idempotent-replay', 'true');
  response.headers.set('x-operation-id', claim.operationId);
  return response;
}

class ProviderOutcomeUnknownError extends Error {}

// Lazy initialization to avoid build-time evaluation of env vars
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function resolveRequiredOrganizationId(userId: string, requestedOrganizationId?: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .limit(50);

  if (error) throw error;

  const memberships = Array.isArray(data)
    ? data.map((row: any) => String(row?.organization_id || '').trim()).filter(Boolean)
    : [];
  if (memberships.length === 0) return null;
  if (requestedOrganizationId) {
    return memberships.includes(requestedOrganizationId) ? requestedOrganizationId : null;
  }

  const pdlAllowedOrganizations = new Set(
    String(process.env.PDL_ALLOWED_ORG_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return memberships.find((organizationId) => pdlAllowedOrganizations.has(organizationId)) || memberships[0];
}

type EnrichInput = {
  revealEmail?: boolean | string | number | null;
  revealPhone?: boolean | string | number | null;
  mode?: 'normal' | 'deep';
  provider?: 'apollo' | 'pdl';
  leads: Array<{
    fullName: string;
    linkedinUrl?: string;
    companyName?: string;
    companyDomain?: string;
    title?: string;
    sourceOpportunityId?: string;
    clientRef?: string;
    email?: string;
    existingRecordId?: string;
    apolloId?: string;
    id?: string;
  }>;
};

function resolveExistingRecordIds(leads: EnrichInput['leads']) {
  const recordIds = new Set<string>();

  for (const lead of leads) {
    const explicitRecordId = String(lead.existingRecordId || '').trim();
    if (explicitRecordId && !isUuid(explicitRecordId)) {
      return { ok: false as const };
    }

    if (explicitRecordId) recordIds.add(explicitRecordId);
  }

  return { ok: true as const, recordIds: [...recordIds] };
}

async function existingRecordsBelongToOrganization(params: {
  tableName: string;
  organizationId: string;
  recordIds: string[];
}) {
  if (params.recordIds.length === 0) return true;

  const { data, error } = await getSupabaseAdmin()
    .from(params.tableName)
    .select('id')
    .eq('organization_id', params.organizationId)
    .in('id', params.recordIds);

  if (error) throw error;
  const ownedIds = new Set((data || []).map((row: { id?: string }) => String(row.id || '')));
  return params.recordIds.every((recordId) => ownedIds.has(recordId));
}

export async function POST(req: NextRequest) {
  const userIdFromHeader = req.headers.get('x-user-id')?.trim() || '';
  const organizationIdFromHeader = req.headers.get('x-organization-id')?.trim() || '';
  const trustedInternalCaller = Boolean(userIdFromHeader && isTrustedInternalRequest(req));

  let userId = userIdFromHeader;

  if (userIdFromHeader) {
    if (!trustedInternalCaller) {
      return NextResponse.json({ error: 'unauthorized internal request' }, { status: 401 });
    }
  } else {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = user.id;
  }
  if (organizationIdFromHeader && !trustedInternalCaller) {
    return NextResponse.json({ error: 'unauthorized internal organization request' }, { status: 401 });
  }

  let claimedOperation: EnrichmentQuotaOperationClaim | null = null;
  let claimedOrganizationId = '';
  let claimedResource: 'enrich' | 'investigate' = 'enrich';
  let providerStarted = false;

  try {
    const body = await req.json() as EnrichInput & {
      tableName?: string;
      resource?: unknown;
      operationId?: unknown;
      idempotencyKey?: unknown;
    };
    const { leads } = body;
    const parsedRevealEmail = parseRequestedFlag(body.revealEmail, true);
    const parsedRevealPhone = parseRequestedFlag(body.revealPhone, false);

    if (!parsedRevealEmail.ok || !parsedRevealPhone.ok) {
      return NextResponse.json({ error: 'invalid reveal flags' }, { status: 400 });
    }

    const shouldRevealEmail = parsedRevealEmail.value;
    const shouldRevealPhone = parsedRevealPhone.value;
    if (body.resource != null) {
      return NextResponse.json({ error: 'quota resource cannot be requested by clients' }, { status: 400 });
    }
    const resolvedMode = resolveEnrichmentMode(body.mode, trustedInternalCaller, shouldRevealPhone);
    if (!resolvedMode.ok) {
      return NextResponse.json({ error: resolvedMode.error }, { status: 400 });
    }
    const enrichmentMode = resolvedMode.mode;
    const quotaResource = resolveQuotaResource(enrichmentMode);
    const tableName = resolveTableName(body.tableName) || 'enriched_opportunities';
    if (body.tableName && !resolveTableName(body.tableName)) {
      return NextResponse.json({ error: `invalid tableName: ${String(body.tableName)}` }, { status: 400 });
    }
    if (!Array.isArray(leads) || leads.length === 0) return NextResponse.json({ error: 'leads requerido' }, { status: 400 });
    if (!shouldRevealEmail && !shouldRevealPhone) {
      return NextResponse.json({ error: 'at least one enrichment field is required' }, { status: 400 });
    }
    const operationIdentity = resolveEnrichmentOperationId(req, body);
    if (!operationIdentity.ok) {
      return NextResponse.json({ error: operationIdentity.error }, { status: 400 });
    }

    const normalizedBody = {
      ...body,
      revealEmail: shouldRevealEmail,
      revealPhone: shouldRevealPhone,
    };

    let organizationId: string | null;
    try {
      organizationId = await resolveRequiredOrganizationId(userId, organizationIdFromHeader || undefined);
    } catch (error) {
      console.error('[enrich-apollo] Organization lookup failed:', error);
      return NextResponse.json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' }, { status: 503 });
    }
    if (!organizationId) {
      return NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 403 });
    }

    const auditEnrichment = async (
      eventType: string,
      input: {
        status?: string;
        outcome?: string;
        severity?: string;
        provider?: string | null;
        errorCode?: string | null;
        metrics?: Record<string, unknown>;
        payload?: Record<string, unknown>;
      } = {},
    ) => safeAppendAntoniaEvent({
      eventType,
      organizationId,
      actorId: userId,
      actorType: trustedInternalCaller ? 'agent' : 'user',
      entityType: 'enrichment_operation',
      entityId: operationIdentity.operationId,
      sourceSystem: 'enrich-apollo',
      sourceRoute: '/api/opportunities/enrich-apollo',
      provider: input.provider || body.provider || null,
      requestId: operationIdentity.operationId,
      correlationId: operationIdentity.operationId,
      operationId: operationIdentity.operationId,
      idempotencyKey: operationIdentity.operationId,
      status: input.status,
      outcome: input.outcome,
      severity: input.severity,
      errorCode: input.errorCode,
      metrics: {
        leadCount: leads.length,
        mode: enrichmentMode,
        quotaResource,
        tableName,
        ...(input.metrics || {}),
      },
      payload: {
        revealEmail: shouldRevealEmail,
        revealPhone: shouldRevealPhone,
        ...(input.payload || {}),
      },
    });

    await auditEnrichment('enrichment.requested', {
      status: 'started',
      outcome: 'accepted',
      severity: 'info',
      metrics: { idempotencyProvided: true },
    });

    const existingRecordReferences = resolveExistingRecordIds(leads);
    if (!existingRecordReferences.ok) {
      return NextResponse.json({ error: 'INVALID_EXISTING_RECORD_ID' }, { status: 400 });
    }
    try {
      const ownsEveryExistingRecord = await existingRecordsBelongToOrganization({
        tableName,
        organizationId,
        recordIds: existingRecordReferences.recordIds,
      });
      if (!ownsEveryExistingRecord) {
        return NextResponse.json({ error: 'ENRICHMENT_RECORD_NOT_FOUND' }, { status: 404 });
      }
    } catch (error) {
      console.error('[enrich-apollo] Existing record ownership lookup failed:', error);
      return NextResponse.json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' }, { status: 503 });
    }

    const requestFingerprint = buildEnrichmentRequestFingerprint({
      leads,
      revealEmail: shouldRevealEmail,
      revealPhone: shouldRevealPhone,
      mode: enrichmentMode,
      requestedProvider: body.provider,
      tableName,
    });
    try {
      const existingOperation = await getEnrichmentQuotaOperation({
        userId,
        organizationId,
        resource: quotaResource,
        operationId: operationIdentity.operationId,
        requestFingerprint,
      });
      if (existingOperation) {
        await auditEnrichment('enrichment.replayed', {
          status: existingOperation.status,
          outcome: 'idempotent_replay',
          provider: body.provider,
          metrics: { operationState: existingOperation.status },
        });
        return operationStateResponse(existingOperation);
      }
    } catch (error) {
      if (/operation id was already used/i.test(String((error as any)?.message || ''))) {
        return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' }, { status: 409 });
      }
      console.error('[enrich-apollo] Quota operation replay lookup failed:', error);
      return NextResponse.json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' }, { status: 503 });
    }

    const providerDecision = resolveLeadProvider({
      requestedProvider: body.provider,
      organizationId,
      defaultProviderEnv: 'ENRICHMENT_PROVIDER_DEFAULT',
      fallbackDefaultProvider: 'apollo',
    });
    const pdlConfiguration = providerDecision.provider === 'pdl'
      ? resolvePdlProviderConfiguration()
      : { ok: true as const };
    if (!pdlConfiguration.ok) {
      return NextResponse.json({ error: pdlConfiguration.error }, { status: 500 });
    }
    const needsApolloConfiguration = providerDecision.provider === 'apollo' || isPdlFallbackEnabled();
    const apolloConfiguration = needsApolloConfiguration
      ? resolveApolloProviderConfiguration()
      : null;
    if (apolloConfiguration && !apolloConfiguration.ok) {
      return NextResponse.json({ error: apolloConfiguration.error }, { status: 500 });
    }

    let dailyLimit: number;
    try {
      const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
      dailyLimit = quotaResource === 'investigate' ? limits.research : limits.enrich;
    } catch (error) {
      console.error('[enrich-apollo] Quota limit resolution failed:', error);
      return NextResponse.json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' }, { status: 503 });
    }

    try {
      claimedOperation = await claimEnrichmentQuotaOperation({
        userId,
        organizationId,
        resource: quotaResource,
        operationId: operationIdentity.operationId,
        requestFingerprint,
        limit: dailyLimit,
        count: leads.length,
      });
    } catch (error) {
      console.error('[enrich-apollo] Atomic quota operation claim failed:', error);
      if (String((error as any)?.code || '') === '22023'
        && /operation id was already used/i.test(String((error as any)?.message || ''))) {
        return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' }, { status: 409 });
      }
      return NextResponse.json({ error: 'QUOTA_INFRASTRUCTURE_UNAVAILABLE' }, { status: 503 });
    }
    claimedOrganizationId = organizationId;
    claimedResource = quotaResource;
    if (!claimedOperation.claimed || !claimedOperation.allowed || !claimedOperation.claimToken) {
      await auditEnrichment('enrichment.failed', {
        status: claimedOperation.status,
        outcome: claimedOperation.allowed ? 'operation_not_claimed' : 'quota_denied',
        severity: 'warning',
        provider: providerDecision.provider,
        errorCode: claimedOperation.allowed ? null : 'daily_quota_exceeded',
        metrics: operationUsage(claimedOperation),
      });
    }
    if (!claimedOperation.claimed || !claimedOperation.allowed || !claimedOperation.claimToken) {
      return operationStateResponse(claimedOperation);
    }

    const operationClaimToken = claimedOperation.claimToken;
    const operationMutationIdentity = {
      userId,
      organizationId,
      resource: quotaResource,
      operationId: operationIdentity.operationId,
      claimToken: operationClaimToken,
    };
    const ensureProviderSubmitted = async () => {
      if (providerStarted) return;
      await markEnrichmentQuotaOperationSubmitted(operationMutationIdentity);
      providerStarted = true;
      await auditEnrichment('enrichment.provider_submitting', {
        status: 'submitting',
        outcome: 'claim_marked',
        provider: providerDecision.provider,
      });
    };
    const finalizeOperation = async (payload: Record<string, any>, status: number, providerUsed?: 'apollo' | 'pdl') => {
      const responsePayload = {
        ...payload,
        operationId: operationIdentity.operationId,
        operationStatus: status >= 200 && status < 300 ? 'completed' : 'failed',
        usage: operationUsage(claimedOperation!),
      };
      await completeEnrichmentQuotaOperation({
        ...operationMutationIdentity,
        status: status >= 200 && status < 300 ? 'completed' : 'failed',
        responseStatus: status,
        responsePayload,
      });
      await auditEnrichment(status >= 200 && status < 300 ? 'enrichment.completed' : 'enrichment.failed', {
        status: responsePayload.operationStatus,
        outcome: status >= 200 && status < 300 ? 'provider_completed' : 'provider_failed',
        severity: status >= 200 && status < 300 ? 'info' : 'error',
        provider: providerUsed || providerDecision.provider,
        metrics: { responseStatus: status, ...operationUsage(claimedOperation!) },
        payload: { providerUsed: providerUsed || providerDecision.provider, fallbackApplied },
      });
      const response = NextResponse.json(responsePayload, { status });
      response.headers.set('x-operation-id', operationIdentity.operationId);
      if (providerUsed) response.headers.set('x-provider-used', providerUsed);
      return response;
    };

    let providerUsed: 'apollo' | 'pdl' = providerDecision.provider;
    let fallbackApplied = false;
    let fallbackReason: string | undefined;

    if (providerDecision.provider === 'pdl') {
      try {
        const pdlResult = await handlePdlEnrichment({
          userId,
          body: normalizedBody,
          tableName,
          providerDecision,
          organizationId,
          enrichmentMode,
          beforeProviderCall: ensureProviderSubmitted,
        });
        return await finalizeOperation(pdlResult.payload, pdlResult.status, 'pdl');
      } catch (error: any) {
        if (error instanceof ProviderOutcomeUnknownError) throw error;
        if (!isPdlFallbackEnabled()) {
          return await finalizeOperation({
            error: 'PDL_ENRICHMENT_ERROR',
            message: error?.message || 'PDL enrichment failed',
            providerRequested: providerDecision.requestedProvider,
            providerUsed: 'pdl',
            fallbackApplied: false,
          }, 502, 'pdl');
        }
        providerUsed = 'apollo';
        fallbackApplied = true;
        fallbackReason = error?.message || 'pdl_enrichment_failed';
      }
    }

    const serverLogs: string[] = [];
    const log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      console.log('[enrich-apollo]', msg);
      serverLogs.push(msg);
    };

    console.log('[enrich-hybrid] Start', {
      count: leads.length,
      revealEmail: shouldRevealEmail,
      revealPhone: shouldRevealPhone,
      requestedFields: resolveRequestedFields(shouldRevealEmail, shouldRevealPhone),
      enrichmentLevel: resolveRequestedEnrichmentLevel(enrichmentMode),
      quotaResource,
      providerUsed,
      fallbackApplied,
    });

    if (!apolloConfiguration?.ok) {
      throw new Error('Apollo provider configuration was not validated');
    }
    const { externalUrl, backendSecret } = apolloConfiguration;

    const enrichedOut: any[] = [];
    const providerErrors: string[] = [];

    for (const l of leads) {
      const providedId = typeof l.id === 'string' ? l.id.trim() : '';
      const clientRef = typeof l.clientRef === 'string' ? l.clientRef.trim() : '';
      const explicitRecordId = typeof l.existingRecordId === 'string' ? l.existingRecordId.trim() : '';
      const existingRecordId = isUuid(explicitRecordId) ? explicitRecordId : '';

      // Retry only against a UUID row already verified in this organization.
      const isRetry = Boolean(existingRecordId);
      const enrichedId =
        existingRecordId ||
        uuid();

      // Prefer explicit Apollo ID; fallback to providedId when it is not a UUID (often Apollo person id)
      let foundApolloId: string | undefined =
        (typeof l.apolloId === 'string' && l.apolloId.trim() ? l.apolloId.trim() : undefined) ||
        (!isUuid(providedId) && providedId ? providedId : undefined);
      let emailResult: any = null;
      let providerImmediateStatus: string | undefined;
      const requestedFields = resolveRequestedFields(shouldRevealEmail, shouldRevealPhone);

      // [STEP 1] Ensure Row Exists
      if (!isRetry) {
        const initialRow = {
          id: enrichedId,
          user_id: userId,
          organization_id: organizationId,
          full_name: l.fullName,
          email: l.email || undefined,
          company_name: l.companyName,
          title: l.title,
          linkedin_url: l.linkedinUrl,
          created_at: new Date().toISOString(),
          phone_numbers: [],
          primary_phone: null,
          enrichment_status: shouldRevealPhone ? 'pending_phone' : 'completed',
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain: cleanDomain(l.companyDomain),
            apolloId: foundApolloId,
          }
        };
        const { error: insertError } = await getSupabaseAdmin().from(tableName).insert(initialRow);
        if (insertError) {
          const code = (insertError as any)?.code;
          if (code === '23505') {
            // Row already exists, continue with enrichment/update.
            log('[WARN] Initial row already exists. Continuing with enrichment:', enrichedId);
          } else {
            log('[FATAL] Failed to insert initial row:', insertError.message, JSON.stringify(insertError));
            // STOP processing this lead. If we can't save it, we can't enrich it.
            continue;
          }
        }
      } else {
        // If retrying phone, mark pending again
        if (shouldRevealPhone) {
          await getSupabaseAdmin()
            .from(tableName)
            .update({ enrichment_status: 'pending_phone' })
            .eq('id', enrichedId)
            .eq('organization_id', organizationId);
        }
      }

      // [STEP 2] CONSOLIDATED ENRICHMENT (New API)
      // The new API handles both email and phone enrichment in a single call
      try {
        // Prepare request payload for new API
        const parts = l.fullName.trim().split(/\s+/);
        const firstName = parts.length > 0 ? parts[0] : '';
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';

        const enrichmentPayload: any = {
          record_id: enrichedId,
          table_name: tableName,
          lead: {
            first_name: firstName,
            last_name: lastName,
            organization_name: l.companyName,
            organization_domain: cleanDomain(l.companyDomain)
          },
          reveal_email: shouldRevealEmail,
          reveal_phone: shouldRevealPhone,
          revealEmail: shouldRevealEmail,
          revealPhone: shouldRevealPhone,
          enrichment_level: resolveRequestedEnrichmentLevel(enrichmentMode),
          requested_data: {
            email: shouldRevealEmail,
            phone: shouldRevealPhone,
          },
          requested_fields: requestedFields,
        };

        // Add optional fields if available
        if (foundApolloId) {
          enrichmentPayload.lead.id = foundApolloId;
          enrichmentPayload.lead.apollo_id = foundApolloId;
        } else {
          log('[WARN] Missing Apollo person id for enrichment lead:', enrichedId);
        }

        log('[enrich-consolidated] Calling new enrichment API:', externalUrl);
        log('[enrich-consolidated] Payload:', JSON.stringify(enrichmentPayload));

        // Persist the no-retry provider boundary immediately before the first provider request.
        await ensureProviderSubmitted();
        const enrichRes = await fetch(externalUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-secret-key': backendSecret,
          },
          body: JSON.stringify(enrichmentPayload)
        });

        log('[enrich-consolidated] Response status:', enrichRes.status);

        if (enrichRes.ok) {
          let enrichData: any;
          try {
            enrichData = await enrichRes.json();
          } catch (error: any) {
            throw new ProviderOutcomeUnknownError(error?.message || 'Enrichment provider response could not be parsed');
          }
          log('[enrich-consolidated] Success:', JSON.stringify(enrichData));
          providerImmediateStatus = String(enrichData?.enrichment_status || '').trim() || undefined;

          if (enrichData.success && enrichData.extracted_data) {
            const extracted = enrichData.extracted_data;
            const normalizedPhoneNumbers = shouldRevealPhone ? (extracted.phone_numbers || []) : [];
            const normalizedPrimaryPhone = shouldRevealPhone ? (extracted.primary_phone || null) : null;
            const normalizedEnrichmentStatus = resolveImmediateEnrichmentStatus({
              requestedPhone: shouldRevealPhone,
              primaryPhone: normalizedPrimaryPhone,
              phoneNumbers: normalizedPhoneNumbers,
              providerStatus: extracted.enrichment_status || enrichData.enrichment_status,
            });

            // Map the response to our database structure
            const updateData: any = {
              full_name: extracted.first_name && extracted.last_name
                ? `${extracted.first_name} ${extracted.last_name}`
                : l.fullName,
              email: extracted.email || l.email,
              email_status: extracted.email_status || 'unknown',
              title: extracted.title || l.title,
              linkedin_url: extracted.linkedin_url || l.linkedinUrl,
              company_name: extracted.organization_name || l.companyName,

              // Location fields
              city: extracted.city,
              state: extracted.state,
              country: extracted.country,

              // Professional details
              headline: extracted.headline,
              photo_url: extracted.photo_url,
              seniority: extracted.seniority,
              departments: extracted.departments ?? null,

              // Organization details
              organization_domain: extracted.organization_domain || cleanDomain(l.companyDomain),
              organization_industry: extracted.organization_industry,
              organization_size: extracted.organization_size,

              // Phone data
              phone_numbers: normalizedPhoneNumbers,
              primary_phone: normalizedPrimaryPhone,

              // Status and metadata
              enrichment_status: normalizedEnrichmentStatus,
              updated_at: new Date().toISOString(),

              // Preserve existing data and add new fields
              data: {
                sourceOpportunityId: l.sourceOpportunityId,
                companyDomain: extracted.organization_domain || cleanDomain(l.companyDomain),
                emailStatus: extracted.email_status,
                apolloId: foundApolloId,
                requestedEnrichmentLevel: resolveRequestedEnrichmentLevel(enrichmentMode),
                requestedFields,
                requestedRevealPhone: shouldRevealPhone,
                requestedRevealEmail: shouldRevealEmail,
              }
            };

            // Update database with enriched data
            const { error: updateError } = await getSupabaseAdmin()
              .from(tableName)
              .update(updateData)
              .eq('id', enrichedId)
              .eq('organization_id', organizationId);

            if (updateError) {
              log('[ERROR] Failed to update enriched data:', updateError.message);
            } else {
              log('[SUCCESS] Lead enriched and saved:', enrichedId);
            }

            // Prepare response data
            emailResult = {
              fullName: updateData.full_name,
              email: extracted.email,
              emailStatus: extracted.email_status,
              linkedinUrl: extracted.linkedin_url,
              companyName: extracted.organization_name,
              title: extracted.title,
              companyDomain: extracted.organization_domain,
              industry: extracted.organization_industry,
              location: extracted.country ? `${extracted.city || ''}, ${extracted.state || ''}, ${extracted.country}`.replace(/^,\s*|,\s*,/g, ',').trim() : (extracted.city || ''),
              phoneNumbers: normalizedPhoneNumbers,
              primaryPhone: normalizedPrimaryPhone,
              seniority: extracted.seniority,
              departments: extracted.departments,
              headline: extracted.headline,
              photoUrl: extracted.photo_url,
              enrichmentStatus: normalizedEnrichmentStatus || updateData.enrichment_status
            };
          } else {
            log('[WARNING] Enrichment API returned no data');
          }
        } else {
          const errorText = await enrichRes.text();
          log('[ERROR] Enrichment API failed:', enrichRes.status, errorText);
          providerErrors.push(errorText || `HTTP_${enrichRes.status}`);
        }
      } catch (e: any) {
        if (e instanceof ProviderOutcomeUnknownError) throw e;
        if (providerStarted && (e?.name === 'AbortError' || /fetch failed|network|timeout|abort/i.test(String(e?.message || e)))) {
          throw new ProviderOutcomeUnknownError(e?.message || 'Enrichment provider outcome is unknown');
        }
        log('[ERROR] Enrichment exception:', e?.message || e);
        providerErrors.push(String(e?.message || e || 'unknown_enrichment_error'));
      }


      // Add to output
      const outPhoneNumbers = (emailResult?.phoneNumbers ?? null) as any;
      const outPrimaryPhone = (emailResult?.primaryPhone ?? null) as any;
      const outLinkedin = (emailResult?.linkedinUrl || l.linkedinUrl || '').trim();
      const outStatus = resolveImmediateEnrichmentStatus({
        requestedPhone: shouldRevealPhone,
        primaryPhone: outPrimaryPhone,
        phoneNumbers: outPhoneNumbers,
        providerStatus: emailResult?.enrichmentStatus || providerImmediateStatus,
      });

      enrichedOut.push({
        id: enrichedId,
        clientRef: clientRef || undefined,
        sourceOpportunityId: l.sourceOpportunityId,
        apolloId: foundApolloId,
        fullName: emailResult?.fullName || l.fullName,
        firstName: String(emailResult?.fullName || l.fullName || '').trim().split(/\s+/)[0] || undefined,
        companyName: emailResult?.companyName || l.companyName,
        title: emailResult?.title || l.title,
        headline: emailResult?.headline,
        email: emailResult?.email || l.email,
        emailStatus: emailResult?.emailStatus || 'unknown',
        linkedinUrl: normalizeLinkedin(outLinkedin),
        companyDomain: emailResult?.companyDomain || cleanDomain(l.companyDomain),
        industry: emailResult?.industry,
        location: emailResult?.location,
        phoneNumbers: outPhoneNumbers,
        primaryPhone: outPrimaryPhone,
        seniority: emailResult?.seniority,
        departments: emailResult?.departments,
        photoUrl: emailResult?.photoUrl,
        enrichmentStatus: outStatus,
        createdAt: new Date().toISOString()
      });

      await sleep(100);
    } // end for

    if (!providerStarted) {
      await releaseEnrichmentQuotaOperation(operationMutationIdentity);
      claimedOperation = null;
      return NextResponse.json({ error: 'ENRICHMENT_PRE_PROVIDER_FAILURE' }, { status: 500 });
    }

    const responsePayload: any = {
      enriched: enrichedOut,
      debug: { serverLogs },
      requestedData: {
        email: shouldRevealEmail,
        phone: shouldRevealPhone,
      },
      providerRequested: providerDecision.requestedProvider,
      providerUsed,
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedApolloReason,
      fallbackApplied,
      fallbackReason,
    };
    if (enrichedOut.length > 0 && providerErrors.length === enrichedOut.length) {
      responsePayload.error = providerErrors[0];
      return await finalizeOperation(responsePayload, 502, providerUsed);
    }

    return await finalizeOperation(responsePayload, 200, providerUsed);

  } catch (e: any) {
    if (claimedOperation?.claimToken && !providerStarted && claimedOrganizationId) {
      try {
        await releaseEnrichmentQuotaOperation({
          userId,
          organizationId: claimedOrganizationId,
          resource: claimedResource,
          operationId: claimedOperation.operationId,
          claimToken: claimedOperation.claimToken,
        });
        claimedOperation = null;
      } catch (releaseError) {
        console.error('[enrich-apollo] Failed to release pre-provider operation:', releaseError);
      }
    }
    if (e instanceof ProviderOutcomeUnknownError && claimedOperation) {
      const payload = {
        error: 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN',
        message: e.message,
        operationId: claimedOperation.operationId,
        operationStatus: 'failed',
        providerState: 'unknown',
        usage: operationUsage(claimedOperation),
      };
      if (claimedOperation.claimToken && claimedOrganizationId) {
        try {
          await completeEnrichmentQuotaOperation({
            userId,
            organizationId: claimedOrganizationId,
            resource: claimedResource,
            operationId: claimedOperation.operationId,
            claimToken: claimedOperation.claimToken,
            status: 'failed',
            responseStatus: 502,
            responsePayload: payload,
          });
        } catch (completionError) {
          console.error('[enrich-apollo] Failed to cache ambiguous provider outcome:', completionError);
        }
      }
      const response = NextResponse.json(payload, { status: 502 });
      response.headers.set('x-operation-id', claimedOperation.operationId);
      await safeAppendAntoniaEvent({
        eventType: 'enrichment.failed',
        organizationId: claimedOrganizationId,
        actorId: userId,
        actorType: trustedInternalCaller ? 'agent' : 'user',
        entityType: 'enrichment_operation',
        entityId: claimedOperation.operationId,
        sourceSystem: 'enrich-apollo',
        sourceRoute: '/api/opportunities/enrich-apollo',
        requestId: claimedOperation.operationId,
        correlationId: claimedOperation.operationId,
        operationId: claimedOperation.operationId,
        idempotencyKey: claimedOperation.operationId,
        status: 'failed',
        outcome: 'provider_outcome_unknown',
        severity: 'error',
        errorCode: 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN',
        metrics: operationUsage(claimedOperation),
        payload: { providerState: 'unknown' },
      });
      return response;
    }
    console.error('Fatal Hybrid Error', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function handlePdlEnrichment(params: {
  userId: string;
  body: (EnrichInput & { tableName?: string }) & { revealEmail: boolean; revealPhone: boolean };
  tableName: string;
  providerDecision: any;
  organizationId?: string | null;
  enrichmentMode: EnrichmentMode;
  beforeProviderCall: () => Promise<void>;
}) {
  const {
    userId,
    body,
    tableName,
    providerDecision,
    organizationId = null,
    enrichmentMode,
    beforeProviderCall,
  } = params;
  const { leads, revealEmail, revealPhone } = body;
  const shouldRevealEmail = revealEmail;
  const shouldRevealPhone = revealPhone;

  const serverLogs: string[] = [];
  const log = (...args: any[]) => {
    const msg = args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    console.log('[enrich-pdl]', msg);
    serverLogs.push(msg);
  };

  const enrichedOut: any[] = [];
  let successfulMatches = 0;
  let fatalPdlError: string | null = null;

  for (const l of leads) {
    const providedId = typeof l.id === 'string' ? l.id.trim() : '';
    const clientRef = typeof l.clientRef === 'string' ? l.clientRef.trim() : '';
    const explicitRecordId = typeof l.existingRecordId === 'string' ? l.existingRecordId.trim() : '';
    const existingRecordId = isUuid(explicitRecordId) ? explicitRecordId : '';
    const isRetry = Boolean(existingRecordId);
    const enrichedId =
      existingRecordId ||
      uuid();

    const foundApolloId: string | undefined =
      (typeof l.apolloId === 'string' && l.apolloId.trim() ? l.apolloId.trim() : undefined) ||
      (!isUuid(providedId) && providedId ? providedId : undefined);

    if (!isRetry) {
      const initialRow = {
        id: enrichedId,
        user_id: userId,
        organization_id: organizationId,
        full_name: l.fullName,
        email: l.email || undefined,
        company_name: l.companyName,
        title: l.title,
        linkedin_url: l.linkedinUrl,
        created_at: new Date().toISOString(),
        phone_numbers: [],
        primary_phone: null,
        enrichment_status: shouldRevealPhone ? 'pending_phone' : 'completed',
        data: {
          sourceOpportunityId: l.sourceOpportunityId,
          companyDomain: cleanDomain(l.companyDomain),
          apolloId: foundApolloId,
        },
      };

      const { error: insertError } = await getSupabaseAdmin().from(tableName).insert(initialRow);
      if (insertError) {
        const code = (insertError as any)?.code;
        if (code !== '23505') {
          log('[ERROR] Failed to insert initial row', insertError.message);
          continue;
        }
      }
    } else if (shouldRevealPhone) {
      await getSupabaseAdmin()
        .from(tableName)
        .update({ enrichment_status: 'pending_phone' })
        .eq('id', enrichedId)
        .eq('organization_id', organizationId);
    }

    let emailResult: any = null;

    try {
      await beforeProviderCall();
      const pdl = await enrichPersonWithPDL({
        linkedinUrl: l.linkedinUrl,
        email: l.email,
        fullName: l.fullName,
        companyName: l.companyName,
        companyDomain: cleanDomain(l.companyDomain),
        dataInclude: [
          'id',
          'full_name',
          'first_name',
          'last_name',
          'job_title',
          'job_title_role',
          'linkedin_url',
          'image_url',
          'summary',
          'location_locality',
          'location_region',
          'location_country',
          'work_email',
          'recommended_personal_email',
          'mobile_phone',
          'work_phone',
          'phone_numbers',
          'job_company_name',
          'job_company_website',
          'job_company_size',
          'job_company_industry',
        ],
      });

      if (pdl.matched && pdl.person) {
        successfulMatches++;
        const person = pdl.person;
        const email = shouldRevealEmail ? (pickPdlEmail(person) || l.email || undefined) : (l.email || undefined);
        const phoneSelection = shouldRevealPhone
          ? pickPdlPhones(person)
          : { primaryPhone: null as string | null, phoneNumbers: [] as any[] };

        const fullName =
          String(person.full_name || '').trim() ||
          `${String(person.first_name || '').trim()} ${String(person.last_name || '').trim()}`.trim() ||
          l.fullName;

        const city = String(person.location_locality || '').trim() || undefined;
        const state = String(person.location_region || '').trim() || undefined;
        const country = String(person.location_country || '').trim() || undefined;
        const companyDomain = cleanDomain(person.job_company_website || l.companyDomain);
        const enrichmentStatus = shouldRevealPhone
          ? ((phoneSelection.primaryPhone || phoneSelection.phoneNumbers.length > 0) ? 'completed' : 'pending_phone')
          : 'completed';

        const updateData: any = {
          full_name: fullName,
          email,
          email_status: email ? 'verified' : 'not_found',
          title: person.job_title || l.title,
          linkedin_url: person.linkedin_url || l.linkedinUrl,
          company_name: person.job_company_name || l.companyName,
          city,
          state,
          country,
          headline: person.summary || null,
          photo_url: person.image_url || null,
          seniority: person.job_title_role || null,
          departments: null,
          organization_domain: companyDomain,
          organization_industry: person.job_company_industry || null,
          organization_size: typeof person.job_company_size === 'number' ? person.job_company_size : null,
          phone_numbers: phoneSelection.phoneNumbers,
          primary_phone: phoneSelection.primaryPhone,
          enrichment_status: enrichmentStatus,
          updated_at: new Date().toISOString(),
          data: {
            sourceOpportunityId: l.sourceOpportunityId,
            companyDomain,
            apolloId: foundApolloId,
            provider: 'pdl',
            pdlLikelihood: person.likelihood ?? null,
            requestedEnrichmentLevel: resolveRequestedEnrichmentLevel(enrichmentMode),
            requestedRevealPhone: shouldRevealPhone,
            requestedRevealEmail: shouldRevealEmail,
          },
        };

        const { error: updateError } = await getSupabaseAdmin()
          .from(tableName)
          .update(updateData)
          .eq('id', enrichedId)
          .eq('organization_id', organizationId);

        if (updateError) {
          log('[ERROR] Failed to update PDL enriched data', updateError.message);
        }

        const location = [city, state, country].filter(Boolean).join(', ') || undefined;
        emailResult = {
          fullName,
          email,
          emailStatus: email ? 'verified' : 'not_found',
          linkedinUrl: updateData.linkedin_url,
          companyName: updateData.company_name,
          title: updateData.title,
          companyDomain,
          industry: updateData.organization_industry,
          location,
          phoneNumbers: phoneSelection.phoneNumbers,
          primaryPhone: phoneSelection.primaryPhone,
          seniority: updateData.seniority,
          departments: updateData.departments,
          headline: updateData.headline,
          photoUrl: updateData.photo_url,
          enrichmentStatus,
        };
      } else {
        log('[WARN] PDL did not match lead', l.fullName, l.companyName || '');
      }
    } catch (e: any) {
      const message = e?.message || String(e);
      log('[ERROR] PDL enrichment exception:', message);
      const normalized = String(message).toLowerCase();
      const isHttpError = /^PDL_HTTP_\d+/.test(String(message));
      const isNotFound = /^PDL_HTTP_404/.test(String(message));
      const isNetworkError =
        normalized.includes('fetch failed') ||
        normalized.includes('network') ||
        normalized.includes('timeout') ||
        normalized.includes('abort');

      if (isNetworkError) {
        throw new ProviderOutcomeUnknownError(message);
      }

      if (!fatalPdlError && isHttpError && !isNotFound) {
        fatalPdlError = String(message);
      }
    }

    const outPhoneNumbers = (emailResult?.phoneNumbers ?? null) as any;
    const outPrimaryPhone = (emailResult?.primaryPhone ?? null) as any;
    const outLinkedin = (emailResult?.linkedinUrl || l.linkedinUrl || '').trim();
    const outStatus =
      emailResult?.enrichmentStatus ||
      (shouldRevealPhone
        ? ((outPrimaryPhone || (Array.isArray(outPhoneNumbers) && outPhoneNumbers.length)) ? 'completed' : 'pending_phone')
        : 'completed');

    enrichedOut.push({
      id: enrichedId,
      clientRef: clientRef || undefined,
      sourceOpportunityId: l.sourceOpportunityId,
      apolloId: foundApolloId,
      fullName: emailResult?.fullName || l.fullName,
      firstName: String(emailResult?.fullName || l.fullName || '').trim().split(/\s+/)[0] || undefined,
      companyName: emailResult?.companyName || l.companyName,
      title: emailResult?.title || l.title,
      headline: emailResult?.headline,
      email: emailResult?.email || l.email,
      emailStatus: emailResult?.emailStatus || 'unknown',
      linkedinUrl: normalizeLinkedin(outLinkedin),
      companyDomain: emailResult?.companyDomain || cleanDomain(l.companyDomain),
      industry: emailResult?.industry,
      location: emailResult?.location,
      phoneNumbers: outPhoneNumbers,
      primaryPhone: outPrimaryPhone,
      seniority: emailResult?.seniority,
      departments: emailResult?.departments,
      photoUrl: emailResult?.photoUrl,
      enrichmentStatus: outStatus,
      createdAt: new Date().toISOString(),
    });

    await sleep(80);
  }

  if (fatalPdlError && successfulMatches === 0) {
    throw new Error(fatalPdlError);
  }

  const responsePayload: any = {
    enriched: enrichedOut,
    debug: { serverLogs },
    requestedData: {
      email: shouldRevealEmail,
      phone: shouldRevealPhone,
    },
    providerRequested: providerDecision.requestedProvider,
    providerUsed: 'pdl',
    providerDefault: providerDecision.defaultProvider,
    providerForcedReason: providerDecision.forcedApolloReason,
    fallbackApplied: false,
  };

  return { payload: responsePayload, status: 200 };
}

/* Identical helpers as before */
function normalizeLinkedin(url: string) {
  if (!url) return url;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (u.hostname.includes('linkedin.')) {
      u.protocol = 'https:';
      u.hostname = 'www.linkedin.com';
    }
    return u.toString();
  } catch { return url; }
}

function cleanDomain(x?: string) {
  if (!x) return x || undefined;
  try {
    const u = new URL(x.startsWith('http') ? x : `https://${x}`);
    const host = u.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const host = String(x).toLowerCase().replace(/^https?:\/\//, '');
    return host.startsWith('www.') ? host.slice(4) : host;
  }
}

function hasAnyPhone(primaryPhone: any, phoneNumbers: any) {
  return Boolean(primaryPhone) || (Array.isArray(phoneNumbers) && phoneNumbers.length > 0);
}

function resolveImmediateEnrichmentStatus(params: {
  requestedPhone: boolean;
  primaryPhone: any;
  phoneNumbers: any;
  providerStatus?: string | null;
}) {
  const providerStatus = String(params.providerStatus || '').trim().toLowerCase();
  if (!params.requestedPhone) {
    return providerStatus || 'completed';
  }

  if (hasAnyPhone(params.primaryPhone, params.phoneNumbers)) {
    return 'completed';
  }

  if (providerStatus.startsWith('pending')) {
    return providerStatus;
  }

  if (providerStatus === 'failed') {
    return 'failed';
  }

  return 'pending_phone';
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }


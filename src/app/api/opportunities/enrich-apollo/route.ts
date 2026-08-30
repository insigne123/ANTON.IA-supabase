import { createHash, randomUUID } from 'node:crypto';

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import {
  bindFullEnrichEnrichmentCallbacks,
  cancelFullEnrichEnrichmentCallbacks,
  createFullEnrichEnrichmentCallback,
  FULLENRICH_CALLBACK_CUSTOM_KEY,
  type FullEnrichRequestedField,
  type FullEnrichTargetTable,
} from '@/lib/server/fullenrich-enrichment-callbacks';
import {
  FullEnrichEnrichmentError,
  resolveFullEnrichWebhookUrl,
  submitFullEnrichBulkEnrichment,
  validateFullEnrichBulkContact,
} from '@/lib/server/fullenrich-enrichment';
import {
  claimEnrichmentQuotaOperation,
  completeEnrichmentQuotaOperation,
  getEffectiveDailyQuotaLimits,
  getEnrichmentQuotaOperation,
  markEnrichmentQuotaOperationSubmitted,
  releaseEnrichmentQuotaOperation,
  type EnrichmentQuotaOperationClaim,
} from '@/lib/server/daily-quota-store';
import { isTrustedInternalRequest } from '@/lib/server/internal-api-auth';
import { resolveLeadProvider } from '@/lib/server/provider-routing';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { pendingEnrichmentStatus, type PendingEnrichmentStatus } from '@/lib/enrichment-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ENRICHMENT_CONTACTS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TABLES = new Set<FullEnrichTargetTable>([
  'enriched_leads',
  'enriched_opportunities',
  'people_search_leads',
]);
const TRUE_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_FLAG_VALUES = new Set(['0', 'false', 'no', 'off']);

type EnrichmentMode = 'normal' | 'deep';
type QuotaResource = 'enrich' | 'investigate';

type EnrichmentLead = {
  fullName?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  title?: string;
  sourceOpportunityId?: string;
  clientRef?: string;
  email?: string;
  existingRecordId?: string;
  sourceProviderId?: string;
  source_provider_id?: string;
  id?: string;
};

type EnrichInput = {
  leads?: EnrichmentLead[];
  revealEmail?: boolean | string | number | null;
  revealPhone?: boolean | string | number | null;
  mode?: unknown;
  provider?: unknown;
  tableName?: unknown;
  operationId?: unknown;
  idempotencyKey?: unknown;
  resource?: unknown;
};

function text(value: unknown, maxLength = 500) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : '';
}

function isUuid(value: string) {
  return UUID_RE.test(value);
}

function cleanDomain(value: unknown) {
  const raw = text(value, 500).toLowerCase();
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function normalizeLinkedin(value: unknown) {
  const raw = text(value, 500);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function splitFullName(value: unknown) {
  const parts = text(value, 200).split(/\s+/).filter(Boolean);
  return {
    fullName: parts.join(' '),
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function profileTargetId(userId: string, organizationId: string, linkedinUrl: string) {
  const digest = createHash('sha256')
    .update(`${organizationId}\n${userId}\n${linkedinUrl}`)
    .digest('hex');
  return `profile:${digest}`;
}

function parseRequestedFlag(raw: unknown, defaultValue: boolean) {
  if (raw == null) return { ok: true as const, value: defaultValue };
  if (typeof raw === 'boolean') return { ok: true as const, value: raw };
  if (typeof raw === 'number') {
    if (raw === 1) return { ok: true as const, value: true };
    if (raw === 0) return { ok: true as const, value: false };
  }
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return { ok: true as const, value: defaultValue };
    if (TRUE_FLAG_VALUES.has(normalized)) return { ok: true as const, value: true };
    if (FALSE_FLAG_VALUES.has(normalized)) return { ok: true as const, value: false };
  }
  return { ok: false as const };
}

function resolveMode(value: unknown, trustedInternalCaller: boolean, revealPhone: boolean) {
  const expected: EnrichmentMode = revealPhone ? 'deep' : 'normal';
  const normalized = text(value, 20).toLowerCase();
  if (!normalized) return { ok: true as const, mode: expected };
  if (normalized !== 'normal' && normalized !== 'deep') {
    return { ok: false as const, error: 'invalid enrichment mode' };
  }
  if (!trustedInternalCaller) {
    return { ok: false as const, error: 'explicit enrichment mode is reserved for internal requests' };
  }
  if (normalized !== expected) {
    return { ok: false as const, error: 'enrichment mode does not match requested fields' };
  }
  return { ok: true as const, mode: normalized as EnrichmentMode };
}

function resolveTableName(value: unknown): FullEnrichTargetTable | null {
  const table = text(value, 80) as FullEnrichTargetTable;
  return ALLOWED_TABLES.has(table) ? table : null;
}

function resolveOperationId(request: NextRequest, body: EnrichInput) {
  const candidates = [
    request.headers.get('idempotency-key'),
    request.headers.get('x-idempotency-key'),
    body.operationId,
    body.idempotencyKey,
  ].map((value) => text(value, 200)).filter(Boolean);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return { ok: false as const, error: 'IDEMPOTENCY_KEY_REQUIRED' };
  if (unique.length > 1) return { ok: false as const, error: 'IDEMPOTENCY_KEY_CONFLICT' };
  return { ok: true as const, operationId: unique[0] };
}

function requestedFields(revealEmail: boolean, revealPhone: boolean): FullEnrichRequestedField[] {
  const fields: FullEnrichRequestedField[] = [];
  if (revealEmail) fields.push('contact.work_emails');
  if (revealPhone) fields.push('contact.phones');
  return fields;
}

function quotaResource(mode: EnrichmentMode): QuotaResource {
  return mode === 'deep' ? 'investigate' : 'enrich';
}

function requestFingerprint(input: {
  leads: EnrichmentLead[];
  revealEmail: boolean;
  revealPhone: boolean;
  mode: EnrichmentMode;
  tableName: FullEnrichTargetTable;
}) {
  const normalized = {
    version: 2,
    revealEmail: input.revealEmail,
    revealPhone: input.revealPhone,
    mode: input.mode,
    tableName: input.tableName,
    leads: input.leads.map((lead) => ({
      fullName: text(lead.fullName, 200),
      linkedinUrl: normalizeLinkedin(lead.linkedinUrl),
      companyName: text(lead.companyName, 200),
      companyDomain: cleanDomain(lead.companyDomain),
      title: text(lead.title, 160),
      existingRecordId: text(lead.existingRecordId, 100),
      sourceProviderId: text(lead.sourceProviderId || lead.source_provider_id, 200),
      clientRef: text(lead.clientRef, 200),
    })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function operationUsage(claim: EnrichmentQuotaOperationClaim) {
  return {
    consumed: claim.consumed,
    count: claim.count,
    limit: claim.limit,
    reused: claim.reused,
  };
}

async function operationTargets(input: {
  operationId: string;
  userId: string;
  organizationId: string;
  resource: QuotaResource;
  tableName: FullEnrichTargetTable;
}) {
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('fullenrich_enrichment_callbacks')
    .select('target_id')
    .eq('operation_id', input.operationId)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .eq('quota_resource', input.resource)
    .eq('target_table', input.tableName)
    .order('created_at', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row: any) => text(row?.target_id, 100))
    .filter(Boolean)
    .map((id: string) => ({ id }));
}

async function operationStateResponse(claim: EnrichmentQuotaOperationClaim, context: {
  userId: string;
  organizationId: string;
  resource: QuotaResource;
  tableName: FullEnrichTargetTable;
}) {
  const enriched = await operationTargets({ operationId: claim.operationId, ...context });
  if (claim.responsePayload && claim.responseStatus) {
    const response = NextResponse.json({
      ...claim.responsePayload,
      operationId: claim.operationId,
      operationStatus: claim.status,
      usage: operationUsage(claim),
      ...(enriched.length > 0 ? { enriched } : {}),
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
    ...(enriched.length > 0 ? { queued: true, enriched } : {}),
  }, { status: unknown ? 409 : 202 });
  response.headers.set('retry-after', unknown ? '0' : '5');
  response.headers.set('x-idempotent-replay', 'true');
  response.headers.set('x-operation-id', claim.operationId);
  return response;
}

async function resolveOrganizationId(userId: string, requestedOrganizationId?: string) {
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  const memberships = Array.isArray(data)
    ? data.map((row: any) => text(row?.organization_id, 36)).filter(Boolean)
    : [];
  if (memberships.length === 0) return null;
  return requestedOrganizationId ? (memberships.includes(requestedOrganizationId) ? requestedOrganizationId : null) : memberships[0];
}

function callbackContact(lead: EnrichmentLead, callbackId: string, enrichFields?: readonly FullEnrichRequestedField[]) {
  const name = splitFullName(lead.fullName);
  return {
    linkedinUrl: normalizeLinkedin(lead.linkedinUrl),
    firstName: name.firstName,
    lastName: name.lastName,
    companyDomain: cleanDomain(lead.companyDomain),
    companyName: text(lead.companyName, 200),
    enrichFields,
    custom: { [FULLENRICH_CALLBACK_CUSTOM_KEY]: callbackId },
  };
}

function validateLeadForFullEnrich(lead: EnrichmentLead) {
  return validateFullEnrichBulkContact({
    ...callbackContact(lead, 'callback-pending'),
  }) !== null;
}

type PreparedTarget = {
  id: string;
  clientRef?: string;
  lead: EnrichmentLead;
  sourceProviderId?: string;
};

async function prepareTargets(input: {
  leads: EnrichmentLead[];
  tableName: FullEnrichTargetTable;
  userId: string;
  organizationId: string;
  pendingStatus: PendingEnrichmentStatus;
}) {
  const admin: any = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const targets: PreparedTarget[] = [];

  for (const lead of input.leads) {
    const existingRecordId = text(lead.existingRecordId, 100);
    if (existingRecordId && input.tableName === 'enriched_opportunities' && !isUuid(existingRecordId)) {
      throw new Error('INVALID_EXISTING_RECORD_ID');
    }
    const linkedinUrl = normalizeLinkedin(lead.linkedinUrl);
    let id = existingRecordId || (input.tableName === 'people_search_leads' && linkedinUrl
      ? profileTargetId(input.userId, input.organizationId, linkedinUrl)
      : randomUUID());
    let existingProfile = false;
    const sourceProviderId = text(lead.sourceProviderId || lead.source_provider_id, 200) || undefined;
    const name = splitFullName(lead.fullName);
    const metadata = {
      sourceProvider: 'fullenrich',
      ...(sourceProviderId ? { sourceProviderId } : {}),
      sourceOpportunityId: text(lead.sourceOpportunityId, 200) || undefined,
      companyDomain: cleanDomain(lead.companyDomain) || undefined,
    };

    if (input.tableName === 'people_search_leads') {
      let profileQuery = admin
        .from('people_search_leads')
        .select('id')
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId);

      if (existingRecordId) {
        profileQuery = profileQuery.eq('id', existingRecordId);
      } else if (linkedinUrl) {
        profileQuery = profileQuery.eq('linkedin_url', linkedinUrl);
      } else {
        profileQuery = profileQuery.eq('id', id);
      }

      const { data: profile, error: profileError } = await profileQuery.limit(1).maybeSingle();
      if (profileError) throw profileError;
      if (existingRecordId && !profile) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (profile?.id) {
        id = String(profile.id);
        existingProfile = true;
      }
    }

    if (input.tableName === 'people_search_leads') {
      const profileValues = {
        name: name.fullName || null,
        first_name: name.firstName || null,
        last_name: name.lastName || null,
        linkedin_url: linkedinUrl || null,
        title: text(lead.title, 160) || null,
        organization_name: text(lead.companyName, 200) || null,
        organization_domain: cleanDomain(lead.companyDomain) || null,
        enrichment_status: input.pendingStatus,
        source_provider: 'fullenrich',
        source_provider_id: sourceProviderId || null,
        updated_at: now,
      };

      if (existingProfile) {
        const { error } = await admin
          .from('people_search_leads')
          .update(profileValues)
          .eq('id', id)
          .eq('user_id', input.userId)
          .eq('organization_id', input.organizationId);
        if (error) throw error;
      } else {
        const { error } = await admin.from('people_search_leads').upsert({
          id,
          user_id: input.userId,
          organization_id: input.organizationId,
          ...profileValues,
        }, { onConflict: 'id' });
        if (error) throw error;
      }
    } else if (existingRecordId) {
      const { data: existing, error: existingError } = await admin
        .from(input.tableName)
        .select('id, data')
        .eq('id', id)
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');

      const previousData = existing.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
        ? existing.data
        : {};
      const { error } = await admin
        .from(input.tableName)
        .update({
          full_name: name.fullName || undefined,
          company_name: text(lead.companyName, 200) || undefined,
          title: text(lead.title, 160) || undefined,
          linkedin_url: linkedinUrl || undefined,
          enrichment_status: input.pendingStatus,
          updated_at: now,
          source_provider: 'fullenrich',
          ...(sourceProviderId ? { source_provider_id: sourceProviderId } : {}),
          data: { ...previousData, ...metadata },
        })
        .eq('id', id)
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId);
      if (error) throw error;
    } else {
      const { error } = await admin.from(input.tableName).insert({
        id,
        user_id: input.userId,
        organization_id: input.organizationId,
        full_name: name.fullName || null,
        email: text(lead.email, 320) || null,
        company_name: text(lead.companyName, 200) || null,
        title: text(lead.title, 160) || null,
        linkedin_url: linkedinUrl || null,
        enrichment_status: input.pendingStatus,
        source_provider: 'fullenrich',
        source_provider_id: sourceProviderId || null,
        data: metadata,
        created_at: now,
        updated_at: now,
      });
      if (error) throw error;
    }

    targets.push({
      id,
      clientRef: text(lead.clientRef, 200) || undefined,
      lead,
      sourceProviderId,
    });
  }

  return targets;
}

async function markTargetsFailed(input: {
  targets: PreparedTarget[];
  tableName: FullEnrichTargetTable;
  userId: string;
  organizationId: string;
}) {
  const ids = input.targets.map((target) => target.id).filter(Boolean);
  if (ids.length === 0) return;
  const admin: any = getSupabaseAdminClient();
  const { error } = await admin
    .from(input.tableName)
    .update({ enrichment_status: 'failed', updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId);
  if (error) throw error;
}

async function auditEnrichment(input: {
  eventType: string;
  operationId: string;
  organizationId: string;
  userId: string;
  trustedInternalCaller: boolean;
  leadCount: number;
  status: string;
  outcome: string;
  severity?: 'info' | 'warning' | 'error';
  quotaResource: QuotaResource;
}) {
  await safeAppendAntoniaEvent({
    eventType: input.eventType,
    organizationId: input.organizationId,
    actorId: input.userId,
    actorType: input.trustedInternalCaller ? 'agent' : 'user',
    entityType: 'enrichment_operation',
    entityId: input.operationId,
    sourceSystem: 'fullenrich',
    sourceRoute: '/api/opportunities/enrich-apollo',
    provider: 'fullenrich',
    requestId: input.operationId,
    correlationId: input.operationId,
    operationId: input.operationId,
    idempotencyKey: input.operationId,
    status: input.status,
    outcome: input.outcome,
    severity: input.severity || 'info',
    metrics: { leadCount: input.leadCount, quotaResource: input.quotaResource },
  });
}

export async function POST(request: NextRequest) {
  const userIdFromHeader = text(request.headers.get('x-user-id'), 36);
  const organizationIdFromHeader = text(request.headers.get('x-organization-id'), 36);
  const trustedInternalCaller = Boolean(userIdFromHeader && isTrustedInternalRequest(request));
  let userId = userIdFromHeader;
  let claim: EnrichmentQuotaOperationClaim | null = null;
  let organizationId = '';
  let resource: QuotaResource = 'enrich';
  let providerSubmitted = false;
  let callbackIds: string[] = [];
  let targetTable: FullEnrichTargetTable | null = null;
  let preparedTargets: PreparedTarget[] = [];

  try {
    if (userIdFromHeader) {
      if (!trustedInternalCaller) {
        return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_REQUEST' }, { status: 401 });
      }
    } else {
      const supabase = createRouteHandlerClient({ cookies });
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
      userId = user.id;
    }
    if (organizationIdFromHeader && !trustedInternalCaller) {
      return NextResponse.json({ error: 'UNAUTHORIZED_INTERNAL_ORGANIZATION_REQUEST' }, { status: 401 });
    }

    let body: EnrichInput;
    try {
      body = await request.json() as EnrichInput;
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }
    if (body.resource != null) {
      return NextResponse.json({ error: 'QUOTA_RESOURCE_NOT_CLIENT_CONFIGURABLE' }, { status: 400 });
    }

    const revealEmail = parseRequestedFlag(body.revealEmail, true);
    const revealPhone = parseRequestedFlag(body.revealPhone, false);
    if (!revealEmail.ok || !revealPhone.ok) {
      return NextResponse.json({ error: 'INVALID_REVEAL_FLAGS' }, { status: 400 });
    }
    if (!revealEmail.value && !revealPhone.value) {
      return NextResponse.json({ error: 'ENRICHMENT_FIELDS_REQUIRED' }, { status: 400 });
    }
    const mode = resolveMode(body.mode, trustedInternalCaller, revealPhone.value);
    if (!mode.ok) return NextResponse.json({ error: mode.error }, { status: 400 });
    resource = quotaResource(mode.mode);

    const tableName = body.tableName == null ? 'enriched_opportunities' : resolveTableName(body.tableName);
    if (!tableName) return NextResponse.json({ error: 'INVALID_ENRICHMENT_TARGET' }, { status: 400 });
    targetTable = tableName;
    const leads = Array.isArray(body.leads) ? body.leads : [];
    if (leads.length === 0 || leads.length > MAX_ENRICHMENT_CONTACTS) {
      return NextResponse.json({ error: 'INVALID_ENRICHMENT_CONTACT_COUNT' }, { status: 400 });
    }
    if (leads.some((lead) => !lead || !validateLeadForFullEnrich(lead))) {
      return NextResponse.json({ error: 'FULLENRICH_CONTACT_IDENTITY_REQUIRED' }, { status: 400 });
    }
    const operation = resolveOperationId(request, body);
    if (!operation.ok) return NextResponse.json({ error: operation.error }, { status: 400 });

    const resolvedOrganizationId = await resolveOrganizationId(userId, organizationIdFromHeader || undefined);
    if (!resolvedOrganizationId) return NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 403 });
    organizationId = resolvedOrganizationId;
    const providerDecision = resolveLeadProvider({ requestedProvider: body.provider, organizationId });
    const fingerprint = requestFingerprint({
      leads,
      revealEmail: revealEmail.value,
      revealPhone: revealPhone.value,
      mode: mode.mode,
      tableName,
    });

    const existing = await getEnrichmentQuotaOperation({
      userId,
      organizationId,
      resource,
      operationId: operation.operationId,
      requestFingerprint: fingerprint,
    });
    if (existing) {
      return await operationStateResponse(existing, { userId, organizationId, resource, tableName });
    }

    const apiKey = text(process.env.FULLENRICH_API_KEY, 1_000);
    const webhookUrl = resolveFullEnrichWebhookUrl();
    if (!apiKey) return NextResponse.json({ error: 'FULLENRICH_API_KEY_NOT_CONFIGURED' }, { status: 503 });
    if (!webhookUrl) return NextResponse.json({ error: 'FULLENRICH_WEBHOOK_URL_NOT_CONFIGURED' }, { status: 503 });

    const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
    const dailyLimit = resource === 'investigate' ? limits.research : limits.enrich;
    claim = await claimEnrichmentQuotaOperation({
      userId,
      organizationId,
      resource,
      operationId: operation.operationId,
      requestFingerprint: fingerprint,
      limit: dailyLimit,
      count: leads.length,
    });
    if (!claim.claimed || !claim.allowed || !claim.claimToken) {
      return await operationStateResponse(claim, { userId, organizationId, resource, tableName });
    }

    await auditEnrichment({
      eventType: 'enrichment.requested',
      operationId: operation.operationId,
      organizationId,
      userId,
      trustedInternalCaller,
      leadCount: leads.length,
      status: 'claimed',
      outcome: 'accepted',
      quotaResource: resource,
    });

    const fields = requestedFields(revealEmail.value, revealPhone.value);
    const pendingStatus = pendingEnrichmentStatus({
      revealEmail: revealEmail.value,
      revealPhone: revealPhone.value,
    });
    const targets = await prepareTargets({ leads, tableName, userId, organizationId, pendingStatus });
    preparedTargets = targets;
    const contacts = [];
    try {
      for (const target of targets) {
        const callback = await createFullEnrichEnrichmentCallback({
          operationId: operation.operationId,
          userId,
          organizationId,
          quotaResource: resource,
          targetTable: tableName,
          targetId: target.id,
          requestedFields: fields,
        });
        callbackIds.push(callback.callbackId);
        contacts.push(callbackContact(target.lead, callback.callbackId, fields));
      }
    } catch (error) {
      if (callbackIds.length > 0) {
        await cancelFullEnrichEnrichmentCallbacks({ callbackIds, errorCode: 'callback_create_failed' }).catch(() => undefined);
      }
      throw error;
    }

    await markEnrichmentQuotaOperationSubmitted({
      userId,
      organizationId,
      resource,
      operationId: operation.operationId,
      claimToken: claim.claimToken,
    });
    providerSubmitted = true;

    const submission = await submitFullEnrichBulkEnrichment({
      apiKey,
      webhookUrl,
      contacts,
    });
    await bindFullEnrichEnrichmentCallbacks({
      callbackIds,
      providerEnrichmentId: submission.enrichmentId,
    }).catch((error) => {
      console.error('[fullenrich] callback binding failed after provider acceptance', error);
    });

    const responsePayload = {
      queued: true,
      operationId: operation.operationId,
      operationStatus: 'submitted',
      providerRequested: providerDecision.requestedProvider,
      providerUsed: providerDecision.provider,
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedProviderReason,
      usage: operationUsage(claim),
      enriched: targets.map((target) => ({
        id: target.id,
        clientRef: target.clientRef,
        fullName: splitFullName(target.lead.fullName).fullName || undefined,
        title: text(target.lead.title, 160) || undefined,
        linkedinUrl: normalizeLinkedin(target.lead.linkedinUrl) || undefined,
        companyName: text(target.lead.companyName, 200) || undefined,
        companyDomain: cleanDomain(target.lead.companyDomain) || undefined,
        sourceProvider: 'fullenrich',
        sourceProviderId: target.sourceProviderId,
        enrichmentStatus: pendingStatus,
        createdAt: new Date().toISOString(),
      })),
    };
    await auditEnrichment({
      eventType: 'enrichment.queued',
      operationId: operation.operationId,
      organizationId,
      userId,
      trustedInternalCaller,
      leadCount: leads.length,
      status: 'submitted',
      outcome: 'provider_accepted',
      quotaResource: resource,
    });
    const response = NextResponse.json(responsePayload, { status: 202 });
    response.headers.set('x-operation-id', operation.operationId);
    response.headers.set('x-provider-used', 'fullenrich');
    response.headers.set('retry-after', '5');
    return response;
  } catch (error) {
    const operationId = claim?.operationId;
    const claimToken = claim?.claimToken;

    if (!providerSubmitted && callbackIds.length > 0) {
      await cancelFullEnrichEnrichmentCallbacks({ callbackIds, errorCode: 'pre_provider_failure' }).catch(() => undefined);
    }
    if (!providerSubmitted && targetTable && callbackIds.length > 0) {
      await markTargetsFailed({
        targets: preparedTargets.slice(0, callbackIds.length),
        tableName: targetTable,
        userId,
        organizationId,
      }).catch(() => undefined);
    }
    if (!providerSubmitted && claimToken && organizationId) {
      await releaseEnrichmentQuotaOperation({
        userId,
        organizationId,
        resource,
        operationId: claim!.operationId,
        claimToken,
      }).catch(() => undefined);
    }

    if (error instanceof FullEnrichEnrichmentError) {
      if (providerSubmitted && !error.providerOutcomeUnknown && claimToken && organizationId) {
        await cancelFullEnrichEnrichmentCallbacks({ callbackIds, errorCode: 'provider_submission_failed' }).catch(() => undefined);
        if (targetTable && callbackIds.length > 0) {
          await markTargetsFailed({
            targets: preparedTargets.slice(0, callbackIds.length),
            tableName: targetTable,
            userId,
            organizationId,
          }).catch(() => undefined);
        }
        await completeEnrichmentQuotaOperation({
          userId,
          organizationId,
          resource,
          operationId: claim!.operationId,
          claimToken,
          status: 'failed',
          responseStatus: error.status,
          responsePayload: {
            error: error.code,
            operationId: claim!.operationId,
            operationStatus: 'failed',
            providerState: 'not_accepted',
          },
        }).catch(() => undefined);
      }
      const response = NextResponse.json({
        error: error.providerOutcomeUnknown ? 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN' : error.code,
        ...(operationId ? { operationId } : {}),
        ...(providerSubmitted ? { operationStatus: 'submitted' } : {}),
        ...(error.providerOutcomeUnknown && preparedTargets.length > 0
          ? { queued: true, enriched: preparedTargets.map((target) => ({ id: target.id })) }
          : {}),
      }, { status: error.status });
      if (operationId) response.headers.set('x-operation-id', operationId);
      return response;
    }

    const internalErrorCode = String((error as { message?: string } | null)?.message || 'ENRICHMENT_REQUEST_FAILED');
    const exposedErrors = new Set([
      'FULLENRICH_CALLBACK_IN_FLIGHT',
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
      'ENRICHMENT_TARGET_NOT_FOUND',
      'INVALID_EXISTING_RECORD_ID',
    ]);
    const errorCode = exposedErrors.has(internalErrorCode) ? internalErrorCode : 'ENRICHMENT_REQUEST_FAILED';
    if (errorCode === 'ENRICHMENT_REQUEST_FAILED') {
      console.error('[fullenrich] enrichment request failed', error);
    }
    const status = errorCode === 'FULLENRICH_CALLBACK_IN_FLIGHT'
      || errorCode === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' ? 409
      : errorCode === 'ENRICHMENT_TARGET_NOT_FOUND' || errorCode === 'INVALID_EXISTING_RECORD_ID' ? 400
        : 500;
    return NextResponse.json({ error: errorCode }, { status });
  }
}

import { createHash, randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { applyEnrichedIdentity, identityFromProvider } from '@/lib/server/lead-identity';

import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';
import {
  APOLLO_REQUESTED_FIELDS,
  type ApolloRequestedField,
  type ApolloTargetTable,
  applyApolloEnrichmentCandidate,
  bindApolloEnrichmentCallback,
  createApolloEnrichmentCallback,
  markApolloEnrichmentCallbackSubmitted,
  settleApolloEnrichmentCallback,
} from '@/lib/server/apollo-enrichment-callbacks';
import {
  ApolloEnrichmentError,
  assertApolloEnrichmentConfigured,
  submitApolloEnrichment,
} from '@/lib/server/apollo-enrichment';
import { safeAppendAntoniaEvent } from '@/lib/server/antonia-event-ledger';
import {
  claimEnrichmentQuotaOperation,
  completeEnrichmentQuotaOperation,
  getEffectiveDailyQuotaLimits,
  getEnrichmentQuotaOperation,
  markEnrichmentQuotaOperationSubmitted,
  releaseEnrichmentQuotaOperation,
  type EnrichmentQuotaOperationClaim,
} from '@/lib/server/daily-quota-store';
import {
  enrichmentSearchCreditsUnavailablePayload,
  hasEnrichmentSearchCreditAccess,
  hasUserEnrichmentSearchCreditAccess,
} from '@/lib/server/enrichment-search-access';
import { resolveLeadProvider } from '@/lib/server/provider-routing';
import {
  requestAuthErrorResponse,
  requireSessionOrTrustedInternalRequest,
} from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { hybridEnabled } from '@/lib/server/microworlds/contracts';
import { observeConfirmedApolloIdentity } from '@/lib/server/microworlds/search';
import { findHybridHint, frozenHybridItems, registerHybridItem, applyHybridCache, hybridFieldPlan, cancelHybridItems, settleHybrid,
  type HybridHint, type HybridScope } from '@/lib/server/microworlds/fulfillment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_ENRICHMENT_CONTACTS = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TABLES = new Set<ApolloTargetTable>([
  'enriched_leads',
  'enriched_opportunities',
  'people_search_leads',
]);
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

type EnrichmentMode = 'normal' | 'deep';
type QuotaResource = 'enrich' | 'investigate';

type EnrichmentLead = {
  sourceProvider?: string;
  source_provider?: string;
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
  apolloId?: string;
  id?: string;
};

type EnrichInput = {
  leads?: EnrichmentLead[];
  revealEmail?: boolean | string | number | null;
  revealPhone?: boolean | string | number | null;
  mode?: unknown;
  tableName?: unknown;
  operationId?: unknown;
  idempotencyKey?: unknown;
  resource?: unknown;
};

type PreparedTarget = {
  id: string;
  clientRef?: string;
  sourceProviderId?: string;
  boundPersonId?: string;
  lead: EnrichmentLead;
  hybridHint?: HybridHint;
  fieldPlan?: {apolloEmail:boolean;apolloPhone:boolean;verifyEmail:boolean};
};

type CallbackHandle = Awaited<ReturnType<typeof createApolloEnrichmentCallback>> & {
  targetId: string;
};

function text(value: unknown, maxLength = 500) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const normalized = String(value).trim();
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
  return normalizeLinkedinProfileUrl(text(value, 500));
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
  return `profile:${createHash('sha256').update(`${organizationId}\n${userId}\n${linkedinUrl}`).digest('hex')}`;
}

function parseFlag(raw: unknown, fallback: boolean) {
  if (raw == null) return { ok: true as const, value: fallback };
  if (typeof raw === 'boolean') return { ok: true as const, value: raw };
  if (typeof raw === 'number' && (raw === 0 || raw === 1)) return { ok: true as const, value: raw === 1 };
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return { ok: true as const, value: fallback };
    if (TRUE_VALUES.has(normalized)) return { ok: true as const, value: true };
    if (FALSE_VALUES.has(normalized)) return { ok: true as const, value: false };
  }
  return { ok: false as const };
}

function resolveMode(raw: unknown, trustedInternal: boolean, revealPhone: boolean) {
  const expected: EnrichmentMode = revealPhone ? 'deep' : 'normal';
  const normalized = text(raw, 20).toLowerCase();
  if (!normalized) return { ok: true as const, mode: expected };
  if (normalized !== 'normal' && normalized !== 'deep') return { ok: false as const, error: 'INVALID_ENRICHMENT_MODE' };
  if (!trustedInternal) return { ok: false as const, error: 'ENRICHMENT_MODE_INTERNAL_ONLY' };
  if (normalized !== expected) return { ok: false as const, error: 'ENRICHMENT_MODE_FIELD_MISMATCH' };
  return { ok: true as const, mode: normalized as EnrichmentMode };
}

function resolveTableName(value: unknown): ApolloTargetTable | null {
  const table = text(value, 80) as ApolloTargetTable;
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

function requestedFields(revealEmail: boolean, revealPhone: boolean) {
  const fields: ApolloRequestedField[] = [];
  if (revealEmail) fields.push(APOLLO_REQUESTED_FIELDS[0]);
  if (revealPhone) fields.push(APOLLO_REQUESTED_FIELDS[1]);
  return fields;
}

function quotaResource(mode: EnrichmentMode): QuotaResource {
  return mode === 'deep' ? 'investigate' : 'enrich';
}

function sourceProviderId(lead: EnrichmentLead) {
  const explicit = text(lead.sourceProviderId || lead.source_provider_id || lead.apolloId, 255);
  if (explicit) return explicit;
  const candidate = text(lead.id, 255);
  return candidate && !isUuid(candidate) ? candidate : '';
}

function validLeadIdentity(lead: EnrichmentLead) {
  const name = splitFullName(lead.fullName);
  return Boolean(
    sourceProviderId(lead)
    || normalizeLinkedin(lead.linkedinUrl)
    || (name.firstName && (cleanDomain(lead.companyDomain) || text(lead.companyName, 200))),
  );
}

function requestFingerprint(input: {
  leads: EnrichmentLead[];
  revealEmail: boolean;
  revealPhone: boolean;
  mode: EnrichmentMode;
  tableName: ApolloTargetTable;
}) {
  return createHash('sha256').update(JSON.stringify({
    version: 3,
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
      email: text(lead.email, 320).toLowerCase(),
      existingRecordId: text(lead.existingRecordId, 255),
      sourceProviderId: sourceProviderId(lead),
      clientRef: text(lead.clientRef, 200),
    })),
  })).digest('hex');
}

async function assertLeadEmailsNotSuppressed(input: {
  leads: EnrichmentLead[];
  userId: string;
  organizationId: string;
}) {
  const emails = [...new Set(input.leads
    .map((lead) => text(lead.email, 320).toLowerCase())
    .filter(Boolean))];
  if (emails.length === 0) return;
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('has_apollo_enrichment_email_suppression_v1', {
    p_user_id: input.userId,
    p_organization_id: input.organizationId,
    p_emails: emails,
  });
  if (error) throw error;
  if (data === true) {
    throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
  }
}

function usage(claim: EnrichmentQuotaOperationClaim) {
  return { consumed: claim.consumed, count: claim.count, limit: claim.limit, reused: claim.reused };
}

async function operationTargets(input: {
  operationId: string;
  userId: string;
  organizationId: string;
  resource: QuotaResource;
  tableName: ApolloTargetTable;
}) {
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('apollo_enrichment_callbacks')
    .select('target_lead_id, requested_fields')
    .eq('operation_id', input.operationId)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .eq('quota_resource', input.resource)
    .eq('target_table', input.tableName)
    .order('created_at', { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: any) => ({
    id: text(row?.target_lead_id, 255),
    requestedPhone: Array.isArray(row?.requested_fields) && row.requested_fields.includes('person.phone_numbers'),
  })).filter((row) => row.id);
}

async function operationStateResponse(claim: EnrichmentQuotaOperationClaim, context: {
  userId: string;
  organizationId: string;
  resource: QuotaResource;
  tableName: ApolloTargetTable;
  requested?: {email:boolean;phone:boolean};
  leads?: EnrichmentLead[];
}) {
  const enriched = await operationTargets({ operationId: claim.operationId, ...context });
  const references=new Map<string,string>();
  if(context.tableName==='enriched_leads'){
    const {data}=await (getSupabaseAdminClient() as any).from('hybrid_enrichment_items').select('target_id,client_ref,requested_phone')
      .eq('organization_id',context.organizationId).eq('user_id',context.userId).eq('resource',context.resource).eq('operation_id',claim.operationId);
    for(const row of data||[]){references.set(row.target_id,row.client_ref||'');
      if(!enriched.some(item=>item.id===row.target_id))enriched.push({id:row.target_id,requestedPhone:row.requested_phone===true});}
  }
  const replayEnriched = context.requested ? await Promise.all(enriched.map(async item=>{
    const row=await loadPersistedTarget({tableName:context.tableName,targetId:item.id,userId:context.userId,organizationId:context.organizationId});
    const lead=context.leads?.find(l=>l.existingRecordId===item.id||sourceProviderId(l)===String(row.source_provider_id||''));
    return canonicalTargetResponse({row,target:{id:item.id,lead:lead||{},clientRef:references.get(item.id)||lead?.clientRef},
      revealEmail:context.requested!.email,revealPhone:context.requested!.phone});
  })) : enriched.map((item) => ({ id: item.id }));
  const pendingEnriched = enriched.map((item) => ({
    id: item.id,
    enrichmentStatus: item.requestedPhone ? 'pending_phone' : 'pending',
  }));
  if (claim.responsePayload && claim.responseStatus) {
    const response = NextResponse.json({
      ...claim.responsePayload,
      operationId: claim.operationId,
      operationStatus: claim.status,
      usage: usage(claim),
      ...(enriched.length > 0 ? { enriched: replayEnriched } : {}),
    }, { status: claim.responseStatus });
    if (claim.reused) response.headers.set('x-idempotent-replay', 'true');
    response.headers.set('x-operation-id', claim.operationId);
    return response;
  }
  const unknown = claim.providerState === 'unknown';
  const phoneRequested = enriched.some((item) => item.requestedPhone);
  const response = NextResponse.json({
    error: unknown ? 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN' : 'ENRICHMENT_OPERATION_PROCESSING',
    operationId: claim.operationId,
    operationStatus: claim.status,
    providerState: claim.providerState,
    usage: usage(claim),
    ...(enriched.length > 0 ? {
      queued: true,
      enriched: pendingEnriched,
      phone_enrichment: phoneEnrichmentResponse({
        requested: phoneRequested,
        enriched: pendingEnriched,
      }),
    } : {}),
  }, { status: unknown ? 409 : 202 });
  response.headers.set('retry-after', unknown ? '0' : '5');
  response.headers.set('x-idempotent-replay', 'true');
  response.headers.set('x-operation-id', claim.operationId);
  return response;
}

async function prepareTargets(input: {
  leads: EnrichmentLead[];
  tableName: ApolloTargetTable;
  userId: string;
  organizationId: string;
  revealPhone: boolean;
}) {
  const admin: any = getSupabaseAdminClient();
  const now = new Date().toISOString();
  const targets: PreparedTarget[] = [];
  const stableTargetIds = input.leads.flatMap((lead) => {
    const existingRecordId = text(lead.existingRecordId, 255);
    if (existingRecordId) return [`${input.tableName}:${existingRecordId}`];
    const linkedinUrl = normalizeLinkedin(lead.linkedinUrl);
    return input.tableName === 'people_search_leads' && linkedinUrl
      ? [`${input.tableName}:${profileTargetId(input.userId, input.organizationId, linkedinUrl)}`]
      : [];
  });
  if (new Set(stableTargetIds).size !== stableTargetIds.length) {
    throw new Error('DUPLICATE_ENRICHMENT_TARGET');
  }

  for (const lead of input.leads) {
    const existingRecordId = text(lead.existingRecordId, 255);
    if (existingRecordId && input.tableName === 'enriched_opportunities' && !isUuid(existingRecordId)) {
      throw new Error('INVALID_EXISTING_RECORD_ID');
    }
    const linkedinUrl = normalizeLinkedin(lead.linkedinUrl);
    let id = existingRecordId || (input.tableName === 'people_search_leads' && linkedinUrl
      ? profileTargetId(input.userId, input.organizationId, linkedinUrl)
      : randomUUID());
    let boundPersonId: string | undefined;
    let providerId = sourceProviderId(lead) || undefined;
    const inputEmail = text(lead.email, 320).toLowerCase() || undefined;
    const name = splitFullName(lead.fullName);
    const status = input.revealPhone ? 'pending_phone' : 'pending';
    let existingData: JsonRecord = {};

    if (input.tableName === 'people_search_leads') {
      let query = admin
        .from('people_search_leads')
        .select('id,enrichment_status,apollo_person_id,source_provider_id')
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId);
      query = existingRecordId ? query.eq('id', existingRecordId)
        : linkedinUrl ? query.eq('linkedin_url', linkedinUrl)
          : query.eq('id', id);
      const { data: existing, error } = await query.limit(1).maybeSingle();
      if (error) throw error;
      if (existingRecordId && !existing) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (text(existing?.enrichment_status, 64) === 'suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
      if (existing?.id) id = String(existing.id);
      // First-seen person binding: a URL already linked to a known Apollo
      // person must keep resolving to that same person. A different person id
      // means the provider flipped its mapping and must not overwrite the row.
      boundPersonId = text((existing as any)?.apollo_person_id || (existing as any)?.source_provider_id, 255) || undefined;

      const values = {
        // A URL-only retry must not erase an already resolved profile or its
        // first-seen Apollo identity while the next request is in flight.
        name: name.fullName || undefined,
        first_name: name.firstName || undefined,
        last_name: name.lastName || undefined,
        linkedin_url: linkedinUrl || undefined,
        title: text(lead.title, 160) || undefined,
        organization_name: text(lead.companyName, 200) || undefined,
        organization_domain: cleanDomain(lead.companyDomain) || undefined,
        ...(inputEmail ? { email: inputEmail } : {}),
        apollo_person_id: providerId || boundPersonId || undefined,
        source_provider: 'apollo',
        source_provider_id: providerId || boundPersonId || undefined,
        enrichment_status: status,
        updated_at: now,
      };
      const mutation = existing?.id
        ? admin.from('people_search_leads').update(values).eq('id', id).eq('user_id', input.userId).eq('organization_id', input.organizationId)
        : admin.from('people_search_leads').insert({
          id,
          user_id: input.userId,
          organization_id: input.organizationId,
          ...values,
        });
      const { data: prepared, error: mutationError } = await mutation
        .select('id,enrichment_status')
        .maybeSingle();
      if (mutationError) throw mutationError;
      if (!prepared) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (text(prepared.enrichment_status, 64) === 'suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
    } else if (existingRecordId) {
      const { data: existing, error } = await admin
        .from(input.tableName)
        .select('id, data, enrichment_status, source_provider, source_provider_id')
        .eq('id', id)
        .eq('user_id', input.userId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
      if (error) throw error;
      if (!existing) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (existing.source_provider === 'leads_finder' || text(existing.source_provider_id, 255).startsWith('lf_')
        || object(existing.data)?.sourceProvider === 'leads_finder') throw new Error('ENRICHMENT_PROVIDER_MISMATCH');
      boundPersonId=text(existing.source_provider_id||object(existing.data)?.sourceProviderId,255)||undefined;
      if(providerId&&boundPersonId&&providerId!==boundPersonId)throw Error('APOLLO_PERSON_IDENTITY_MISMATCH');
      providerId=providerId||boundPersonId;
      if (text(existing.enrichment_status, 64) === 'suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
      existingData = object(existing.data) || {};
      const { data: prepared, error: updateError } = await admin.from(input.tableName).update({
        full_name: name.fullName || undefined,
        company_name: text(lead.companyName, 200) || undefined,
        title: text(lead.title, 160) || undefined,
        linkedin_url: linkedinUrl || undefined,
        ...(inputEmail ? { email: inputEmail } : {}),
        source_provider: 'apollo',
        ...(providerId ? { source_provider_id: providerId } : {}),
        enrichment_status: status,
        updated_at: now,
        data: {
          ...existingData,
          sourceProvider: 'apollo',
          sourceProviderId: providerId,
          sourceOpportunityId: text(lead.sourceOpportunityId, 200) || undefined,
          companyDomain: cleanDomain(lead.companyDomain) || undefined,
        },
      }).eq('id', id).eq('user_id', input.userId).eq('organization_id', input.organizationId)
        .select('id,enrichment_status')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!prepared) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (text(prepared.enrichment_status, 64) === 'suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
    } else {
      const { data: prepared, error } = await admin.from(input.tableName).insert({
        id,
        user_id: input.userId,
        organization_id: input.organizationId,
        full_name: name.fullName || null,
        email: inputEmail || null,
        company_name: text(lead.companyName, 200) || null,
        title: text(lead.title, 160) || null,
        linkedin_url: linkedinUrl || null,
        source_provider: 'apollo',
        source_provider_id: providerId || null,
        enrichment_status: status,
        data: {
          sourceProvider: 'apollo',
          sourceProviderId: providerId,
          sourceOpportunityId: text(lead.sourceOpportunityId, 200) || undefined,
          companyDomain: cleanDomain(lead.companyDomain) || undefined,
        },
        created_at: now,
        updated_at: now,
      }).select('id,enrichment_status').maybeSingle();
      if (error) throw error;
      if (!prepared) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
      if (text(prepared.enrichment_status, 64) === 'suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
    }

    targets.push({
      id,
      lead,
      sourceProviderId: providerId,
      boundPersonId,
      clientRef: text(lead.clientRef, 200) || undefined,
    });
  }
  if (new Set(targets.map((target) => `${input.tableName}:${target.id}`)).size !== targets.length) {
    throw new Error('DUPLICATE_ENRICHMENT_TARGET');
  }
  return targets;
}

async function markTargetsFailed(input: {
  targets: PreparedTarget[];
  tableName: ApolloTargetTable;
  userId: string;
  organizationId: string;
}) {
  const ids = [...new Set(input.targets.map((target) => target.id).filter(Boolean))];
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

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

type JsonRecord = Record<string, unknown>;

function persistedTargetColumns(tableName: ApolloTargetTable) {
  if (tableName === 'people_search_leads') {
    return 'id, name, first_name, last_name, title, organization_name, organization_domain, linkedin_url, email, email_status, phone_numbers, primary_phone, source_provider, source_provider_id, enrichment_status';
  }
  return tableName === 'enriched_leads'
    ? 'id, full_name, title, company_name, organization_domain, linkedin_url, email, email_status, phone_numbers, primary_phone, source_provider, source_provider_id, enrichment_status, data'
    : 'id, full_name, title, company_name, linkedin_url, email, email_status, phone_numbers, primary_phone, source_provider, source_provider_id, enrichment_status, data';
}

async function loadPersistedTarget(input: {
  tableName: ApolloTargetTable;
  targetId: string;
  userId: string;
  organizationId: string;
}) {
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin.from(input.tableName)
    .select(persistedTargetColumns(input.tableName))
    .eq('id', input.targetId)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
  return object(data) || {};
}

async function markApolloMatchOnlySubmitted(input: {
  target: PreparedTarget;
  tableName: ApolloTargetTable;
  userId: string;
  organizationId: string;
  resource: QuotaResource;
  operationId: string;
  claimToken: string;
}) {
  const admin: any = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('mark_apollo_match_operation_submitted_v1', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_quota_resource: input.resource,
    p_operation_id: input.operationId,
    p_claim_token: input.claimToken,
    p_target_table: input.tableName,
    p_target_id: input.target.id,
  });
  if (error) throw error;
  const outcome = text(object(data)?.outcome, 64);
  if (outcome === 'submitted') return;
  if (outcome === 'target_suppressed') throw new Error('ENRICHMENT_TARGET_SUPPRESSED');
  if (outcome === 'target_not_found') throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
  if (outcome === 'quota_claim_not_owned') throw new Error('APOLLO_QUOTA_CLAIM_NOT_OWNED');
  throw new Error('INVALID_APOLLO_MATCH_SUBMISSION_RESPONSE');
}

function canonicalTargetResponse(input: {
  row: JsonRecord;
  target: PreparedTarget;
  revealEmail: boolean;
  revealPhone: boolean;
  creditsConsumed?: number;
}) {
  const enrichmentStatus = text(input.row.enrichment_status, 64) || 'failed';
  if (enrichmentStatus === 'suppressed') {
    return {
      id: input.target.id,
      clientRef: input.target.clientRef,
      enrichmentStatus,
      creditsConsumed: input.creditsConsumed,
    };
  }

  const data = object(input.row.data) || {};
  const phoneNumbers = input.revealPhone && Array.isArray(input.row.phone_numbers)
    ? input.row.phone_numbers.slice(0, 20)
    : undefined;
  return {
    id: input.target.id,
    clientRef: input.target.clientRef,
    sourceProvider: text(input.row.source_provider, 64),
    sourceProviderId: text(input.row.source_provider_id, 255),
    fullName: text(input.row.name || input.row.full_name, 200),
    firstName: text(input.row.first_name, 100),
    lastName: text(input.row.last_name, 100),
    email: input.revealEmail ? text(input.row.email, 320) : undefined,
    emailStatus: input.revealEmail ? text(input.row.email_status, 64) : undefined,
    linkedinUrl: normalizeLinkedin(input.row.linkedin_url) || undefined,
    title: text(input.row.title, 160),
    headline: text(input.row.headline, 300),
    companyName: text(input.row.organization_name || input.row.company_name || input.row.company, 200),
    companyDomain: text(input.row.organization_domain || data.companyDomain, 253),
    industry: text(input.row.organization_industry, 160),
    companySize: input.row.organization_size == null ? undefined : String(input.row.organization_size).slice(0, 100),
    city: text(input.row.city, 160),
    state: text(input.row.state, 160),
    country: text(input.row.country, 160),
    photoUrl: text(input.row.photo_url, 1_000),
    seniority: text(input.row.seniority, 100),
    departments: Array.isArray(input.row.departments) ? input.row.departments.slice(0, 20) : undefined,
    phoneNumbers,
    primaryPhone: input.revealPhone ? text(input.row.primary_phone, 64) : undefined,
    serverPersisted: true,
    enrichmentStatus,
    creditsConsumed: input.creditsConsumed,
  };
}

function phoneEnrichmentResponse(input: {
  requested: boolean;
  enriched: Array<Record<string, unknown>>;
}) {
  if (!input.requested) {
    return {
      requested: false,
      queued: false,
      status: 'not_requested' as const,
      message: null,
      webhook_url: null,
      provider_status: null,
      provider_details: null,
    };
  }

  const hasPendingPhone = input.enriched.some((item) => (
    String(item.enrichmentStatus || '').trim().toLowerCase().startsWith('pending')
  ));
  const hasPhone = input.enriched.some((item) => (
    Boolean(text(item.primaryPhone, 64))
    || (Array.isArray(item.phoneNumbers) && item.phoneNumbers.length > 0)
  ));
  const hasFailure = input.enriched.some((item) => (
    ['failed', 'not_found', 'no_phone'].includes(String(item.enrichmentStatus || '').trim().toLowerCase())
  ));
  const status = hasPendingPhone
    ? 'queued' as const
    : hasFailure && !hasPhone
      ? 'failed' as const
      : 'skipped' as const;

  return {
    requested: true,
    queued: status === 'queued',
    status,
    message: status === 'queued'
      ? 'El telefono se esta preparando y se actualizara automaticamente.'
      : status === 'failed'
        ? 'El proveedor no pudo completar la busqueda del telefono.'
        : null,
    webhook_url: null,
    provider_status: null,
    provider_details: null,
  };
}

async function persistImmediateResult(input: {
  target: PreparedTarget;
  tableName: ApolloTargetTable;
  userId: string;
  organizationId: string;
  extracted: JsonRecord;
  revealEmail: boolean;
  revealPhone: boolean;
  pendingPhone: boolean;
  matchOnly: boolean;
  hybridScope?: HybridScope;
}) {
  const admin: any = getSupabaseAdminClient();
  const now = new Date().toISOString();
  if(input.hybridScope && input.target.hybridHint){
    const scope=input.hybridScope;
    const {data,error}=await admin.rpc('apply_hybrid_apollo_fields_v1',{p_org:scope.organizationId,p_user:scope.userId,p_resource:scope.resource,
      p_operation:scope.operationId,p_target:input.target.id,p_candidate:input.extracted,p_pending_phone:input.pendingPhone});
    if(error||!data)throw Error('HYBRID_RESULT_UNAVAILABLE');
    if(data.enrichment_status!=='suppressed'&&isUuid(text(input.target.clientRef,64)))await applyEnrichedIdentity(admin,{
      userId:scope.userId,organizationId:scope.organizationId,savedLeadId:input.target.clientRef,providerId:input.target.sourceProviderId,
      identity:identityFromProvider({full_name:data.full_name,linkedin_url:data.linkedin_url,title:data.title}),
    }).catch(()=>undefined);
    return object(data)||{};
  }
  const phoneNumbers = input.revealPhone && Array.isArray(input.extracted.phone_numbers)
    ? input.extracted.phone_numbers.slice(0, 20)
    : [];
  const primaryPhone = input.revealPhone ? text(input.extracted.primary_phone, 64) || null : null;
  const email = input.revealEmail ? text(input.extracted.email, 320) || undefined : undefined;
  const emailStatus = input.revealEmail ? text(input.extracted.email_status, 64) || undefined : undefined;
  const contactValues = {
    email,
    email_status: emailStatus,
    // Do not overwrite an existing value while Apollo is still processing.
    phone_numbers: input.revealPhone && phoneNumbers.length > 0 ? phoneNumbers : undefined,
    primary_phone: input.revealPhone ? primaryPhone || undefined : undefined,
  };
  const providerId = text(input.extracted.source_provider_id || input.extracted.apollo_id, 255) || input.target.sourceProviderId;
  const dataContext = {
    sourceProvider: 'apollo',
    sourceProviderId: providerId,
    apolloId: providerId,
    companyDomain: text(input.extracted.organization_domain, 253) || cleanDomain(input.target.lead.companyDomain) || undefined,
    organization: object(input.extracted.organization) || undefined,
    providerObservedAt: now,
  };
  const status = input.matchOnly ? 'completed'
    : input.pendingPhone ? 'pending_phone'
    : primaryPhone || phoneNumbers.length > 0 || (input.revealEmail && text(input.extracted.email, 320)) ? 'completed'
      : 'failed';

  let existingData: JsonRecord = {};
  if (input.tableName !== 'people_search_leads') {
    const { data } = await admin.from(input.tableName).select('data')
      .eq('id', input.target.id)
      .eq('user_id', input.userId)
      .eq('organization_id', input.organizationId)
      .maybeSingle();
    existingData = object(data?.data) || {};
  }

  const common = {
    title: text(input.extracted.title, 160) || undefined,
    linkedin_url: normalizeLinkedin(input.extracted.linkedin_url) || undefined,
    source_provider: 'apollo',
    source_provider_id: providerId || undefined,
    enrichment_status: status,
    updated_at: now,
  };

  const values = input.tableName === 'people_search_leads' ? {
    ...common,
    ...contactValues,
    apollo_person_id: providerId || undefined,
    name: text(input.extracted.full_name, 200) || undefined,
    first_name: text(input.extracted.first_name, 100) || undefined,
    last_name: text(input.extracted.last_name, 100) || undefined,
    organization_name: text(input.extracted.organization_name, 200) || undefined,
    organization_domain: text(input.extracted.organization_domain, 253) || undefined,
    organization_industry: text(input.extracted.organization_industry, 160) || undefined,
    organization_size: typeof input.extracted.organization_size === 'number' ? input.extracted.organization_size : undefined,
    city: text(input.extracted.city, 160) || undefined,
    state: text(input.extracted.state, 160) || undefined,
    country: text(input.extracted.country, 160) || undefined,
    headline: text(input.extracted.headline, 300) || undefined,
    photo_url: text(input.extracted.photo_url, 1_000) || undefined,
    seniority: text(input.extracted.seniority, 100) || undefined,
    departments: Array.isArray(input.extracted.departments) ? input.extracted.departments.slice(0, 20) : undefined,
  } : input.tableName === 'enriched_leads' ? {
    ...common,
    ...contactValues,
    full_name: text(input.extracted.full_name, 200) || undefined,
    company_name: text(input.extracted.organization_name, 200) || undefined,
    organization_domain: text(input.extracted.organization_domain, 253) || undefined,
    organization_industry: text(input.extracted.organization_industry, 160) || undefined,
    organization_size: typeof input.extracted.organization_size === 'number' ? input.extracted.organization_size : undefined,
    city: text(input.extracted.city, 160) || undefined,
    state: text(input.extracted.state, 160) || undefined,
    country: text(input.extracted.country, 160) || undefined,
    headline: text(input.extracted.headline, 300) || undefined,
    photo_url: text(input.extracted.photo_url, 1_000) || undefined,
    seniority: text(input.extracted.seniority, 100) || undefined,
    departments: Array.isArray(input.extracted.departments) ? input.extracted.departments.slice(0, 20) : undefined,
    data: { ...existingData, ...dataContext },
  } : {
    ...common,
    ...contactValues,
    full_name: text(input.extracted.full_name, 200) || undefined,
    company_name: text(input.extracted.organization_name, 200) || undefined,
    data: { ...existingData, ...dataContext },
  };

  const { data, error } = await admin.from(input.tableName).update(values)
    .eq('id', input.target.id)
    .eq('user_id', input.userId)
    .eq('organization_id', input.organizationId)
    .select(persistedTargetColumns(input.tableName))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('ENRICHMENT_TARGET_NOT_FOUND');
  // «Buscar correo» from «Por completar» sends the saved contact as clientRef: it gets the real name, LinkedIn and
  // title too (only its gaps), so it stops showing a hidden surname. Best effort: the result above already stands.
  const savedLeadId = text(input.target.clientRef, 64);
  if (input.tableName === 'enriched_leads' && isUuid(savedLeadId)) {
    await applyEnrichedIdentity(admin, {
      userId: input.userId, organizationId: input.organizationId, savedLeadId, providerId: providerId || null,
      identity: identityFromProvider(input.extracted),
    }).catch(() => undefined);
  }
  return object(data) || {};
}

async function audit(input: {
  eventType: string;
  operationId: string;
  organizationId: string;
  userId: string;
  trustedInternal: boolean;
  leadCount: number;
  status: string;
  outcome: string;
  resource: QuotaResource;
  severity?: 'info' | 'warning' | 'error';
  providers?: {apolloLookups:number;cacheContacts:number};
}) {
  await safeAppendAntoniaEvent({
    eventType: input.eventType,
    organizationId: input.organizationId,
    actorId: input.userId,
    actorType: input.trustedInternal ? 'agent' : 'user',
    entityType: 'enrichment_operation',
    entityId: input.operationId,
    sourceSystem: 'apollo',
    sourceRoute: '/api/opportunities/enrich-apollo',
    provider: input.providers?.cacheContacts ? 'hybrid' : 'apollo',
    requestId: input.operationId,
    correlationId: input.operationId,
    operationId: input.operationId,
    idempotencyKey: input.operationId,
    status: input.status,
    outcome: input.outcome,
    severity: input.severity || 'info',
    metrics: { leadCount: input.leadCount, quotaResource: input.resource, ...input.providers },
  });
}

export async function POST(request: NextRequest) {
  let trustedInternal = false;
  let userId = '';
  let userEmail: string | null = null;
  let organizationId = '';
  let resource: QuotaResource = 'enrich';
  let tableName: ApolloTargetTable = 'enriched_opportunities';
  let claim: EnrichmentQuotaOperationClaim | null = null;
  let providerBoundaryCrossed = false;
  const callbacks: CallbackHandle[] = [];
  const submittedCallbacks = new Set<string>();
  let targets: PreparedTarget[] = [];
  let requestedRevealPhone = false;
  let requestedRevealEmail = false;
  let busyTargetId: string | null = null;
  let hybridScope: HybridScope | undefined;
  let hybridCacheStarted = false;
  let apolloLookups = 0;
  let cacheContacts = 0;

  try {
    try {
      const auth = await requireSessionOrTrustedInternalRequest(request);
      trustedInternal = auth.source === 'internal';
      userId = auth.user.id;
      userEmail = auth.user.email || null;
      organizationId = auth.organizationId || '';
    } catch (error) {
      const response = requestAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }

    let body: EnrichInput;
    try {
      body = await request.json() as EnrichInput;
    } catch {
      return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
    }
    if (body.resource != null) return NextResponse.json({ error: 'QUOTA_RESOURCE_NOT_CLIENT_CONFIGURABLE' }, { status: 400 });

    const revealEmail = parseFlag(body.revealEmail, true);
    const revealPhone = parseFlag(body.revealPhone, false);
    if (!revealEmail.ok || !revealPhone.ok) return NextResponse.json({ error: 'INVALID_REVEAL_FLAGS' }, { status: 400 });
    requestedRevealPhone = revealPhone.value;
    requestedRevealEmail = revealEmail.value;
    const mode = resolveMode(body.mode, trustedInternal, revealPhone.value);
    if (!mode.ok) return NextResponse.json({ error: mode.error }, { status: 400 });
    resource = quotaResource(mode.mode);

    const resolvedTable = body.tableName == null ? 'enriched_opportunities' : resolveTableName(body.tableName);
    if (!resolvedTable) return NextResponse.json({ error: 'INVALID_ENRICHMENT_TARGET' }, { status: 400 });
    tableName = resolvedTable;
    const leads = Array.isArray(body.leads) ? body.leads : [];
    if (leads.length === 0 || leads.length > MAX_ENRICHMENT_CONTACTS) {
      return NextResponse.json({ error: 'INVALID_ENRICHMENT_CONTACT_COUNT' }, { status: 400 });
    }
    if (leads.some(lead => lead && (lead.sourceProvider === 'leads_finder' || lead.source_provider === 'leads_finder'
      || sourceProviderId(lead).startsWith('lf_') || text(lead.id, 255).startsWith('lf_')))) {
      return NextResponse.json({ error: 'ENRICHMENT_PROVIDER_MISMATCH', message: 'Este contacto debe completarse con los datos de su proveedor original.' }, { status: 409 });
    }
    const matchOnly = !revealEmail.value
      && !revealPhone.value
      && tableName === 'people_search_leads'
      && leads.length === 1
      && Boolean(normalizeLinkedin(leads[0]?.linkedinUrl));
    if (!revealEmail.value && !revealPhone.value && !matchOnly) {
      return NextResponse.json({ error: 'ENRICHMENT_FIELDS_REQUIRED' }, { status: 400 });
    }
    if (leads.some((lead) => !lead || !validLeadIdentity(lead))) {
      return NextResponse.json({ error: 'APOLLO_CONTACT_IDENTITY_REQUIRED' }, { status: 400 });
    }
    const operation = resolveOperationId(request, body);
    if (!operation.ok) return NextResponse.json({ error: operation.error }, { status: 400 });

    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_REQUIRED' }, { status: 403 });
    await assertLeadEmailsNotSuppressed({ leads, userId, organizationId });
    const providerDecision = resolveLeadProvider({ organizationId });
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
    if (existing) return await operationStateResponse(existing, { userId, organizationId, resource, tableName,
      requested:{email:revealEmail.value,phone:revealPhone.value},leads });

    const hasCreditAccess = trustedInternal
      ? await hasUserEnrichmentSearchCreditAccess(userId)
      : hasEnrichmentSearchCreditAccess(userEmail);
    if (!hasCreditAccess) {
      return NextResponse.json(enrichmentSearchCreditsUnavailablePayload(), { status: 429 });
    }

    const frozen=tableName==='enriched_leads'&&!trustedInternal&&hybridEnabled()
      ? await frozenHybridItems({organizationId,userId,resource,operationId:operation.operationId}) : [];
    const hints: Array<HybridHint|null> = tableName==='enriched_leads'&&!trustedInternal&&hybridEnabled()
      ? await Promise.all(leads.map(lead=>findHybridHint({organizationId,userId},lead).catch(error=>{
        if(error instanceof Error&&['APOLLO_PERSON_IDENTITY_MISMATCH','ENRICHMENT_TARGET_SUPPRESSED','HYBRID_PRIVACY_UNAVAILABLE'].includes(error.message))throw error;
        return null;
      }))) : leads.map(()=>null);
    for(const [index,lead] of leads.entries()){
      const prior=frozen.find(item=>item.clientRef===lead.clientRef||item.targetId===lead.existingRecordId);
      if(prior)hints[index]=prior.hint;
    }
    const hasHybrid=hints.some(hint=>Boolean(hint && (revealEmail.value&&hint.contact.email||revealPhone.value&&hint.contact.mobile)));
    let setupFailure: string | undefined;
    try { assertApolloEnrichmentConfigured(); }
    catch(error){if(!hasHybrid)throw error;setupFailure='APOLLO_PROVIDER_NOT_CONFIGURED';}

    const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
    claim = await claimEnrichmentQuotaOperation({
      userId,
      organizationId,
      resource,
      operationId: operation.operationId,
      requestFingerprint: fingerprint,
      limit: resource === 'investigate' ? limits.research : limits.enrich,
      count: leads.length,
    });
    if (!claim.claimed || !claim.allowed || !claim.claimToken) {
      return await operationStateResponse(claim, { userId, organizationId, resource, tableName,
        requested:{email:revealEmail.value,phone:revealPhone.value},leads });
    }

    await audit({
      eventType: 'enrichment.requested',
      operationId: operation.operationId,
      organizationId,
      userId,
      trustedInternal,
      leadCount: leads.length,
      status: 'claimed',
      outcome: 'accepted',
      resource,
    });

    targets = await prepareTargets({
      leads:leads.map(lead=>{
        const prior=frozen.find(item=>item.clientRef===lead.clientRef||item.targetId===lead.existingRecordId);
        return prior?{...lead,existingRecordId:prior.targetId}:lead;
      }),
      tableName,
      userId,
      organizationId,
      revealPhone: revealPhone.value,
    });

    if(hasHybrid){
      hybridScope={userId,organizationId,resource,operationId:operation.operationId,claimToken:claim.claimToken};
      for(const [index,target] of targets.entries()){
        const hint=hints[index];if(!hint||!(revealEmail.value&&hint.contact.email||revealPhone.value&&hint.contact.mobile))continue;
        target.hybridHint=hint;
        await registerHybridItem(hybridScope,target,hint,{email:revealEmail.value,phone:revealPhone.value});
        const row=await loadPersistedTarget({tableName,targetId:target.id,userId,organizationId});
        target.fieldPlan=hybridFieldPlan({email:revealEmail.value,phone:revealPhone.value},row,hint);
      }
    }

    if (!matchOnly) {
      for (const target of targets) {
        const fields=target.fieldPlan||{apolloEmail:revealEmail.value,apolloPhone:revealPhone.value};
        if(!fields.apolloEmail&&!fields.apolloPhone||setupFailure)continue;
        try {
          const callback = await createApolloEnrichmentCallback({
            operationId: operation.operationId,
            claimToken: claim.claimToken,
            userId,
            organizationId,
            quotaResource: resource,
            targetTable: tableName,
            targetId: target.id,
            apolloPersonId: target.sourceProviderId,
            requestedFields: requestedFields(fields.apolloEmail, fields.apolloPhone),
          });
          callbacks.push({ ...callback, targetId: target.id });
        } catch (error) {
          if (String((error as { message?: string } | null)?.message || '') === 'APOLLO_ENRICHMENT_TARGET_BUSY') {
            busyTargetId = target.id;
          }
          throw error;
        }
      }
    }

    const mutationIdentity = {
      userId,
      organizationId,
      resource,
      operationId: operation.operationId,
      claimToken: claim.claimToken,
    };
    const enriched: Array<Record<string, unknown>> = [];

    if(hybridScope){
      // Durable submission before committing cached contacts also prevents a
      // stale HTTP retry reacquiring and billing the same operation.
      await markEnrichmentQuotaOperationSubmitted(mutationIdentity);
      hybridCacheStarted=true;
      for(const target of targets)if(target.hybridHint){
        if(await applyHybridCache(hybridScope,target.id,target.hybridHint))cacheContacts++;
      }
    }

    for (const target of targets) {
      const callback = callbacks.find((item) => item.targetId === target.id);
      const fields=target.fieldPlan||{apolloEmail:revealEmail.value,apolloPhone:revealPhone.value,verifyEmail:false};
      if(target.hybridHint && (!fields.apolloEmail&&!fields.apolloPhone||setupFailure)){
        const persisted=await loadPersistedTarget({tableName,targetId:target.id,userId,organizationId});
        enriched.push(canonicalTargetResponse({row:persisted,target,revealEmail:revealEmail.value,revealPhone:revealPhone.value}));
        continue;
      }
      if(setupFailure){await markTargetsFailed({targets:[target],tableName,userId,organizationId});
        enriched.push({id:target.id,clientRef:target.clientRef,enrichmentStatus:'failed',errorCode:setupFailure});continue;}
      if (callback) {
        await markApolloEnrichmentCallbackSubmitted(callback);
        submittedCallbacks.add(callback.callbackId);
        providerBoundaryCrossed = true;
      } else if (!providerBoundaryCrossed && !hybridCacheStarted) {
        if (matchOnly) {
          await markApolloMatchOnlySubmitted({
            target,
            tableName,
            userId,
            organizationId,
            resource,
            operationId: operation.operationId,
            claimToken: claim.claimToken,
          });
        } else {
          await markEnrichmentQuotaOperationSubmitted(mutationIdentity);
        }
        providerBoundaryCrossed = true;
      }

      try {
        const name = splitFullName(target.lead.fullName);
        apolloLookups++;
        const result = await submitApolloEnrichment({
          lead: {
            id: target.sourceProviderId,
            sourceProviderId: target.sourceProviderId,
            firstName: name.firstName || undefined,
            lastName: name.lastName || undefined,
            fullName: name.fullName || undefined,
            linkedinUrl: normalizeLinkedin(target.lead.linkedinUrl) || undefined,
            organizationName: text(target.lead.companyName, 200) || undefined,
            organizationDomain: cleanDomain(target.lead.companyDomain) || undefined,
          },
          // A cached email is observed on the phone fallback, but it is not a
          // writable callback field and is only verified on address equality.
          revealEmail: fields.apolloEmail || fields.verifyEmail,
          revealPhone: fields.apolloPhone,
          webhookUrl: fields.apolloPhone ? callback?.webhookUrl : undefined,
          matchOnly,
        });

        const resultPersonId = text(
          result.extractedData?.source_provider_id || result.extractedData?.apollo_id,
          255,
        );
        if (target.sourceProviderId && resultPersonId && target.sourceProviderId !== resultPersonId) {
          throw new ApolloEnrichmentError(502, 'APOLLO_PERSON_IDENTITY_MISMATCH', false);
        }
        if (target.boundPersonId && resultPersonId && target.boundPersonId !== resultPersonId) {
          throw new ApolloEnrichmentError(502, 'APOLLO_PERSON_IDENTITY_MISMATCH', false);
        }

        if (callback && result.providerRequestId) {
          const bindOutcome = await bindApolloEnrichmentCallback({
            callbackId: callback.callbackId,
            providerRequestId: result.providerRequestId,
            apolloPersonId: resultPersonId || target.sourceProviderId,
          });
          if (bindOutcome !== 'bound') {
            throw new Error(`APOLLO_CALLBACK_${bindOutcome.toUpperCase()}`);
          }
        }

        if (result.success && result.extractedData) {
          const hasImmediatePhone = fields.apolloPhone && (
            text(result.extractedData.primary_phone, 64)
            || (Array.isArray(result.extractedData.phone_numbers) && result.extractedData.phone_numbers.length > 0)
          );
          const pendingPhone = fields.apolloPhone && !hasImmediatePhone && Boolean(result.providerRequestId);
          let persisted = await persistImmediateResult({
            target,
            tableName,
            userId,
            organizationId,
            extracted: result.extractedData,
            revealEmail: fields.apolloEmail,
            revealPhone: fields.apolloPhone,
            pendingPhone,
            matchOnly,
            hybridScope,
          });

          if (callback && (!fields.apolloPhone || hasImmediatePhone)) {
            const providerRequestId = result.providerRequestId || `sync:${callback.callbackId}`;
            await applyApolloEnrichmentCandidate({
              tokenHash: callback.tokenHash,
              providerRequestId,
              providerStatus: 'SUCCEEDED',
              payloadHash: createHash('sha256').update(JSON.stringify(result.extractedData)).digest('hex'),
              candidate: {
                apollo_person_id: resultPersonId || target.sourceProviderId,
                email: fields.apolloEmail ? text(result.extractedData.email, 320) || undefined : undefined,
                email_status: fields.apolloEmail ? text(result.extractedData.email_status, 64) || undefined : undefined,
                phone_numbers: Array.isArray(result.extractedData.phone_numbers)
                  ? result.extractedData.phone_numbers.slice(0, 20) as any
                  : undefined,
                primary_phone: text(result.extractedData.primary_phone, 64),
              },
            });
          } else if (callback && !pendingPhone) {
            await settleApolloEnrichmentCallback({
              callbackId: callback.callbackId,
              terminalState: 'no_data',
              errorCode: 'apollo_no_phone_data',
            });
          }
          if (callback) {
            persisted = await loadPersistedTarget({
              tableName,
              targetId: target.id,
              userId,
              organizationId,
            });
          }
          enriched.push(canonicalTargetResponse({
            row: persisted,
            target,
            revealEmail: revealEmail.value,
            revealPhone: revealPhone.value,
            creditsConsumed: result.creditsConsumed,
          }));
          if(tableName==='enriched_leads'&&!trustedInternal&&persisted.enrichment_status!=='suppressed'){
            await observeConfirmedApolloIdentity({organizationId,userId},{id:resultPersonId||target.sourceProviderId||'',
              domain:cleanDomain(result.extractedData.organization_domain)||cleanDomain(target.lead.companyDomain),
              fullName:text(result.extractedData.full_name,200),linkedinUrl:normalizeLinkedin(result.extractedData.linkedin_url),title:text(result.extractedData.title,160),
            }).catch(()=>undefined);
          }
        } else {
          if (callback) {
            await settleApolloEnrichmentCallback({
              callbackId: callback.callbackId,
              terminalState: 'no_data',
              errorCode: 'apollo_person_not_found',
            });
          } else {
            await markTargetsFailed({ targets: [target], tableName, userId, organizationId });
          }
          const persisted = await loadPersistedTarget({
            tableName,
            targetId: target.id,
            userId,
            organizationId,
          });
          enriched.push(canonicalTargetResponse({
            row: persisted,
            target,
            revealEmail: Boolean(target.hybridHint)&&revealEmail.value,
            revealPhone: Boolean(target.hybridHint)&&revealPhone.value,
          }));
        }
      } catch (error) {
        if (
          (error instanceof ApolloEnrichmentError && error.providerOutcomeUnknown)
          || (!(error instanceof ApolloEnrichmentError) && providerBoundaryCrossed)
        ) {
          // Cache-only targets do not have a callback, so target indices are
          // not callback indices in a hybrid batch. Cancel all unsubmitted work.
          for (const pending of callbacks) {
            if (!submittedCallbacks.has(pending.callbackId)) {
              await settleApolloEnrichmentCallback({
                callbackId: pending.callbackId,
                terminalState: 'cancelled',
                errorCode: 'not_submitted_after_unknown_outcome',
              }).catch(() => undefined);
            }
          }
          await audit({
            eventType: 'enrichment.failed',
            operationId: operation.operationId,
            organizationId,
            userId,
            trustedInternal,
            leadCount: leads.length,
            status: 'submitted',
            outcome: 'provider_outcome_unknown',
            resource,
            severity: 'error',
          });
          const response = NextResponse.json({
            error: 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN',
            operationId: operation.operationId,
            operationStatus: 'submitted',
            providerState: 'unknown',
            queued: true,
            enriched: await Promise.all(targets.map(async item=>canonicalTargetResponse({
              row:await loadPersistedTarget({tableName,targetId:item.id,userId,organizationId}),target:item,
              revealEmail:revealEmail.value,revealPhone:revealPhone.value,
            }))),
            usage: usage(claim),
          }, { status: 409 });
          response.headers.set('x-operation-id', operation.operationId);
          return response;
        }

        if (callback) {
          await settleApolloEnrichmentCallback({
            callbackId: callback.callbackId,
            terminalState: 'failed',
            errorCode: error instanceof ApolloEnrichmentError ? error.code : 'apollo_enrichment_failed',
          }).catch(() => undefined);
        } else {
          await markTargetsFailed({ targets: [target], tableName, userId, organizationId }).catch(() => undefined);
        }
        const partial=target.hybridHint?canonicalTargetResponse({row:await loadPersistedTarget({tableName,targetId:target.id,userId,organizationId}),
          target,revealEmail:revealEmail.value,revealPhone:revealPhone.value}):{};
        enriched.push({
          id: target.id,
          clientRef: target.clientRef,
          sourceProvider: 'apollo',
          sourceProviderId: target.sourceProviderId,
          enrichmentStatus: 'failed',
          errorCode: error instanceof ApolloEnrichmentError ? error.code : 'APOLLO_ENRICHMENT_FAILED',
          ...partial,
        });
      }
    }

    const actuallyPending = hybridScope ? enriched.some(item=>String(item.enrichmentStatus||'').startsWith('pending')) : revealPhone.value;
    if(hybridScope)await settleHybrid(hybridScope);
    if(hybridScope){const current=await getEnrichmentQuotaOperation({userId,organizationId,resource,operationId:operation.operationId,requestFingerprint:fingerprint});
      if(current)claim={...claim,consumed:current.consumed,count:current.count,limit:current.limit};}
    const responsePayload = {
      queued: actuallyPending,
      operationId: operation.operationId,
      operationStatus: actuallyPending ? 'submitted' : 'completed',
      providerRequested: providerDecision.requestedProvider,
      providerUsed: 'apollo',
      providerDefault: providerDecision.defaultProvider,
      providerForcedReason: providerDecision.forcedProviderReason,
      requestedData: { email: revealEmail.value, phone: revealPhone.value },
      usage: usage(claim),
      enriched,
      phone_enrichment: phoneEnrichmentResponse({
        requested: revealPhone.value,
        enriched,
      }),
    };

    if (!hybridScope && !revealPhone.value && callbacks.length === 0) {
      const replayPayload = {
        ...responsePayload,
        enriched: enriched.map((item) => ({
          id: item.id,
          enrichmentStatus: item.enrichmentStatus,
        })),
      };
      await completeEnrichmentQuotaOperation({
        ...mutationIdentity,
        status: 'completed',
        responseStatus: 200,
        responsePayload: replayPayload,
      });
    }
    await audit({
      eventType: revealPhone.value ? 'enrichment.queued' : 'enrichment.completed',
      operationId: operation.operationId,
      organizationId,
      userId,
      trustedInternal,
      leadCount: leads.length,
      status: revealPhone.value ? 'submitted' : 'completed',
      outcome: revealPhone.value ? 'provider_accepted' : 'provider_completed',
      resource,
      providers:{apolloLookups,cacheContacts},
    });

    const response = NextResponse.json(responsePayload, { status: actuallyPending ? 202 : 200 });
    response.headers.set('x-operation-id', operation.operationId);
    response.headers.set('x-provider-used', 'apollo');
    if (actuallyPending) response.headers.set('retry-after', '5');
    return response;
  } catch (error) {
    const code = String((error as { message?: string } | null)?.message || 'ENRICHMENT_REQUEST_FAILED');
    const targetBusy = code === 'APOLLO_ENRICHMENT_TARGET_BUSY';
    if(hybridScope&&hybridCacheStarted&&!providerBoundaryCrossed){
      await cancelHybridItems(hybridScope).catch(()=>undefined);
      for(const callback of callbacks)await settleApolloEnrichmentCallback({callbackId:callback.callbackId,terminalState:'cancelled',errorCode:'pre_provider_failure'}).catch(()=>undefined);
      await settleHybrid(hybridScope).catch(()=>undefined);
      const partial=await Promise.all(targets.map(async target=>canonicalTargetResponse({
        row:await loadPersistedTarget({tableName,targetId:target.id,userId,organizationId}),target,
        revealEmail:requestedRevealEmail,revealPhone:requestedRevealPhone,
      })));
      return NextResponse.json({operationId:claim?.operationId,operationStatus:'completed',enriched:partial,usage:claim?usage(claim):undefined},{status:200});
    }
    if (!providerBoundaryCrossed && claim?.claimToken && organizationId) {
      const targetsToFail = targetBusy && busyTargetId
        ? targets.filter((target) => target.id !== busyTargetId)
        : targets;
      await markTargetsFailed({ targets: targetsToFail, tableName, userId, organizationId }).catch(() => undefined);
      for (const callback of callbacks) {
        await settleApolloEnrichmentCallback({
          callbackId: callback.callbackId,
          terminalState: 'cancelled',
          errorCode: 'pre_provider_failure',
        }).catch(() => undefined);
      }
      await releaseEnrichmentQuotaOperation({
        userId,
        organizationId,
        resource,
        operationId: claim.operationId,
        claimToken: claim.claimToken,
      }).catch(() => undefined);
    }

    if (targetBusy && busyTargetId) {
      const pendingTargets = targets
        .filter((target) => target.id === busyTargetId)
        .map((target) => ({
          id: target.id,
          clientRef: target.clientRef,
          enrichmentStatus: requestedRevealPhone ? 'pending_phone' : 'pending',
        }));
      const response = NextResponse.json({
        error: code,
        operationId: claim?.operationId,
        operationStatus: 'submitted',
        providerState: 'processing',
        queued: requestedRevealPhone,
        enriched: pendingTargets,
        phone_enrichment: phoneEnrichmentResponse({
          requested: requestedRevealPhone,
          enriched: pendingTargets,
        }),
      }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
      if (claim?.operationId) response.headers.set('x-operation-id', claim.operationId);
      response.headers.set('retry-after', '5');
      return response;
    }

    const exposed = new Set([
      'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
      'ENRICHMENT_TARGET_NOT_FOUND',
      'INVALID_EXISTING_RECORD_ID',
      'DUPLICATE_ENRICHMENT_TARGET',
      'APOLLO_WEBHOOK_URL_NOT_CONFIGURED',
      'APOLLO_CALLBACK_REPLAY_REQUIRES_OPERATION_RESPONSE',
      'APOLLO_ENRICHMENT_TARGET_BUSY',
      'ENRICHMENT_TARGET_SUPPRESSED',
      'ENRICHMENT_PROVIDER_MISMATCH',
      'APOLLO_PROVIDER_NOT_CONFIGURED',
    ]);
    const errorCode = exposed.has(code) ? code : providerBoundaryCrossed
      ? 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN'
      : 'ENRICHMENT_REQUEST_FAILED';
    if (errorCode === 'ENRICHMENT_REQUEST_FAILED') {
      console.error('[apollo] pre-provider enrichment setup failed', { code: 'ENRICHMENT_REQUEST_FAILED' });
    }
    const status = errorCode === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'
      || errorCode === 'DUPLICATE_ENRICHMENT_TARGET'
      || errorCode === 'APOLLO_ENRICHMENT_TARGET_BUSY'
      || errorCode === 'ENRICHMENT_TARGET_SUPPRESSED'
      || errorCode === 'ENRICHMENT_PROVIDER_MISMATCH'
      || errorCode === 'APOLLO_CALLBACK_REPLAY_REQUIRES_OPERATION_RESPONSE' ? 409
      : errorCode === 'ENRICHMENT_TARGET_NOT_FOUND' || errorCode === 'INVALID_EXISTING_RECORD_ID' ? 400
        : errorCode === 'APOLLO_WEBHOOK_URL_NOT_CONFIGURED' || errorCode === 'APOLLO_PROVIDER_NOT_CONFIGURED' ? 503
          : providerBoundaryCrossed ? 409 : 500;
    return NextResponse.json({
      error: errorCode,
      ...(claim?.operationId ? { operationId: claim.operationId } : {}),
      ...(providerBoundaryCrossed ? { operationStatus: 'submitted', providerState: 'unknown' } : {}),
    }, { status });
  }
}

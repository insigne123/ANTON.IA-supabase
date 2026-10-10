import { createHash, randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

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
import { enrichmentSearchCreditsUnavailablePayload, hasEnrichmentSearchCreditAccess } from '@/lib/server/enrichment-search-access';
import { applyEnrichedIdentity, identityFromProvider } from '@/lib/server/lead-identity';
import { hasLeadsFinderUserAccess } from '@/lib/server/leads-finder/access';
import { LEADS_FINDER_PROVIDER } from '@/lib/server/leads-finder/client';
import { enrichedLeadRow, revealedIdentity, revealedLead } from '@/lib/server/leads-finder/reveal';
import { forgetInVault, isLeadsFinderId, LeadsFinderVaultError, readFromVault } from '@/lib/server/leads-finder/vault';
import { requestAuthErrorResponse, requireSessionOrTrustedInternalRequest } from '@/lib/server/request-auth';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * «Enriquecer» a person found with Leads Finder (Plan 11, PR 6c): the contact comes out of the vault, with no other call to
 * Apify, and is charged like an Apollo enrichment (the same daily quota and credits: «enrich», or «investigate» with the
 * phone). The person lands in enriched_leads exactly as an Apollo enrichment leaves it, with leads_finder as provider,
 * and the vault forgets them. A result older than 30 days is no longer there: it is reported, not charged.
 * Idempotent by Idempotency-Key, like the Apollo route: a retry replays the answer instead of charging twice.
 */
const MAX_CONTACTS = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Resource = 'enrich' | 'investigate';
type RequestedLead = { sourceProviderId?: unknown; clientRef?: unknown; existingRecordId?: unknown };

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };
const json = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...noStore, ...headers } });
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const usage = (claim: EnrichmentQuotaOperationClaim) => ({ consumed: claim.consumed, count: claim.count, limit: claim.limit, reused: claim.reused });

function operationIdOf(request: NextRequest, body: Record<string, unknown>) {
  const candidates = [request.headers.get('idempotency-key'), request.headers.get('x-idempotency-key'), body.idempotencyKey]
    .map(value => text(value, 200)).filter(Boolean);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

/** A replayed or still-running operation answers what it answered the first time, never charging again. */
function replay(claim: EnrichmentQuotaOperationClaim) {
  if (claim.responsePayload && claim.responseStatus) {
    return json({ ...claim.responsePayload, operationId: claim.operationId, operationStatus: claim.status, usage: usage(claim) },
      claim.responseStatus, { 'x-idempotent-replay': 'true', 'x-operation-id': claim.operationId });
  }
  if (!claim.allowed) return json({ error: 'DAILY_ENRICH_QUOTA_EXCEEDED', operationId: claim.operationId, usage: usage(claim) }, 429);
  return json({ error: 'ENRICHMENT_OPERATION_PROCESSING', operationId: claim.operationId, operationStatus: claim.status, usage: usage(claim) }, 202,
    { 'retry-after': '3', 'x-operation-id': claim.operationId });
}

export async function POST(request: NextRequest) {
  let auth: Awaited<ReturnType<typeof requireSessionOrTrustedInternalRequest>>;
  try {
    auth = await requireSessionOrTrustedInternalRequest(request);
  } catch (error) {
    const response = requestAuthErrorResponse(error);
    if (response) return response;
    throw error;
  }
  if (auth.source !== 'session' || !hasLeadsFinderUserAccess(auth.user)) return json({ error: 'NOT_FOUND' }, 404);
  const userId = auth.user.id;
  const userEmail = auth.user.email || null;
  const organizationId = auth.organizationId;
  if (!organizationId) return json({ error: 'ORGANIZATION_REQUIRED' }, 403);

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }
  const revealEmail = flag(body.revealEmail, true);
  const revealPhone = flag(body.revealPhone, false);
  if (!revealEmail && !revealPhone) return json({ error: 'ENRICHMENT_FIELDS_REQUIRED' }, 400);
  const requested = (Array.isArray(body.leads) ? body.leads : []) as RequestedLead[];
  if (requested.length === 0 || requested.length > MAX_CONTACTS) return json({ error: 'INVALID_ENRICHMENT_CONTACT_COUNT' }, 400);
  if (requested.some(lead => lead?.existingRecordId !== undefined && !UUID_RE.test(text(lead.existingRecordId, 64)))) return json({ error: 'INVALID_ENRICHMENT_TARGET' }, 400);
  const leads = requested.map(lead => ({ id: text(lead?.sourceProviderId, 40), clientRef: text(lead?.clientRef, 64) || undefined,
    existingRecordId: text(lead?.existingRecordId, 64) || undefined }));
  if (leads.some(lead => !isLeadsFinderId(lead.id))) return json({ error: 'LEADS_FINDER_ID_REQUIRED' }, 400);
  if (leads.some(lead => lead.existingRecordId && (!UUID_RE.test(lead.existingRecordId) || lead.clientRef !== lead.existingRecordId))) return json({ error: 'INVALID_ENRICHMENT_TARGET' }, 400);
  if (new Set(leads.map(lead => lead.id)).size !== leads.length) return json({ error: 'DUPLICATE_ENRICHMENT_TARGET' }, 409);
  const operationId = operationIdOf(request, body);
  if (!operationId) return json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);

  const resource: Resource = revealPhone ? 'investigate' : 'enrich';
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: 1, provider: LEADS_FINDER_PROVIDER, revealEmail, revealPhone, leads })).digest('hex');
  const identity = { userId, organizationId, resource, operationId };

  try {
    const existing = await getEnrichmentQuotaOperation({ ...identity, requestFingerprint: fingerprint });
    if (existing) return replay(existing);
  } catch (error) {
    if (String((error as Error)?.message) === 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST') return json({ error: 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST' }, 409);
    throw error;
  }
  if (!hasEnrichmentSearchCreditAccess(userEmail)) return json(enrichmentSearchCreditsUnavailablePayload(), 429);

  const admin = getSupabaseAdminClient() as any;
  const existingRows = new Map<string, Record<string, any>>();
  for (const lead of leads) if (lead.existingRecordId) {
    const result = await admin.from('enriched_leads').select('*').eq('id', lead.existingRecordId)
      .eq('user_id', userId).eq('organization_id', organizationId).eq('source_provider', LEADS_FINDER_PROVIDER).eq('source_provider_id', lead.id).maybeSingle();
    if (result.error) return json({ error: 'ENRICHMENT_TARGET_UNAVAILABLE' }, 503);
    if (!result.data || result.data.enrichment_status === 'suppressed') return json({ error: 'ENRICHMENT_TARGET_UNAVAILABLE' }, 403);
    existingRows.set(lead.id, result.data);
  }
  let vault: Awaited<ReturnType<typeof readFromVault>>;
  try {
    vault = await readFromVault(admin, { organizationId, ids: leads.map(lead => lead.id) });
  } catch (error) {
    if (error instanceof LeadsFinderVaultError) return json({ error: error.code }, 503);
    throw error;
  }
  const expired = leads.filter(lead => !vault.has(lead.id));
  const ready = leads.filter(lead => vault.has(lead.id));
  if (ready.length === 0) {
    return json({
      error: 'LEADS_FINDER_RESULTS_EXPIRED',
      message: 'Estos resultados ya no están guardados (duran 30 días). Vuelve a buscarlos para enriquecerlos.',
      expired: expired.map(lead => ({ sourceProviderId: lead.id, clientRef: lead.clientRef })),
    }, 410);
  }

  // Charged like Apollo: one per person revealed, from the same daily allowance.
  const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
  const claim = await claimEnrichmentQuotaOperation({
    ...identity, requestFingerprint: fingerprint, limit: resource === 'investigate' ? limits.research : limits.enrich, count: ready.length,
  });
  if (!claim.claimed || !claim.allowed || !claim.claimToken) return replay(claim);
  const mutation = { ...identity, claimToken: claim.claimToken };
  let submitted = false;

  try {
    await markEnrichmentQuotaOperationSubmitted(mutation);
    submitted = true;
    const now = new Date().toISOString();
    const enriched: Array<Record<string, unknown>> = [];
    const revealed: string[] = [];
    for (const lead of ready) {
      const existingRow = existingRows.get(lead.id);
      const row = enrichedLeadRow(vault.get(lead.id)!, { id: existingRow?.id || randomUUID(), userId, organizationId, revealEmail, revealPhone, now });
      // Privacy/suppression triggers can scrub an insertion. Only persisted
      // bytes may leave the server or update the saved contact's identity.
      // Updating a previously revealed contact keeps its identity and fields that
      // were not requested. Never create a second row for a phone-only reveal.
      const update = {
        ...(revealEmail && row.email ? { email: row.email, email_status: row.email_status } : {}),
        ...(revealPhone && row.primary_phone ? { primary_phone: row.primary_phone, phone_numbers: row.phone_numbers } : {}),
        enrichment_status: row.email || row.primary_phone || existingRow?.email || existingRow?.primary_phone ? 'completed' : 'failed',
        updated_at: now,
      };
      const mutationQuery = existingRow ? admin.from('enriched_leads').update(update).eq('id', existingRow.id)
        .eq('user_id', userId).eq('organization_id', organizationId).eq('source_provider', LEADS_FINDER_PROVIDER).eq('source_provider_id', lead.id)
        : admin.from('enriched_leads').insert(row);
      const { error,data:persisted } = await mutationQuery.select('*').maybeSingle();
      if (error||!persisted) {
        enriched.push({ clientRef: lead.clientRef, sourceProvider: LEADS_FINDER_PROVIDER, sourceProviderId: lead.id, enrichmentStatus: 'failed', errorCode: 'LEADS_FINDER_PERSIST_FAILED' });
        continue;
      }
      const entry=vault.get(lead.id)!;
      if(persisted.enrichment_status==='suppressed'||(revealEmail||!entry.contact.email)&&(revealPhone||!entry.contact.mobileNumber))revealed.push(lead.id);
      enriched.push(revealedLead(persisted, { clientRef: lead.clientRef, revealEmail, revealPhone }));
      // The saved contact gets its real name, LinkedIn and title (only its gaps), as after an Apollo enrichment.
      if (!existingRow && persisted.enrichment_status!=='suppressed'&&lead.clientRef && UUID_RE.test(lead.clientRef)) {
        await applyEnrichedIdentity(admin, {
          userId, organizationId, savedLeadId: lead.clientRef, providerId: lead.id, identity: identityFromProvider(revealedIdentity(persisted)),
        }).catch(() => undefined);
      }
    }
    for (const lead of expired) {
      enriched.push({ clientRef: lead.clientRef, sourceProvider: LEADS_FINDER_PROVIDER, sourceProviderId: lead.id, enrichmentStatus: 'expired', errorCode: 'LEADS_FINDER_RESULT_EXPIRED' });
    }
    await forgetInVault(admin, { organizationId, ids: revealed });

    const payload = {
      operationId,
      operationStatus: 'completed',
      providerUsed: LEADS_FINDER_PROVIDER,
      requestedData: { email: revealEmail, phone: revealPhone },
      expired: expired.map(lead => ({ sourceProviderId: lead.id, clientRef: lead.clientRef })),
      usage: usage(claim),
      enriched,
    };
    // A replay gets the outcome, not the contacts again: those already live in the enriched lead.
    await completeEnrichmentQuotaOperation({
      ...mutation, status: 'completed', responseStatus: 200,
      responsePayload: { ...payload, enriched: enriched.map(item => ({ id: item.id, clientRef: item.clientRef, enrichmentStatus: item.enrichmentStatus })) },
    });
    await safeAppendAntoniaEvent({
      eventType: 'enrichment.completed', organizationId, actorId: userId, actorType: 'user', entityType: 'enrichment_operation',
      entityId: operationId, sourceRoute: '/api/leads/leads-finder/enrich', provider: LEADS_FINDER_PROVIDER, operationId,
      idempotencyKey: operationId, status: 'completed', outcome: 'provider_completed',
      metrics: { leadCount: leads.length, revealed: revealed.length, expired: expired.length, quotaResource: resource },
    });
    return json(payload, 200, { 'x-operation-id': operationId, 'x-provider-used': LEADS_FINDER_PROVIDER });
  } catch (error) {
    // Before anything was written the allowance goes back; after, the operation stays as it is for the replay.
    if (!submitted) {
      await releaseEnrichmentQuotaOperation(mutation).catch(() => undefined);
    }
    console.error('[leads-finder/enrich] failed', { code: String((error as Error)?.message || 'unknown').slice(0, 80) });
    return json({ error: 'ENRICHMENT_REQUEST_FAILED', operationId }, submitted ? 409 : 500);
  }
}

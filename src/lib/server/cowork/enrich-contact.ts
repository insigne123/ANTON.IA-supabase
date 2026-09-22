import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { collectCoworkLeadRows } from '@/lib/cowork/lead-export';
import { requireCoworkWorkerAccess } from './access';
import {
  getEffectiveDailyQuotaLimits,
  getEnrichmentQuotaOperation,
  claimEnrichmentQuotaOperation,
  releaseEnrichmentQuotaOperation,
} from '@/lib/server/daily-quota-store';
import { hasUserEnrichmentSearchCreditAccess } from '@/lib/server/enrichment-search-access';
import {
  applyApolloEnrichmentCandidate,
  bindApolloEnrichmentCallback,
  createApolloEnrichmentCallback,
  markApolloEnrichmentCallbackSubmitted,
  settleApolloEnrichmentCallback,
} from '@/lib/server/apollo-enrichment-callbacks';
import { submitApolloEnrichment } from '@/lib/server/apollo-enrichment';
import { verifiedEmailEvidence } from '@/lib/cowork/list-quality';

/** Fase 2B: enrich one own saved lead (email-basic only) through the same shared
 * primitives as the app's enrich flow: quota claim lifecycle, callback row for
 * reconciliation, single provider submission, persist + apply + complete.
 * Phone/deep enrichment stays out of v1 to bound credit cost. */

function text(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function splitName(fullName: string) {
  const parts = fullName.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined, fullName: parts.join(' ') };
}

function cleanDomain(value: unknown) {
  const raw = text(value, 253);
  if (!raw) return undefined;
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : raw.split('/')[0];
    return host.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

function normalizeLinkedin(value: unknown) {
  const raw = text(value, 500);
  if (!raw || !/linkedin\.com/i.test(raw)) return undefined;
  return raw;
}

export type CoworkEnrichResult = {
  email: string | null; emailStatus: string | null; found: boolean;
  verifiedForList: boolean;
  creditsConsumed?: number; reused: boolean; enrichedLeadId: string;
};

export async function enrichCoworkContact(
  auth: AuthContext, runId: string, leadId: string,
): Promise<CoworkEnrichResult> {
  z.string().uuid().parse(leadId);
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El contacto a enriquecer ya no está disponible en este trabajo.');
  }
  const completed = state.events
    .filter((event: { kind: string }) => event.kind === 'tool.completed')
    .map((event: { payload: unknown }) => event.payload);
  const observed = collectCoworkLeadRows(completed).some(row => row.id === leadId)
    || completed.some((payload: unknown) => payload && typeof payload === 'object'
      && ((payload as { action?: string }).action === 'lists.review_batch'
        || (payload as { action?: string }).action === 'lists.review_contact')
      && Array.isArray((payload as { result?: { items?: Array<{ leadId?: string }> } }).result?.items)
      && ((payload as { result: { items: Array<{ leadId?: string }> } }).result.items
        .some(item => item.leadId === leadId)));
  if (!observed) throw new Error('El contacto a enriquecer debe haberse observado primero en esta conversación.');
  const leadRow = await auth.supabase.from('leads')
    .select('id,name,title,company,company_website,linkedin_url,email,source_provider,source_provider_id')
    .eq('id', leadId).eq('user_id', auth.user.id).eq('organization_id', auth.organizationId).maybeSingle();
  if (leadRow.error || !leadRow.data) throw new Error('El contacto a enriquecer ya no está disponible en este trabajo.');
  const saved = leadRow.data as Record<string, unknown>;
  const name = splitName(String(saved.name || ''));
  const linkedinUrl = normalizeLinkedin(saved.linkedin_url);
  const companyDomain = cleanDomain(saved.company_website);
  const apolloPersonId = typeof saved.source_provider_id === 'string' && saved.source_provider === 'apollo'
    ? text(saved.source_provider_id, 255) : undefined;
  if (!apolloPersonId && !linkedinUrl && !(name.firstName && (companyDomain || text(saved.company, 200)))) {
    throw new Error('El contacto no tiene identidad suficiente para enriquecerlo (nombre y empresa o LinkedIn).');
  }

  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const operationId = `cowork:${runId}:lead:${leadId}:enrich-v1`;
  const fingerprint = createHash('sha256').update(`cowork|enrich|${leadId}|email-basic`).digest('hex');

  const existing = await getEnrichmentQuotaOperation({ userId, organizationId, resource: 'enrich', operationId, requestFingerprint: fingerprint });
  if (existing && existing.status === 'completed') {
    const callback = await client.from('apollo_enrichment_callbacks').select('target_lead_id')
      .eq('operation_id', operationId).eq('user_id', userId).eq('organization_id', organizationId)
      .eq('target_table', 'enriched_leads').maybeSingle();
    if (callback.error || !callback.data) throw new Error('No se pudo recuperar el resultado del enriquecimiento.');
    const persisted = await client.from('enriched_leads').select('id,email,email_status,enrichment_status')
      .eq('id', callback.data.target_lead_id).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
    if (persisted.error || !persisted.data || persisted.data.enrichment_status === 'suppressed') {
      throw new Error('El resultado del enriquecimiento ya no está disponible.');
    }
    return {
      email: persisted.data.email || null,
      emailStatus: persisted.data.email_status || null,
      found: Boolean(persisted.data.email),
      verifiedForList: verifiedEmailEvidence(persisted.data.email, persisted.data.email_status),
      reused: true, enrichedLeadId: persisted.data.id,
    };
  }
  if (existing) {
    throw new Error('Ya existe una solicitud de enriquecimiento para este trabajo. Comprueba su resultado antes de solicitar otra.');
  }

  await requireCoworkWorkerAccess(client, { userId, organizationId });
  if (!await hasUserEnrichmentSearchCreditAccess(userId)) {
    throw new Error('Tu cuenta no tiene acceso a créditos de enriquecimiento.');
  }
  const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
  const claim = await claimEnrichmentQuotaOperation({
    userId, organizationId, resource: 'enrich', operationId, requestFingerprint: fingerprint, limit: limits.enrich, count: 1,
  });
  if (!claim.claimed || !claim.allowed || !claim.claimToken) {
    throw new Error('Se alcanzó el cupo diario de enriquecimiento. Se renueva mañana.');
  }
  const identity = { userId, organizationId, resource: 'enrich' as const, operationId, claimToken: claim.claimToken };
  const now = new Date().toISOString();
  const targetId = randomUUID();
  let providerBoundaryCrossed = false;
  const failTarget = async () => {
    await client.from('enriched_leads').update({ enrichment_status: 'failed', updated_at: now })
      .eq('id', targetId).eq('user_id', userId).eq('organization_id', organizationId);
  };
  try {
    const inserted = await client.from('enriched_leads').insert({
      id: targetId, user_id: userId, organization_id: organizationId,
      full_name: name.fullName || null, email: text(saved.email, 320) || null,
      company_name: text(saved.company, 200) || null, title: text(saved.title, 160) || null,
      linkedin_url: linkedinUrl || null, source_provider: 'apollo', source_provider_id: apolloPersonId || null,
      enrichment_status: 'pending',
      data: { sourceProvider: 'apollo', sourceProviderId: apolloPersonId, sourceSavedLeadId: leadId, companyDomain },
      created_at: now, updated_at: now,
    }).select('id,enrichment_status').maybeSingle();
    if (inserted.error || !inserted.data) throw new Error('No se pudo preparar el enriquecimiento.');
    const callback = await createApolloEnrichmentCallback({
      operationId, claimToken: claim.claimToken, userId, organizationId, quotaResource: 'enrich',
      targetTable: 'enriched_leads', targetId, apolloPersonId, requestedFields: ['person.email'],
    });
    await markApolloEnrichmentCallbackSubmitted({ callbackId: callback.callbackId, tokenHash: callback.tokenHash, claimToken: claim.claimToken });
    await requireCoworkWorkerAccess(client, { userId, organizationId });
    providerBoundaryCrossed = true;
    const result = await submitApolloEnrichment({
      lead: {
        sourceProviderId: apolloPersonId, firstName: name.firstName || undefined, lastName: name.lastName || undefined,
        fullName: name.fullName || undefined, linkedinUrl: linkedinUrl || undefined,
        organizationName: text(saved.company, 200) || undefined, organizationDomain: companyDomain,
      },
      revealEmail: true, revealPhone: false,
    });
    if (apolloPersonId) {
      const resultPersonId = text((result.extractedData?.source_provider_id || result.extractedData?.apollo_id) as unknown, 255);
      if (resultPersonId && resultPersonId !== apolloPersonId) throw new Error('La identidad devuelta por el proveedor no coincide.');
    }
    if (result.providerRequestId) {
      const bound = await bindApolloEnrichmentCallback({
        callbackId: callback.callbackId, providerRequestId: result.providerRequestId, apolloPersonId,
      });
      if (bound !== 'bound') throw new Error('No se pudo conciliar la respuesta del proveedor.');
    }
    const email = text(result.extractedData?.email as unknown, 320);
    const emailStatus = text(result.extractedData?.email_status as unknown, 64);
    const found = result.success && Boolean(email);
    const providerId = text((result.extractedData?.source_provider_id || result.extractedData?.apollo_id) as unknown, 255) || apolloPersonId;
    const persisted = await client.from('enriched_leads').update({
      email: email || undefined, email_status: emailStatus || undefined,
      title: text(result.extractedData?.title as unknown, 160) || undefined,
      linkedin_url: normalizeLinkedin(result.extractedData?.linkedin_url) || undefined,
      source_provider: 'apollo', ...(providerId ? { source_provider_id: providerId } : {}),
      enrichment_status: found ? 'completed' : 'failed', updated_at: new Date().toISOString(),
      data: { sourceProvider: 'apollo', sourceProviderId: providerId, sourceSavedLeadId: leadId, companyDomain, providerObservedAt: now },
    }).eq('id', targetId).eq('user_id', userId).eq('organization_id', organizationId)
      .select('id').maybeSingle();
    if (persisted.error || !persisted.data) throw new Error('No se pudo guardar el resultado del proveedor.');
    if (found) {
      const applied = await applyApolloEnrichmentCandidate({
        tokenHash: callback.tokenHash, providerRequestId: result.providerRequestId || `sync:${callback.callbackId}`,
        providerStatus: 'SUCCEEDED',
        payloadHash: createHash('sha256').update(JSON.stringify(result.extractedData)).digest('hex'),
        candidate: { apollo_person_id: providerId, email, email_status: emailStatus || undefined },
      });
      if (applied !== 'processed' && applied !== 'duplicate') {
        throw new Error('No se pudo confirmar la persistencia del enriquecimiento.');
      }
    } else {
      await settleApolloEnrichmentCallback({ callbackId: callback.callbackId, terminalState: 'no_data', errorCode: 'apollo_no_email_data' });
    }
    if (found && email && verifiedEmailEvidence(email, emailStatus) && !text(saved.email, 320)) {
      // Continuity: research, drafts and sends read the saved lead. Fill its
      // missing email with the provider-verified address; never overwrite one.
      await client.from('leads').update({ email, last_enriched_at: new Date().toISOString() })
        .eq('id', leadId).eq('user_id', userId).eq('organization_id', organizationId);
    }
    const summary = { email: email || null, emailStatus: emailStatus || null, found, verifiedForList: found && verifiedEmailEvidence(email, emailStatus), creditsConsumed: result.creditsConsumed, enrichedLeadId: targetId };
    // Callback settlement owns quota completion; do not complete the same claim twice.
    return { ...summary, reused: false };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'ENRICHMENT_REQUEST_FAILED';
    await failTarget().catch(() => undefined);
    if (!providerBoundaryCrossed) {
      await releaseEnrichmentQuotaOperation(identity).catch(() => undefined);
      if (code === 'ENRICHMENT_TARGET_SUPPRESSED') throw new Error('Este contacto está suprimido y no se puede enriquecer.');
      if (code === 'APOLLO_ENRICHMENT_TARGET_BUSY') throw new Error('Otro proceso está enriqueciendo este contacto ahora mismo.');
      throw new Error('No se pudo preparar el enriquecimiento. No se consultó al proveedor.');
    }
    // Keep submitted state for the shared reconciler; a terminal failure here
    // would lose the distinction between an unknown outcome and a failed request.
    throw new Error('No pudimos confirmar el resultado del proveedor. Comprueba el contacto enriquecido antes de solicitar otra consulta.');
  }
}

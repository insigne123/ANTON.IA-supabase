import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@/lib/server/auth-utils';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { getCoworkRun } from './runs';
import { requireCoworkWorkerAccess } from './access';
import {
  claimEnrichmentQuotaOperation, getEffectiveDailyQuotaLimits, getEnrichmentQuotaOperation, releaseEnrichmentQuotaOperation,
} from '@/lib/server/daily-quota-store';
import { hasUserEnrichmentSearchCreditAccess } from '@/lib/server/enrichment-search-access';
import {
  bindApolloEnrichmentCallback, createApolloEnrichmentCallback, markApolloEnrichmentCallbackSubmitted, settleApolloEnrichmentCallback,
} from '@/lib/server/apollo-enrichment-callbacks';
import { submitApolloEnrichment } from '@/lib/server/apollo-enrichment';
import { isApolloCreditBalanceStale, loadLatestApolloCreditBalance } from '@/lib/server/apollo-credit-balance';
import {
  COWORK_PHONE_REVEAL_CREDITS, coworkPhoneRevealEnabled, coworkPhoneRevealTarget, hashCoworkPhoneReveal, parseCoworkPhoneRevealTarget, type CoworkPhoneWho,
} from '@/lib/cowork/enrich-phone-target';

export { coworkPhoneRevealEnabled } from '@/lib/cowork/enrich-phone-target';

/**
 * Revealing the phone of one saved contact with the provider («revelar teléfono»), behind COWORK_PHONE_REVEAL_ENABLED and the enrich_phone
 * effect. It is the one Cowork action with a price per person (ten credits, the same the app shows for a phone), so it is always one
 * person per approval, the card shows the cost and the balance, and the approval is pinned to who the card named: if the contact changed,
 * nothing is requested. The provider answers a phone later, to a webhook that the app already handles (the same callback the email lookup
 * and the app's own enrichment use), and the number lands in the enriched contacts; this never waits for it and never retries by itself.
 * Nothing is staged in a table: the target carries the contact and a hash of who the card showed.
 */

type Scope = { userId: string; organizationId: string };

const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized && normalized.length <= max ? normalized : undefined;
};
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
  } catch { return undefined; }
}
const linkedinOf = (value: unknown) => { const raw = text(value, 500); return raw && /linkedin\.com/i.test(raw) ? raw : undefined; };

const COLUMNS = 'id,name,title,company,company_website,linkedin_url,email,source_provider,source_provider_id';
async function loadLead(client: ReturnType<typeof getSupabaseAdminClient>, scope: Scope, leadId: string) {
  const { data, error } = await client.from('leads').select(COLUMNS).eq('id', leadId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

/** Who the card names, and whether the contact has enough identity for the provider to find them. */
function whoOf(saved: Record<string, unknown>) {
  const name = splitName(String(saved.name || ''));
  const linkedin = linkedinOf(saved.linkedin_url);
  const domain = cleanDomain(saved.company_website);
  const apolloId = typeof saved.source_provider_id === 'string' && saved.source_provider === 'apollo' ? text(saved.source_provider_id, 255) : undefined;
  const company = text(saved.company, 200);
  const identified = Boolean(apolloId || linkedin || (name.firstName && (domain || company)));
  const who: CoworkPhoneWho = { name: name.fullName, company: company || '', linkedin: linkedin || '', apolloId: apolloId || '', cost: COWORK_PHONE_REVEAL_CREDITS };
  return { who, name, linkedin, domain, apolloId, company, identified, title: text(saved.title, 160) };
}

/** Stages the reveal: checks the contact and pins who the card will name. Nothing is written and nothing is requested. */
export async function stageCoworkPhoneReveal(scope: Scope, runId: string, leadId: string, client = getSupabaseAdminClient()) {
  z.string().uuid().parse(leadId);
  await requireCoworkWorkerAccess(client, scope);
  const state = await client.from('cowork_runs').select('status').eq('id', runId)
    .eq('user_id', scope.userId).eq('organization_id', scope.organizationId).maybeSingle();
  if (state.error || !state.data || (state.data.status !== 'running' && state.data.status !== 'waiting_approval')) {
    throw new Error('El trabajo ya no admite propuestas.');
  }
  const saved = await loadLead(client, scope, leadId);
  if (!saved) throw new Error('El contacto no está disponible en tu organización.');
  const info = whoOf(saved);
  if (!info.identified) throw new Error('El contacto no tiene identidad suficiente para pedir su teléfono (nombre y empresa o LinkedIn).');
  const hash = hashCoworkPhoneReveal(runId, leadId, info.who);
  const label = `Revelar el teléfono de ${info.who.name}${info.who.company ? ` (${info.who.company})` : ''} · ${info.who.cost} créditos`.slice(0, 280);
  return { hash, label, targetId: coworkPhoneRevealTarget(leadId, hash), name: info.who.name, company: info.who.company };
}

/** What the approval card shows: who, what it costs, what is left of the credits and whether the contact is still the one proposed. */
export async function readCoworkPhoneRevealPreview(auth: AuthContext, runId: string, targetId: string) {
  const scope = { userId: auth.user.id, organizationId: auth.organizationId };
  let target: ReturnType<typeof parseCoworkPhoneRevealTarget>;
  try { target = parseCoworkPhoneRevealTarget(targetId); } catch { return null; }
  const saved = await loadLead(getSupabaseAdminClient(), scope, target.leadId);
  if (!saved) return null;
  const info = whoOf(saved);
  const matches = info.identified && hashCoworkPhoneReveal(runId, target.leadId, info.who) === target.hash;
  let balance: { remaining: number; stale: boolean; capturedAt: string } | null = null;
  try {
    const latest = await loadLatestApolloCreditBalance();
    if (latest) balance = { remaining: latest.remaining, stale: isApolloCreditBalanceStale(latest), capturedAt: latest.capturedAt };
  } catch { balance = null; }
  return {
    name: info.who.name, title: info.title ?? null, company: info.who.company || null, cost: info.who.cost, matches,
    balance, affordable: balance ? balance.remaining >= info.who.cost : null,
    unavailable: matches ? null : 'El contacto cambió desde la propuesta. Descártala y pide una nueva.',
  };
}

/** Requests the phone of the approved contact, once. The result arrives later through the provider's webhook. */
export async function executeCoworkPhoneReveal(auth: AuthContext, runId: string, targetId: string) {
  if (!coworkPhoneRevealEnabled()) throw new Error('Revelar teléfonos está desactivado por ahora: no se pidió nada ni se gastó ningún crédito.');
  const target = parseCoworkPhoneRevealTarget(targetId);
  const userId = auth.user.id;
  const organizationId = auth.organizationId;
  const scope = { userId, organizationId };
  const client = getSupabaseAdminClient();
  const state = await getCoworkRun(auth, runId);
  if (!state || (state.run.status !== 'completed' && state.run.status !== 'waiting_approval')) {
    throw new Error('El teléfono a pedir ya no está disponible en este trabajo.');
  }
  await requireCoworkWorkerAccess(client, scope);
  const proposal = await client.from('cowork_effect_proposals').select('status,kind,target_id')
    .eq('run_id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  const run = await client.from('cowork_runs').select('status')
    .eq('id', runId).eq('user_id', userId).eq('organization_id', organizationId).maybeSingle();
  if (proposal.error || run.error || proposal.data?.status !== 'executing' || proposal.data.kind !== 'enrich_phone'
    || proposal.data.target_id !== targetId || run.data?.status !== 'waiting_approval') {
    throw new Error('La autorización para pedir el teléfono ya no está vigente.');
  }
  const saved = await loadLead(client, scope, target.leadId);
  if (!saved) throw new Error('El contacto ya no está disponible. No se pidió el teléfono.');
  const info = whoOf(saved);
  if (!info.identified || hashCoworkPhoneReveal(runId, target.leadId, info.who) !== target.hash) {
    throw new Error('El contacto cambió desde tu revisión. No se pidió el teléfono: pide una nueva revisión.');
  }
  if (!await hasUserEnrichmentSearchCreditAccess(userId)) throw new Error('Tu cuenta no tiene acceso a créditos de enriquecimiento. No se pidió el teléfono.');
  // The balance is the shared account's last reading: when it says there is not enough, nothing is asked; when it cannot be read, the provider decides.
  try {
    const latest = await loadLatestApolloCreditBalance();
    if (latest && latest.remaining < info.who.cost) throw new Error(`Alcanzan ${latest.remaining} créditos y revelar un teléfono cuesta ${info.who.cost}. No se pidió el teléfono.`);
  } catch (error) {
    if (error instanceof Error && /No se pidió el teléfono/.test(error.message)) throw error;
  }

  const operationId = `cowork:${runId}:lead:${target.leadId}:phone-v1`;
  const fingerprint = createHash('sha256').update(`cowork|enrich|${target.leadId}|phone`).digest('hex');
  const existing = await getEnrichmentQuotaOperation({ userId, organizationId, resource: 'enrich', operationId, requestFingerprint: fingerprint });
  if (existing) throw new Error('Ya se pidió el teléfono de este contacto en este trabajo: repetirlo gastaría otros créditos. Revisa si ya llegó en tus contactos enriquecidos.');
  const limits = await getEffectiveDailyQuotaLimits({ userId, organizationId });
  const claim = await claimEnrichmentQuotaOperation({
    userId, organizationId, resource: 'enrich', operationId, requestFingerprint: fingerprint, limit: limits.enrich, count: 1,
  });
  if (!claim.claimed || !claim.allowed || !claim.claimToken) throw new Error('Se alcanzó el cupo diario de enriquecimiento. Se renueva mañana. No se pidió el teléfono.');
  const identity = { userId, organizationId, resource: 'enrich' as const, operationId, claimToken: claim.claimToken };
  const now = new Date().toISOString();
  const targetRow = randomUUID();
  let providerBoundaryCrossed = false;
  const failTarget = async () => {
    await client.from('enriched_leads').update({ enrichment_status: 'failed', updated_at: now })
      .eq('id', targetRow).eq('user_id', userId).eq('organization_id', organizationId);
  };
  try {
    const inserted = await client.from('enriched_leads').insert({
      id: targetRow, user_id: userId, organization_id: organizationId,
      full_name: info.name.fullName || null, email: text(saved.email, 320) || null,
      company_name: info.company || null, title: info.title || null,
      linkedin_url: info.linkedin || null, source_provider: 'apollo', source_provider_id: info.apolloId || null,
      enrichment_status: 'pending',
      data: { sourceProvider: 'apollo', sourceProviderId: info.apolloId, sourceSavedLeadId: target.leadId, companyDomain: info.domain, phoneRequested: true },
      created_at: now, updated_at: now,
    }).select('id,enrichment_status').maybeSingle();
    if (inserted.error || !inserted.data) throw new Error('No se pudo preparar el pedido del teléfono.');
    const callback = await createApolloEnrichmentCallback({
      operationId, claimToken: claim.claimToken, userId, organizationId, quotaResource: 'enrich',
      targetTable: 'enriched_leads', targetId: targetRow, apolloPersonId: info.apolloId, requestedFields: ['person.phone_numbers'],
    });
    await markApolloEnrichmentCallbackSubmitted({ callbackId: callback.callbackId, tokenHash: callback.tokenHash, claimToken: claim.claimToken });
    await requireCoworkWorkerAccess(client, scope);
    providerBoundaryCrossed = true;
    const result = await submitApolloEnrichment({
      lead: {
        sourceProviderId: info.apolloId, firstName: info.name.firstName, lastName: info.name.lastName, fullName: info.name.fullName || undefined,
        linkedinUrl: info.linkedin, organizationName: info.company, organizationDomain: info.domain,
      },
      revealEmail: false, revealPhone: true, webhookUrl: callback.webhookUrl,
    });
    if (result.providerRequestId) {
      const bound = await bindApolloEnrichmentCallback({ callbackId: callback.callbackId, providerRequestId: result.providerRequestId, apolloPersonId: info.apolloId });
      if (bound !== 'bound') throw new Error('No se pudo conciliar la respuesta del proveedor.');
    }
    if (!result.success) {
      // The provider refused the request itself: nothing to wait for.
      await failTarget();
      await settleApolloEnrichmentCallback({ callbackId: callback.callbackId, terminalState: 'no_data', errorCode: 'apollo_phone_request_refused' });
      return { reply: `El proveedor no aceptó el pedido del teléfono de ${info.who.name}. Prueba más tarde o escríbele por correo o LinkedIn.`,
        result: { requested: false, creditsConsumed: result.creditsConsumed ?? 0, enrichedLeadId: targetRow } };
    }
    return {
      reply: `Pedí el teléfono de ${info.who.name} al proveedor (cuesta hasta ${info.who.cost} créditos). Lo entrega en unos minutos y queda en tus contactos enriquecidos; si no tiene un teléfono disponible, no habrá número.`,
      result: { requested: true, creditsConsumed: result.creditsConsumed ?? null, enrichedLeadId: targetRow, providerRequestId: result.providerRequestId ?? null },
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PHONE_REQUEST_FAILED';
    await failTarget().catch(() => undefined);
    if (!providerBoundaryCrossed) {
      await releaseEnrichmentQuotaOperation(identity).catch(() => undefined);
      if (code === 'ENRICHMENT_TARGET_SUPPRESSED') throw new Error('Este contacto está suprimido y no se puede enriquecer.');
      if (code === 'APOLLO_ENRICHMENT_TARGET_BUSY') throw new Error('Otro proceso está enriqueciendo este contacto ahora mismo.');
      throw new Error('No se pudo preparar el pedido del teléfono. No se consultó al proveedor.');
    }
    // Kept as submitted for the shared reconciler: a terminal failure here would lose the difference between an unknown outcome and a refusal.
    throw new Error('No pudimos confirmar el pedido al proveedor. Revisa el contacto enriquecido antes de pedir otra vez: repetirlo podría gastar otros créditos.');
  }
}

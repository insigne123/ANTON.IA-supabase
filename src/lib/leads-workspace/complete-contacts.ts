// Looks up the email (and the mobile, when asked) of saved contacts and moves who got something to «Por escribir».
// One routine for the step after saving a search and for the contacts still without email in «Por escribir»: before,
// it lived in the «Por completar» page, a stop the person had to remember.
import type { EnrichedLead, Lead } from '@/lib/types';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { supabaseService } from '@/lib/supabase-service';
import { enrichWithLeadsFinder } from '@/lib/leads-finder-client';
import * as Quota from '@/lib/quota-client';
import { getQuotaTicket, setQuotaTicket } from '@/lib/quota-ticket';
import { enrichmentAttempt } from '@/lib/enrichment-attempt';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { enrichmentRefusalMessage } from '@/lib/apollo-credit-allocation';
import { enrichmentCreditReceipt, partitionEnrichmentLeads } from '@/lib/leads-workspace/enrichment-provider';
import { classifyEnrichmentResults } from '@/lib/leads-workspace/saved-enrichment';
import { v4 as uuid } from 'uuid';

/** What to look up for one contact: the work email only, or the email and the mobile. */
export type ContactLookup = 'email' | 'email_phone';

export type ContactCompletion = {
  /** Contacts that got an email, a phone or a lookup still running: now in «Por escribir». */
  moved: EnrichedLead[];
  /** Saved ids searched with nothing found: they stay saved, marked «Sin correo». */
  notFound: string[];
  /** Leads Finder results older than 30 days: nothing was charged. */
  expired: number;
  failures: string[];
  consumed: number;
  markedNotFound: boolean;
};

const displayDomain = (url: string) => { try { const u = new URL(url.startsWith('http') ? url : `https://${url}`); return u.hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, ''); } };

/** The contacts grouped by what to look up, so each provider call asks for the same fields. */
export function groupByLookup(leads: Lead[], lookups: Record<string, ContactLookup>): Array<{ revealPhone: boolean; leads: Lead[] }> {
  const email = leads.filter(lead => (lookups[lead.id] ?? 'email') === 'email');
  const both = leads.filter(lead => lookups[lead.id] === 'email_phone');
  return [{ revealPhone: false, leads: email }, { revealPhone: true, leads: both }].filter(group => group.leads.length > 0);
}

async function lookUp(chosen: Lead[], revealPhone: boolean) {
  const revealEmail = true;
  const results: any[] = [];
  const failures: string[] = [];
  let consumed = 0;
  let expired = 0;
  // People found with Leads Finder (Plan 11) are revealed from what that search already brought; the rest, with Apollo.
  const { leadsFinder: fromLeadsFinder, apollo: forApollo } = partitionEnrichmentLeads(chosen);
  if (fromLeadsFinder.length > 0) {
    try {
      const revealed = await enrichWithLeadsFinder({
        leads: fromLeadsFinder.map(lead => ({ sourceProviderId: String(lead.sourceProviderId), clientRef: lead.id })),
        revealEmail, revealPhone, operationId: uuid(),
      });
      // Expired data stays saved, without a false «Sin correo» mark.
      results.push(...revealed.enriched.filter(item => item.enrichmentStatus !== 'expired'));
      expired = revealed.expired.length;
      consumed += Number(revealed.usage?.consumed ?? 0);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'No pudimos completar parte de los contactos.');
    }
  }
  if (forApollo.length > 0) {
    try {
      const payloadLeads = forApollo.map(lead => ({
        fullName: lead.name,
        linkedinUrl: lead.linkedinUrl || undefined,
        companyName: lead.company || undefined,
        companyDomain: lead.companyWebsite ? displayDomain(lead.companyWebsite) : undefined,
        clientRef: lead.id,
        id: lead.id,
        sourceProviderId: lead.sourceProvider === 'apollo' ? lead.sourceProviderId : undefined,
      }));
      const attempt = await enrichmentAttempt('apollo', forApollo, { revealEmail, revealPhone });
      const response = await authenticatedApiFetch('/api/opportunities/enrich-apollo', {
        method: 'POST',
        headers: { ...attempt.headers, 'x-quota-ticket': getQuotaTicket() || '' },
        body: JSON.stringify({ leads: payloadLeads, revealEmail, revealPhone, tableName: 'enriched_leads' }),
      });
      const body = await response.clone().json().catch(async () => ({ nonJson: true, text: await response.text() }));
      if (!response.ok) {
        const refusal = enrichmentRefusalMessage(body);
        if (refusal) throw new Error(refusal);
        const snippet = (body as any)?.error || (body as any)?.message || (body as any)?.text || 'Error interno';
        throw new Error(`HTTP ${response.status}: ${String(snippet).slice(0, 200)}`);
      }
      if (typeof body.note === 'string' && body.note.includes('Quota')) failures.push(body.note);
      const ticket = (body as any)?.ticket || response.headers.get('x-quota-ticket');
      if (ticket) setQuotaTicket(ticket);
      if (!body?.usage?.reused) consumed += Number(body?.usage?.consumed ?? 0);
      results.push(...(Array.isArray(body.enriched) ? body.enriched : []));
      if (body.operationStatus === 'completed') attempt.complete();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'No pudimos completar parte de los contactos.');
    }
  }
  return { results, failures, consumed, expired };
}

/**
 * Looks up each saved contact with what was chosen for it and moves who got an email, a phone or a lookup still running
 * to «Por escribir». Who got nothing stays saved and marked, to retry from «Por escribir».
 */
export async function completeSavedContacts(leads: Lead[], lookups: Record<string, ContactLookup>): Promise<ContactCompletion> {
  const completion: ContactCompletion = { moved: [], notFound: [], expired: 0, failures: [], consumed: 0, markedNotFound: true };
  for (const group of groupByLookup(leads, lookups)) {
    const { results, failures, consumed, expired } = await lookUp(group.leads, group.revealPhone);
    completion.failures.push(...failures);
    completion.consumed += consumed;
    completion.expired += expired;
    const outcome = classifyEnrichmentResults(group.leads, results, { revealPhone: group.revealPhone });
    const unpersisted = outcome.toEnriched.filter(lead => !results.some(row => row.id === lead.id && row.serverPersisted === true));
    if (unpersisted.length > 0) await enrichedLeadsStorage.addDedup(unpersisted);
    const moved = new Set(outcome.removeFromSaved);
    if (moved.size > 0) await supabaseService.removeWhere(lead => moved.has(lead.id));
    if (outcome.notFound.length > 0) {
      try {
        await supabaseService.markEmailNotFound(outcome.notFound, new Date().toISOString());
      } catch {
        completion.markedNotFound = false;
      }
    }
    completion.moved.push(...outcome.toEnriched);
    completion.notFound.push(...outcome.notFound);
  }
  if (completion.consumed > 0) Quota.incClientQuota('enrich', completion.consumed);
  return completion;
}

/** The toast after a lookup: who moved to «Por escribir», who is still on its way, who has no email, and the credits. */
export function completionSummary(completion: ContactCompletion): { title: string; description: string } {
  const withEmail = completion.moved.filter(lead => lead.email).length;
  const stillLooking = completion.moved.filter(lead => !lead.email && String(lead.enrichmentStatus || '').startsWith('pending')).length;
  const phoneOnly = completion.moved.length - withEmail - stillLooking;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    withEmail ? `${count(withEmail, 'con correo pasa', 'con correo pasan')} a «Por escribir»` : '',
    phoneOnly ? `${count(phoneOnly, 'con teléfono pasa', 'con teléfono pasan')} a «Por escribir»` : '',
    stillLooking ? `${count(stillLooking, 'sigue en búsqueda y aparecerá', 'siguen en búsqueda y aparecerán')} en «Por escribir»` : '',
    completion.notFound.length ? `${count(completion.notFound.length, 'quedó sin correo', 'quedaron sin correo')}: ${completion.notFound.length === 1 ? 'lo verás' : 'los verás'} al final de «Por escribir» para intentarlo de nuevo` : '',
    completion.expired ? `${count(completion.expired, 'resultado venció', 'resultados vencieron')} (se guardan 30 días): búscalos de nuevo, no se cobró` : '',
    ...completion.failures.map(message => `Hay contactos pendientes: ${message}`),
  ].filter(Boolean);
  return {
    title: completion.moved.length > 0 ? 'Datos de contacto listos' : 'No encontramos correos',
    description: `${parts.length ? `${parts.join('. ')}.` : 'El proveedor no devolvió resultados para estos contactos.'} ${enrichmentCreditReceipt(completion.consumed)}`.trim(),
  };
}

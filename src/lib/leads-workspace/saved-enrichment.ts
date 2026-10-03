// What happens to each contact of «Por completar» after an email search (Plan 9, PR-13a). Before, every processed
// contact left the list and landed in «Por escribir», even when nothing was found: the person lost track of who still
// had no email.
import type { EnrichedLead, Lead } from '@/lib/types';

export type SavedLookupState = 'with_email' | 'not_found' | 'not_searched';

/** What the badge, the status chips and the export call each state. */
export const SAVED_LOOKUP_LABELS: Record<SavedLookupState, string> = {
  not_searched: 'Sin buscar',
  not_found: 'Sin correo',
  with_email: 'Con correo',
};

/** The state a saved contact shows: an email already, a search that found nothing, or not searched yet. */
export function savedLookupState(lead: Pick<Lead, 'email' | 'emailEnrichment'>): SavedLookupState {
  if (String(lead.email || '').includes('@')) return 'with_email';
  return lead.emailEnrichment?.status === 'not_found' ? 'not_found' : 'not_searched';
}

const domainOf = (lead: Lead) => {
  if (lead.companyWebsite) {
    const raw = lead.companyWebsite;
    try {
      return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
    } catch {
      return raw.replace(/^https?:\/\//, '').replace(/^www\./, '');
    }
  }
  return lead.email?.includes('@') ? lead.email.split('@')[1].toLowerCase() : undefined;
};

type ProviderResult = Partial<EnrichedLead> & { clientRef?: string | null };

export type EnrichmentOutcome = {
  /** Contacts with an email, a phone or a lookup still running: they move to «Por escribir». */
  toEnriched: EnrichedLead[];
  /** Saved rows that leave «Por completar» because they moved. */
  removeFromSaved: string[];
  /** Searched and nothing came back: they stay in «Por completar», marked «Sin correo». */
  notFound: string[];
};

/**
 * Sorts the provider's answer. A contact moves when it got an email or a phone, or when the provider is still looking
 * (the result lands on its «Por escribir» row later). Only a finished search with nothing found keeps it here.
 */
export function classifyEnrichmentResults(chosen: Lead[], results: ProviderResult[], options: { revealPhone: boolean }): EnrichmentOutcome {
  const byRef = new Map(chosen.map((lead) => [lead.id, lead]));
  const outcome: EnrichmentOutcome = { toEnriched: [], removeFromSaved: [], notFound: [] };
  const seen = new Set<string>();
  for (const result of results || []) {
    const ref = String(result?.clientRef || '').trim();
    const source = byRef.get(ref);
    if (!source || seen.has(ref)) continue;
    seen.add(ref);
    const email = String(result.email || '').trim();
    const phone = result.primaryPhone || (result.phoneNumbers?.length ? result.phoneNumbers[0]?.sanitized_number : undefined) || undefined;
    const pending = String(result.enrichmentStatus || '').toLowerCase().startsWith('pending');
    if (!email && !phone && !pending) {
      outcome.notFound.push(ref);
      continue;
    }
    outcome.toEnriched.push({
      id: result.id || ref,
      sourceProvider: result.sourceProvider,
      sourceProviderId: result.sourceProviderId,
      fullName: result.fullName || source.name,
      title: result.title || source.title,
      email: email || undefined,
      emailStatus: email ? (result.emailStatus || 'verified') : 'unknown',
      linkedinUrl: result.linkedinUrl || source.linkedinUrl || undefined,
      companyName: result.companyName ?? source.company,
      companyDomain: result.companyDomain ?? domainOf(source),
      country: source.country || undefined,
      city: source.city || undefined,
      industry: source.industry || undefined,
      phoneNumbers: result.phoneNumbers,
      primaryPhone: phone,
      enrichmentStatus: result.enrichmentStatus || (phone ? 'completed' : options.revealPhone ? 'pending_phone' : 'completed'),
      createdAt: new Date().toISOString(),
    } as EnrichedLead);
    outcome.removeFromSaved.push(ref);
  }
  return outcome;
}

/** A saved contact that already has an email goes to «Por escribir» without spending credits. */
export function savedLeadToEnriched(lead: Lead): EnrichedLead {
  return {
    id: lead.id,
    sourceProvider: lead.sourceProvider,
    sourceProviderId: lead.sourceProviderId || lead.apolloId,
    fullName: lead.name,
    title: lead.title,
    email: lead.email || undefined,
    emailStatus: 'unknown',
    linkedinUrl: lead.linkedinUrl || undefined,
    companyName: lead.company || undefined,
    companyDomain: domainOf(lead),
    country: lead.country || undefined,
    city: lead.city || undefined,
    industry: lead.industry || undefined,
    createdAt: new Date().toISOString(),
  } as EnrichedLead;
}

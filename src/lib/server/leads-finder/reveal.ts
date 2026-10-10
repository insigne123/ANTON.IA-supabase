import type { VaultEntry } from './vault';
import { LEADS_FINDER_PROVIDER } from './client';

/**
 * «Enriquecer» a Leads Finder result (Plan 11, PR 6c): what the vault kept becomes the same enriched lead an Apollo
 * enrichment leaves in «Por escribir» (same columns of enriched_leads, same answer to the screen), with the provider
 * recorded as leads_finder. Pure, so the rules are tested without a database: only the work email (never the personal
 * one), the phone only when it was asked for, and Apify's email check read with Apollo's words.
 */
const text = (value: unknown, max = 500) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Apify says validated / not_validated / unknown; the app (from Apollo) reads verified / unverified / unknown. */
export function revealedEmailStatus(status: VaultEntry['contact']['emailStatus']) {
  return status === 'validated' ? 'verified' : status === 'not_validated' ? 'unverified' : 'unknown';
}

export type RevealOptions = {
  id: string;
  userId: string;
  organizationId: string;
  revealEmail: boolean;
  revealPhone: boolean;
  now: string;
};

/** The enriched_leads row for one person, as persistImmediateResult writes it for Apollo. */
export function enrichedLeadRow(entry: VaultEntry, options: RevealOptions) {
  const { lead, contact } = entry;
  const email = options.revealEmail ? text(contact.email, 320).toLowerCase() || null : null;
  const phone = options.revealPhone ? text(contact.mobileNumber, 64) || null : null;
  const fullName = text(contact.fullName, 200) || [text(contact.firstName, 100), text(contact.lastName, 100)].filter(Boolean).join(' ') || text(lead.name, 200);
  const domain = text(lead.organization_domain, 253) || null;
  return {
    id: options.id,
    user_id: options.userId,
    organization_id: options.organizationId,
    full_name: fullName || null,
    email,
    email_status: email ? revealedEmailStatus(contact.emailStatus) : null,
    phone_numbers: phone ? [{ raw_number: phone, sanitized_number: phone, type: 'mobile' }] : [],
    primary_phone: phone,
    title: text(lead.title, 160) || null,
    headline: text(lead.headline, 300) || null,
    company_name: text(lead.organization_name, 200) || null,
    organization_domain: domain,
    organization_industry: text(lead.organization_industry, 160) || null,
    organization_size: typeof lead.organization_size === 'number' ? lead.organization_size : null,
    linkedin_url: text(contact.linkedinUrl, 500) || null,
    city: text(lead.city, 160) || null,
    state: text(lead.state, 160) || null,
    country: text(lead.country, 160) || null,
    seniority: text(lead.seniority, 100) || null,
    departments: Array.isArray(lead.departments) ? lead.departments.slice(0, 20) : [],
    source_provider: LEADS_FINDER_PROVIDER,
    source_provider_id: lead.id,
    enrichment_status: email || phone ? 'completed' : 'failed',
    data: {
      sourceProvider: LEADS_FINDER_PROVIDER,
      sourceProviderId: lead.id,
      companyDomain: domain || undefined,
      organization: lead.organization || undefined,
      providerObservedAt: options.now,
    },
    created_at: options.now,
    updated_at: options.now,
  };
}

/** What the screen receives for one person, the same fields as the Apollo enrichment answer. */
export function revealedLead(row: ReturnType<typeof enrichedLeadRow>, input: { clientRef?: string; revealEmail: boolean; revealPhone: boolean }) {
  if (row.enrichment_status === 'suppressed') return {
    id: row.id, clientRef: input.clientRef, sourceProvider: LEADS_FINDER_PROVIDER, sourceProviderId: row.source_provider_id,
    fullName: '', firstName: '', lastName: '', email: undefined, emailStatus: undefined,
    phoneNumbers: undefined, primaryPhone: undefined, enrichmentStatus: 'suppressed',
  };
  const [firstName, ...rest] = String(row.full_name || '').split(' ');
  return {
    id: row.id,
    clientRef: input.clientRef,
    sourceProvider: LEADS_FINDER_PROVIDER,
    sourceProviderId: row.source_provider_id,
    fullName: row.full_name || '',
    firstName: firstName || '',
    lastName: rest.join(' '),
    email: input.revealEmail ? row.email || '' : undefined,
    emailStatus: input.revealEmail ? row.email_status || '' : undefined,
    linkedinUrl: row.linkedin_url || undefined,
    title: row.title || '',
    headline: row.headline || '',
    companyName: row.company_name || '',
    companyDomain: row.organization_domain || '',
    industry: row.organization_industry || '',
    companySize: row.organization_size == null ? undefined : String(row.organization_size),
    city: row.city || '',
    state: row.state || '',
    country: row.country || '',
    seniority: row.seniority || '',
    departments: row.departments,
    phoneNumbers: input.revealPhone ? row.phone_numbers : undefined,
    primaryPhone: input.revealPhone ? row.primary_phone || '' : undefined,
    enrichmentStatus: row.enrichment_status,
  };
}

/** The identity the saved contact gets back (its real name, LinkedIn and title), in the shape lead-identity reads. */
export function revealedIdentity(row: ReturnType<typeof enrichedLeadRow>) {
  const [firstName, ...rest] = String(row.full_name || '').split(' ');
  return { full_name: row.full_name, first_name: firstName || null, last_name: rest.join(' ') || null, linkedin_url: row.linkedin_url, title: row.title };
}

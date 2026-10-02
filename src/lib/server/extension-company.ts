import type { AuthContext } from '@/lib/server/auth-utils';
import type { ExtensionCompany } from '@/lib/extension-contracts';
import type { ProfilePresence } from '@/lib/extension-presence';
import { canonicalExtensionProfileUrl } from '@/lib/extension-profile-url';
import { companyDomain, companySearchName, emailDomain, sameCompany } from '@/lib/extension-company';
import { companySearchHref } from '@/lib/search/company-prefill';
import { isOpportunitiesUserAllowed } from '@/lib/commercial-opportunities/access';
import { hiringSignal, OPPORTUNITIES_PAGE } from '@/lib/commercial-opportunities/cowork';
import { findHiringProfile, listHiringOpportunities } from '@/lib/server/commercial-opportunities/store';
import { icpDeclaredFromProfile } from '@/lib/server/cowork/icp-read';
import { readExtensionPresence } from '@/lib/server/extension-presence';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

/** The saved contacts shown for one company; the rest are counted. */
export const COMPANY_CONTACTS_SHOWN = 20;
const READ_LIMIT = 100;
const literal = (value: string) => value.replace(/[%,()*\\"_]/g, ' ').replace(/\s+/g, ' ').trim();

export type CompanyContact = { name: string; title: string; linkedinUrl: string; hasEmail: boolean; presence: ProfilePresence | null };
export type CompanyOpportunity = { company: string; ads: number; score: number; status: string; signal: string; page: string };
export type ExtensionCompanyView = {
  contacts: CompanyContact[]; total: number; truncated: boolean; searchHref: string; opportunity: CompanyOpportunity | null;
};

type Deps = {
  presence: typeof readExtensionPresence;
  admin: () => ReturnType<typeof getSupabaseAdminClient>;
  allowedEmails: string | undefined;
  now: () => number;
};
const defaults = (): Deps => ({ presence: readExtensionPresence, admin: getSupabaseAdminClient, allowedEmails: process.env.OPPORTUNITIES_ALLOWED_EMAILS, now: Date.now });

type EnrichedRow = { id: string; full_name: string | null; title: string | null; company_name: string | null; email: string | null; linkedin_url: string | null; organization_domain: string | null };
type LeadRow = { id: string; name: string | null; title: string | null; company: string | null; email: string | null; linkedin_url: string | null; company_website: string | null; company_linkedin: string | null };

/**
 * company (plan 8, phase 4, PR-4d): what the organization has of the LinkedIn company on screen. Its saved contacts, found by
 * the company's LinkedIn page, web domain or name (never a name inside another: «Falabella» is not «Banco Falabella»), each with
 * what the organization knows of them (PR-4b). The link to look for its decision makers in Búsqueda, with the roles of «Perfil».
 * For the accounts of OPPORTUNITIES_ALLOWED_EMAILS, its «hiring» opportunity with the signal. Read only.
 */
export async function readExtensionCompany(auth: Pick<AuthContext, 'supabase' | 'organizationId' | 'user'>, company: ExtensionCompany,
  overrides: Partial<Deps> = {}): Promise<ExtensionCompanyView> {
  const deps = { ...defaults(), ...overrides };
  const scope = { userId: auth.user.id as string, organizationId: auth.organizationId };
  const keys = { linkedinUrl: company.linkedinUrl, domain: company.domain, name: company.name };
  const name = literal(companySearchName(company.name));
  const slug = literal(company.linkedinUrl.replace('https://www.linkedin.com/company/', ''));
  const domain = company.domain;
  const enrichedFilter = [
    name.length >= 2 && `company_name.ilike."%${name}%"`,
    domain && `organization_domain.ilike."%${domain}%"`, domain && `email.ilike."%@${domain}"`,
  ].filter(Boolean).join(',');
  const leadFilter = [
    name.length >= 2 && `company.ilike."%${name}%"`, slug && `company_linkedin.ilike."%/company/${slug}%"`,
    domain && `email.ilike."%@${domain}"`, domain && `company_website.ilike."%${domain}%"`,
  ].filter(Boolean).join(',');
  const none = { data: [], error: null };
  const [enriched, leads, profile] = await Promise.all([
    enrichedFilter ? auth.supabase.from('enriched_leads').select('id,full_name,title,company_name,email,linkedin_url,organization_domain')
      .eq('organization_id', scope.organizationId).or(enrichedFilter).order('created_at', { ascending: false }).limit(READ_LIMIT) : none,
    leadFilter ? auth.supabase.from('leads').select('id,name,title,company,email,linkedin_url,company_website,company_linkedin')
      .eq('organization_id', scope.organizationId).or(leadFilter).order('created_at', { ascending: false }).limit(READ_LIMIT) : none,
    auth.supabase.from('profiles').select('company_name,signatures').eq('id', scope.userId).maybeSingle(),
  ]);
  for (const read of [enriched, leads]) if (read.error) throw read.error;

  // One contact per person: the same profile or the same email is one, and the enriched record speaks first.
  const merged = new Map<string, CompanyContact>();
  const add = (row: { id: string; name: string | null; title: string | null; email: string | null; linkedin_url: string | null }) => {
    const linkedinUrl = canonicalExtensionProfileUrl(row.linkedin_url || '');
    const email = String(row.email || '').trim().toLowerCase();
    const key = linkedinUrl || (email.includes('@') ? `email:${email}` : `id:${row.id}`);
    if (merged.has(key)) return;
    merged.set(key, { name: String(row.name || '').trim() || 'Contacto sin nombre', title: String(row.title || '').trim(), linkedinUrl,
      hasEmail: email.includes('@'), presence: null });
  };
  for (const row of (enriched.data || []) as EnrichedRow[]) {
    if (sameCompany(keys, { domains: [companyDomain(row.organization_domain), emailDomain(row.email)], name: row.company_name })) {
      add({ ...row, name: row.full_name });
    }
  }
  for (const row of (leads.data || []) as LeadRow[]) {
    if (sameCompany(keys, { linkedinUrl: row.company_linkedin, domains: [companyDomain(row.company_website), emailDomain(row.email)], name: row.company })) add(row);
  }
  const contacts = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, COMPANY_CONTACTS_SHOWN);
  const urls = contacts.flatMap(contact => contact.linkedinUrl ? [contact.linkedinUrl] : []);
  const presence = urls.length ? await deps.presence(auth, urls, deps.now()) : {};
  for (const contact of contacts) contact.presence = (contact.linkedinUrl && presence[contact.linkedinUrl]) || null;

  return {
    contacts, total: merged.size, truncated: [enriched, leads].some(read => (read.data || []).length >= READ_LIMIT),
    searchHref: companySearchHref({ company: company.name, domain: domain || null, titles: icpDeclaredFromProfile(profile.data)?.roles ?? [] }),
    opportunity: await hiringOpportunity(auth, scope, keys, deps),
  };
}

/** The pilot's «hiring» opportunity of this company, with the profile's own minimum of ads; null for everyone else. */
async function hiringOpportunity(auth: Pick<AuthContext, 'user'>, scope: { userId: string; organizationId: string },
  keys: { linkedinUrl: string; domain: string; name: string }, deps: Deps): Promise<CompanyOpportunity | null> {
  if (!isOpportunitiesUserAllowed(auth.user, deps.allowedEmails)) return null;
  try {
    const admin = deps.admin();
    const profile = await findHiringProfile(admin, scope);
    if (!profile) return null;
    const items = await listHiringOpportunities(admin, scope, { minAds: profile.minAds, now: new Date(deps.now()).toISOString() });
    const match = items.find(item => item.status !== 'dismissed'
      && sameCompany(keys, { linkedinUrl: item.linkedinUrl, domains: [companyDomain(item.domain)], name: item.company }));
    return match ? { company: match.company, ads: match.ads, score: match.score, status: match.status, signal: hiringSignal(match), page: OPPORTUNITIES_PAGE } : null;
  } catch {
    // The opportunity is a hint: the company's contacts still answer without it.
    return null;
  }
}

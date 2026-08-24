import type { LeadFromApollo } from '@/lib/types';
import * as San from '@/lib/input-sanitize';
import { resolveLeadProvider } from '@/lib/server/provider-routing';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';
const LOCKED_EMAIL_RE = /email_not_unlocked@domain\.com/i;
export type SupliaProspectingProvider = 'apollo';

export type SearchCompaniesInput = {
  organizationId: string;
  companyName: string;
  perPage?: number;
  page?: number;
  provider?: unknown;
};

export type SearchPeopleInput = {
  organizationId: string;
  personTitles?: string[];
  domains?: string[];
  companyNames?: string[];
  personLocations?: string[];
  perPage?: number;
  maxPages?: number;
  onlyVerifiedEmails?: boolean;
  similarTitles?: boolean;
  dedupe?: 'smart' | 'id' | 'email' | 'none';
  includeLockedEmails?: boolean;
  provider?: unknown;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(/[;,]/g).map((item) => item.trim()).filter(Boolean);
}

function normalizeName(value: string) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(grupo|the)\b/g, ' ')
    .replace(/\b(s\.?a\.?|s\.?p\.?a\.?|ltda|llc|inc|corp(oration)?|company|co|gmbh|srl|s\.?l\.?|plc|ag|sa de cv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarityScore(a: string, b: string) {
  if (!a || !b) return 0;
  const first = new Set(a.split(' ').filter(Boolean));
  const second = new Set(b.split(' ').filter(Boolean));
  const inter = [...first].filter((token) => second.has(token)).length;
  const union = new Set([...first, ...second]).size;
  let score = union ? inter / union : 0;
  if (b.startsWith(a) || a.startsWith(b)) score += 0.25;
  if (a.includes(b) || b.includes(a)) score += 0.15;
  return Math.min(score, 1);
}

function cleanDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.+$/, '');
  }
}

function pickBestOrgMatch(targetNameRaw: string, orgs: any[]) {
  const target = normalizeName(targetNameRaw);
  let best: any = null;
  let bestScore = -1;
  for (const org of orgs) {
    const score = similarityScore(target, normalizeName(org?.name || ''));
    if (score > bestScore) {
      bestScore = score;
      best = org;
    }
  }
  return bestScore >= 0.45 ? best : null;
}

async function searchCompaniesApollo(companyName: string, perPage: number, page: number) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY missing');

  const qs = new URLSearchParams();
  qs.set('per_page', String(clamp(perPage, 1, 25)));
  qs.set('page', String(Math.max(1, page)));
  qs.append('q_organization_name', companyName);

  const response = await fetch(`${APOLLO_BASE}/mixed_companies/search?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`apollo_company_search_failed:${response.status}:${text.slice(0, 300)}`);
  }

  const json = await response.json();
  const target = normalizeName(companyName);
  return (Array.isArray(json?.organizations) ? json.organizations : [])
    .map((org: any) => {
      const domain = org.primary_domain || cleanDomain(org.website_url) || undefined;
      return {
        id: org.id,
        name: org.name,
        website_url: org.website_url || (domain ? `https://${domain}` : undefined),
        linkedin_url: org.linkedin_url || org.linkedin_url_clean,
        primary_domain: domain,
        logo: domain ? `https://logo.clearbit.com/${domain}` : undefined,
        score: similarityScore(target, normalizeName(org.name || '')),
      };
    })
    .sort((a: any, b: any) => b.score - a.score);
}

async function resolveDomainFromNameApollo(companyNameRaw: string, apiKey: string): Promise<string | null> {
  const qs = new URLSearchParams();
  qs.set('per_page', '5');
  qs.append('q_organization_name', companyNameRaw);

  const response = await fetch(`${APOLLO_BASE}/mixed_companies/search?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const json = await response.json();
  const orgs = Array.isArray(json?.organizations) ? json.organizations : [];
  if (orgs.length === 0) return null;
  const chosen = pickBestOrgMatch(companyNameRaw, orgs) || orgs[0];
  return chosen?.primary_domain || cleanDomain(chosen?.website_url) || null;
}

function dedupeLeads(leads: LeadFromApollo[], dedupe: SearchPeopleInput['dedupe']) {
  if (dedupe === 'none') return leads;
  const seen = new Set<string>();

  return leads.filter((lead) => {
    const key = dedupe === 'email'
      ? (lead.email && !LOCKED_EMAIL_RE.test(lead.email) ? lead.email.toLowerCase() : '')
      : (lead.id || lead.linkedinUrl || `${lead.fullName}|${lead.companyDomain || lead.companyName}|${lead.title}`).toLowerCase();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchPeopleApollo(input: SearchPeopleInput) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY missing');

  const domainSet = new Set(normalizeList(input.domains).map((domain) => domain.toLowerCase()));
  const companyNames = normalizeList(input.companyNames).map(normalizeName).filter(Boolean);
  for (const name of companyNames) {
    const domain = await resolveDomainFromNameApollo(name, apiKey);
    if (domain) domainSet.add(domain.toLowerCase());
  }

  const domains = Array.from(domainSet);
  if (domains.length === 0) return { leads: [], total: 0, returned: 0, domains };

  const titles = normalizeList(input.personTitles).map(San.sanitizeTitle).filter(Boolean);
  const locations = normalizeList(input.personLocations).map(San.sanitizeLocation).filter(Boolean);
  const perPage = clamp(Number(input.perPage || 25), 1, 50);
  const maxPages = clamp(Number(input.maxPages || 1), 1, 5);
  const leads: LeadFromApollo[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams();
    titles.forEach((title) => qs.append('person_titles[]', title));
    if (titles.length && input.similarTitles !== false) {
      qs.set('person_titles_similar', 'true');
      qs.set('similar_titles', 'true');
    }
    domains.forEach((domain) => qs.append('q_organization_domains_list[]', domain));
    locations.forEach((location) => qs.append('person_locations[]', location));
    if (input.onlyVerifiedEmails !== false) qs.append('contact_email_status[]', 'verified');
    qs.set('per_page', String(perPage));
    qs.set('page', String(page));

    const response = await fetch(`${APOLLO_BASE}/mixed_people/search?${qs.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`apollo_search_failed:${response.status}:${text.slice(0, 300)}`);
    }

    const json = await response.json();
    const people = Array.isArray(json?.people) ? json.people : [];
    for (const person of people) {
      const rawEmail = person.email || undefined;
      const lockedEmail = Boolean(rawEmail && LOCKED_EMAIL_RE.test(rawEmail));
      const email = input.includeLockedEmails === false && lockedEmail ? undefined : rawEmail;
      leads.push({
        id: person.id || person.person_id,
        fullName: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
        title: person.title || person.headline || '',
        email,
        lockedEmail,
        guessedEmail: person.email_status === 'guessed',
        linkedinUrl: person.linkedin_url || undefined,
        location: [person.city, person.state, person.country].filter(Boolean).join(', ') || undefined,
        companyName: person.organization?.name || undefined,
        companyDomain: person.organization?.primary_domain || undefined,
      });
    }

    const totalPages = Number(json?.pagination?.total_pages || 0);
    if (totalPages > 0 && page >= Math.min(totalPages, maxPages)) break;
    if (people.length < perPage) break;
  }

  const final = dedupeLeads(leads, input.dedupe || 'smart');
  return { leads: final, total: leads.length, returned: final.length, domains };
}

export async function searchProspectingCompanies(input: SearchCompaniesInput) {
  const companyName = San.sanitizeName(input.companyName);
  if (!companyName) throw new Error('companyName requerido');

  const providerDecision = resolveLeadProvider({
    requestedProvider: input.provider,
    organizationId: input.organizationId,
  });
  const providerUsed: SupliaProspectingProvider = providerDecision.provider;
  const candidates = await searchCompaniesApollo(companyName, Number(input.perPage || 8), Number(input.page || 1));

  return {
    candidates,
    providerRequested: providerDecision.requestedProvider,
    providerUsed,
    providerDefault: providerDecision.defaultProvider,
    fallbackApplied: false,
    providerForcedReason: providerDecision.forcedApolloReason,
  };
}

export async function searchProspectingPeople(input: SearchPeopleInput) {
  const providerDecision = resolveLeadProvider({
    requestedProvider: input.provider,
    organizationId: input.organizationId,
  });
  const providerUsed: SupliaProspectingProvider = providerDecision.provider;
  const result = await searchPeopleApollo(input);

  return {
    ...result,
    providerRequested: providerDecision.requestedProvider,
    providerUsed,
    providerDefault: providerDecision.defaultProvider,
    fallbackApplied: false,
    providerForcedReason: providerDecision.forcedApolloReason,
  };
}

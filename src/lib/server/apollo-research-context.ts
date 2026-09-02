import { createHash } from 'node:crypto';

import { canonicalJson } from '@/lib/messaging-contracts';
import { NativeResearchLeadSchema, type NativeResearchLead } from '@/lib/native-research-contracts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';

export const APOLLO_RESEARCH_CONTEXT_VERSION = 'apollo-research-context/v1';
export const APOLLO_COMPANY_RESEARCH_CONTEXT_VERSION = 'apollo-company-research-context/v1';

const TABLE_SELECTS = {
  leads: 'id,name,title,linkedin_url,company,company_website,company_linkedin,industry,city,country,source_provider,source_provider_id,apollo_id,last_enriched_at,created_at',
  enriched_leads: 'id,full_name,title,linkedin_url,company_name,organization_domain,organization_industry,organization_size,headline,seniority,departments,city,country,source_provider,source_provider_id,data,updated_at,created_at',
  enriched_opportunities: 'id,full_name,title,linkedin_url,company_name,source_provider,source_provider_id,data,updated_at,created_at',
  people_search_leads: 'id,name,title,linkedin_url,organization_name,org_name,organization_domain,organization_website,organization_industry,industry,organization_size,headline,seniority,departments,city,country,source_provider,source_provider_id,apollo_person_id,updated_at,created_at',
} as const;

type ApolloContextTable = keyof typeof TABLE_SELECTS;
type ApolloContextSource = ApolloContextTable | 'apollo_organization_contexts';
type JsonRecord = Record<string, any>;

export type ApolloResearchContext = {
  schemaVersion: typeof APOLLO_RESEARCH_CONTEXT_VERSION;
  fingerprint: string;
  observedAt: string | null;
  sources: Array<{ table: ApolloContextSource; recordId: string; observedAt: string | null }>;
  person: {
    fullName?: string;
    title?: string;
    headline?: string;
    seniority?: string;
    departments?: string[];
    linkedinUrl?: string;
    city?: string;
    country?: string;
  };
  company: {
    name?: string;
    domain?: string;
    websiteUrl?: string;
    linkedinUrl?: string;
    industry?: string;
    size?: number;
    description?: string;
    keywords?: string[];
    foundedYear?: number;
    annualRevenue?: number;
    totalFunding?: number;
  };
};

export type ApolloCompanyResearchContext = {
  schemaVersion: typeof APOLLO_COMPANY_RESEARCH_CONTEXT_VERSION;
  fingerprint: string;
  observedAt: string | null;
  company: ApolloResearchContext['company'];
};

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength = 2_000) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= maxLength ? normalized : '';
}

function number(value: unknown) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 && normalized <= 10_000_000
    ? normalized
    : undefined;
}

function nonnegativeNumber(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= Number.MAX_SAFE_INTEGER
    ? normalized
    : undefined;
}

function iso(value: unknown) {
  const timestamp = Date.parse(text(value, 64));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function domain(value: unknown) {
  const raw = text(value, 500).toLowerCase();
  if (!raw) return '';
  try {
    const hostname = new URL(raw.includes('://') ? raw : `https://${raw}`).hostname
      .replace(/^www\./, '')
      .replace(/^m\./, '');
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(hostname)
      ? hostname
      : '';
  } catch {
    return '';
  }
}

function httpUrl(value: unknown) {
  try {
    const url = new URL(text(value, 2_048));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function linkedinUrl(value: unknown, company = false) {
  const url = httpUrl(value);
  if (!url) return '';
  const parsed = new URL(url);
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return '';
  if (company && !/^\/company\//i.test(parsed.pathname)) return '';
  return url;
}

function stringArray(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, 160))
    .filter(Boolean)
    .slice(0, 12);
}

function rowObservation(table: ApolloContextTable, rowValue: unknown) {
  const row = object(rowValue);
  const data = object(row.data);
  const organization = object(data.organization);
  const provider = text(row.source_provider || data.sourceProvider, 40).toLowerCase();
  const apolloPersonId = text(
    row.apollo_person_id || row.apollo_id || (provider === 'apollo' ? row.source_provider_id : '')
      || data.apolloId || (text(data.sourceProvider, 40).toLowerCase() === 'apollo' ? data.sourceProviderId : ''),
    255,
  );
  if (provider !== 'apollo' && !apolloPersonId) return null;

  const companyDomain = domain(
    row.organization_domain || data.companyDomain || organization.primary_domain || organization.domain
      || row.organization_website || row.company_website,
  );
  const websiteUrl = httpUrl(row.organization_website || row.company_website || organization.website_url)
    || (companyDomain ? `https://${companyDomain}/` : '');
  const observedAt = iso(data.providerObservedAt || row.last_enriched_at || row.updated_at || row.created_at);
  const recordId = text(row.id, 500);
  if (!recordId) return null;

  return {
    source: { table, recordId, observedAt },
    person: {
      fullName: text(row.full_name || row.name, 300) || undefined,
      title: text(row.title, 2_000) || undefined,
      headline: text(row.headline, 2_000) || undefined,
      seniority: text(row.seniority, 2_000) || undefined,
      departments: stringArray(row.departments).length ? stringArray(row.departments) : undefined,
      linkedinUrl: linkedinUrl(row.linkedin_url) || undefined,
      city: text(row.city, 2_000) || undefined,
      country: text(row.country, 2_000) || undefined,
    },
    company: {
      name: text(row.company_name || row.organization_name || row.org_name || row.company || organization.name, 300) || undefined,
      domain: companyDomain || undefined,
      websiteUrl: websiteUrl || undefined,
      linkedinUrl: linkedinUrl(row.company_linkedin || organization.linkedin_url, true) || undefined,
      industry: text(row.organization_industry || row.industry || organization.industry, 2_000) || undefined,
      size: number(row.organization_size || organization.estimated_num_employees),
      description: text(organization.short_description || data.shortDescription, 2_000) || undefined,
    },
  };
}

function organizationObservation(rowValue: unknown) {
  const row = object(rowValue);
  const organization = object(row.organization_context);
  const companyDomain = domain(organization.primary_domain || row.normalized_domain);
  const recordId = companyDomain;
  if (!recordId) return null;
  return {
    source: {
      table: 'apollo_organization_contexts' as const,
      recordId,
      observedAt: iso(row.observed_at || row.updated_at || row.created_at),
    },
    person: {},
    company: {
      name: text(organization.name, 300) || undefined,
      domain: companyDomain,
      websiteUrl: httpUrl(organization.website_url) || `https://${companyDomain}/`,
      linkedinUrl: linkedinUrl(organization.linkedin_url, true) || undefined,
      industry: text(organization.industry, 2_000) || undefined,
      size: number(organization.estimated_num_employees),
      description: text(organization.short_description, 2_000) || undefined,
      keywords: stringArray(organization.keywords).length ? stringArray(organization.keywords) : undefined,
      foundedYear: number(organization.founded_year),
      annualRevenue: nonnegativeNumber(organization.annual_revenue),
      totalFunding: nonnegativeNumber(organization.total_funding),
    },
  };
}

type ApolloObservation = NonNullable<ReturnType<typeof rowObservation> | ReturnType<typeof organizationObservation>>;

function buildApolloResearchContextFromObservations(observationsValue: ApolloObservation[]) {
  const observations = observationsValue.sort((left, right) => (
    String(left.source.observedAt || '').localeCompare(String(right.source.observedAt || ''))
    || left.source.table.localeCompare(right.source.table)
  ));
  if (observations.length === 0) return null;

  const person: ApolloResearchContext['person'] = {};
  const company: ApolloResearchContext['company'] = {};
  for (const observation of observations) {
    Object.assign(person, Object.fromEntries(Object.entries(observation.person).filter(([, value]) => value != null)));
    Object.assign(company, Object.fromEntries(Object.entries(observation.company).filter(([, value]) => value != null)));
  }
  const sources = observations.map(({ source }) => source);
  const observedAt = sources.map((source) => source.observedAt).filter(Boolean).sort().at(-1) || null;
  const fingerprintPayload: Omit<ApolloResearchContext, 'fingerprint'> = {
    schemaVersion: APOLLO_RESEARCH_CONTEXT_VERSION,
    observedAt,
    sources,
    person,
    company,
  };
  return {
    ...fingerprintPayload,
    fingerprint: `sha256:${createHash('sha256').update(canonicalJson(fingerprintPayload), 'utf8').digest('hex')}`,
  };
}

export function buildApolloResearchContextFromRows(
  rows: Array<{ table: ApolloContextTable; row: unknown }>,
): ApolloResearchContext | null {
  const observations: ApolloObservation[] = rows
    .map(({ table, row }) => rowObservation(table, row))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  return buildApolloResearchContextFromObservations(observations);
}

export function parseApolloResearchContext(value: unknown): ApolloResearchContext | null {
  const input = object(value);
  if (input.schemaVersion !== APOLLO_RESEARCH_CONTEXT_VERSION) return null;
  const rawPerson = object(input.person);
  const rawCompany = object(input.company);
  const person: ApolloResearchContext['person'] = {
    ...(text(rawPerson.fullName, 300) ? { fullName: text(rawPerson.fullName, 300) } : {}),
    ...(text(rawPerson.title, 2_000) ? { title: text(rawPerson.title, 2_000) } : {}),
    ...(text(rawPerson.headline, 2_000) ? { headline: text(rawPerson.headline, 2_000) } : {}),
    ...(text(rawPerson.seniority, 2_000) ? { seniority: text(rawPerson.seniority, 2_000) } : {}),
    ...(stringArray(rawPerson.departments).length ? { departments: stringArray(rawPerson.departments) } : {}),
    ...(linkedinUrl(rawPerson.linkedinUrl) ? { linkedinUrl: linkedinUrl(rawPerson.linkedinUrl) } : {}),
    ...(text(rawPerson.city, 2_000) ? { city: text(rawPerson.city, 2_000) } : {}),
    ...(text(rawPerson.country, 2_000) ? { country: text(rawPerson.country, 2_000) } : {}),
  };
  const companyDomain = domain(rawCompany.domain);
  const company: ApolloResearchContext['company'] = {
    ...(text(rawCompany.name, 300) ? { name: text(rawCompany.name, 300) } : {}),
    ...(companyDomain ? { domain: companyDomain } : {}),
    ...(httpUrl(rawCompany.websiteUrl) ? { websiteUrl: httpUrl(rawCompany.websiteUrl) } : {}),
    ...(linkedinUrl(rawCompany.linkedinUrl, true) ? { linkedinUrl: linkedinUrl(rawCompany.linkedinUrl, true) } : {}),
    ...(text(rawCompany.industry, 2_000) ? { industry: text(rawCompany.industry, 2_000) } : {}),
    ...(number(rawCompany.size) ? { size: number(rawCompany.size) } : {}),
    ...(text(rawCompany.description, 2_000) ? { description: text(rawCompany.description, 2_000) } : {}),
    ...(stringArray(rawCompany.keywords).length ? { keywords: stringArray(rawCompany.keywords) } : {}),
    ...(number(rawCompany.foundedYear) ? { foundedYear: number(rawCompany.foundedYear) } : {}),
    ...(nonnegativeNumber(rawCompany.annualRevenue) != null ? { annualRevenue: nonnegativeNumber(rawCompany.annualRevenue) } : {}),
    ...(nonnegativeNumber(rawCompany.totalFunding) != null ? { totalFunding: nonnegativeNumber(rawCompany.totalFunding) } : {}),
  };
  const sources = (Array.isArray(input.sources) ? input.sources : []).flatMap((rawSource) => {
    const source = object(rawSource);
    const table = text(source.table, 80) as ApolloContextSource;
    const recordId = text(source.recordId, 500);
    if (!(Object.prototype.hasOwnProperty.call(TABLE_SELECTS, table) || table === 'apollo_organization_contexts') || !recordId) return [];
    return [{ table, recordId, observedAt: iso(source.observedAt) }];
  });
  if (sources.length === 0) return null;
  const observedAt = iso(input.observedAt);
  const fingerprintPayload: Omit<ApolloResearchContext, 'fingerprint'> = {
    schemaVersion: APOLLO_RESEARCH_CONTEXT_VERSION,
    observedAt,
    sources,
    person,
    company,
  };
  const fingerprint = `sha256:${createHash('sha256').update(canonicalJson(fingerprintPayload), 'utf8').digest('hex')}`;
  return text(input.fingerprint, 80) === fingerprint ? { ...fingerprintPayload, fingerprint } : null;
}

export function mergeApolloResearchContextIntoLead(
  lead: NativeResearchLead,
  context: ApolloResearchContext | null,
) {
  if (!context) return NativeResearchLeadSchema.parse(lead);
  return NativeResearchLeadSchema.parse({
    ...lead,
    fullName: context.person.fullName || lead.fullName,
    title: context.person.title || lead.title,
    headline: context.person.headline || lead.headline,
    seniority: context.person.seniority || lead.seniority,
    departments: context.person.departments || lead.departments,
    linkedinUrl: context.person.linkedinUrl || lead.linkedinUrl,
    city: context.person.city || lead.city,
    country: context.person.country || lead.country,
    companyName: context.company.name || lead.companyName,
    companyDomain: context.company.domain || lead.companyDomain,
    companyWebsite: context.company.websiteUrl || lead.companyWebsite,
    companyLinkedinUrl: context.company.linkedinUrl || lead.companyLinkedinUrl,
    descriptionSnippet: context.company.description || lead.descriptionSnippet,
    organizationIndustry: context.company.industry || lead.organizationIndustry,
    organizationSize: context.company.size || lead.organizationSize,
  });
}

export function apolloCompanyResearchContext(
  context: ApolloResearchContext | null,
): ApolloCompanyResearchContext | null {
  if (!context || Object.keys(context.company).length === 0) return null;
  const fingerprintPayload: Pick<ApolloCompanyResearchContext, 'schemaVersion' | 'company'> = {
    schemaVersion: APOLLO_COMPANY_RESEARCH_CONTEXT_VERSION,
    company: context.company,
  };
  return {
    ...fingerprintPayload,
    fingerprint: `sha256:${createHash('sha256').update(canonicalJson(fingerprintPayload), 'utf8').digest('hex')}`,
    observedAt: context.observedAt,
  };
}

export async function loadApolloResearchContext(input: {
  organizationId: string;
  userId: string;
  leadId?: string | null;
  companyDomain?: string | null;
}, admin: any = getSupabaseAdminClient()) {
  const organizationId = text(input.organizationId, 36);
  const userId = text(input.userId, 36);
  const leadId = text(input.leadId, 500);
  const requestedCompanyDomain = domain(input.companyDomain);
  if (!organizationId || !userId || (!leadId && !requestedCompanyDomain)) return null;

  const rows = leadId ? await Promise.all((Object.keys(TABLE_SELECTS) as ApolloContextTable[]).map(async (table) => {
    const { data, error } = await admin
      .from(table)
      .select(TABLE_SELECTS[table])
      .eq('id', leadId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data ? { table, row: data } : null;
  })) : [];
  const observations: ApolloObservation[] = rows
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .map(({ table, row }) => rowObservation(table, row))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const companyDomain = requestedCompanyDomain
    || [...observations].reverse().find((observation) => observation.company.domain)?.company.domain
    || '';
  if (companyDomain) {
    const { data, error } = await admin
      .from('apollo_organization_contexts')
      .select('normalized_domain,organization_context,observed_at,updated_at,created_at')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('normalized_domain', companyDomain)
      .maybeSingle();
    if (!error && data) {
      const observation = organizationObservation(data);
      if (observation) observations.push(observation);
    }
  }
  return buildApolloResearchContextFromObservations(observations);
}

export function apolloResearchContextForPrompt(context: ApolloResearchContext | null) {
  if (!context) return null;
  return {
    schemaVersion: context.schemaVersion,
    observedAt: context.observedAt,
    person: {
      fullName: context.person.fullName,
      title: context.person.title,
      headline: context.person.headline,
      seniority: context.person.seniority,
      departments: context.person.departments,
      linkedinUrl: context.person.linkedinUrl,
      city: context.person.city,
      country: context.person.country,
    },
    company: {
      name: context.company.name,
      domain: context.company.domain,
      websiteUrl: context.company.websiteUrl,
      linkedinUrl: context.company.linkedinUrl,
      industry: context.company.industry,
      size: context.company.size,
      description: context.company.description,
      keywords: context.company.keywords,
      foundedYear: context.company.foundedYear,
      annualRevenue: context.company.annualRevenue,
      totalFunding: context.company.totalFunding,
    },
  };
}

export const apolloResearchContextInternals = { TABLE_SELECTS, rowObservation, organizationObservation };

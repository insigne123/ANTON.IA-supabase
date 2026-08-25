import type { GatewayConfig } from './gateway';
import type { EnrichmentInput, LeadSearchInput } from './validation';

const APOLLO_BASE_URL = 'https://api.apollo.io/api/v1';

type JsonRecord = Record<string, unknown>;

export class ApolloGatewayError extends Error {
  constructor(
    readonly status: 502 | 503 | 504,
    readonly code: 'APOLLO_PROVIDER_NOT_CONFIGURED' | 'APOLLO_UPSTREAM_ERROR' | 'APOLLO_UPSTREAM_TIMEOUT' | 'APOLLO_UPSTREAM_INVALID_RESPONSE',
  ) {
    super(code);
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function firstText(...values: unknown[]) {
  return values.map(asText).find(Boolean) || undefined;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeComparable(value: unknown) {
  return asText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const INDUSTRY_ALIASES: Record<string, string> = {
  'recursos humanos': 'human resources',
  tecnologia: 'technology',
  salud: 'healthcare',
  finanzas: 'finance',
  fabricacion: 'manufacturing',
  educacion: 'education',
  construccion: 'construction',
};

const INDUSTRY_TAG_IDS = Object.fromEntries(Object.entries({
  'Human Resources': '5567e0e37369640e5ac10c00',
  Technology: '5494458a746564006c840200',
  Healthcare: '5494458a746564006c840100',
  Finance: '5494458a746564006c840000',
  Manufacturing: '5494458a746564006c840300',
  Retail: '5567ced173696450cb580000',
  Education: '5494458a746564006c840500',
  Accounting: '5567ce1f7369643b78570000',
  'Architecture & Planning': '5567cdb77369645401080000',
  'Apparel & Fashion': '5567cd82736964540d0b0000',
  Automotive: '5567cdf27369644cfd800000',
  'Building Materials': '5567e1a17369641ea9d30100',
  Biotechnology: '5567d08e7369645dbc4b0000',
  'Environment Services': '5567ce5b736964540d280000',
  'Electrical/Electronic Manufacturing': '5567cd4c73696439c9030000',
  'Computer Software': '5567cd4e7369643b70010000',
  Entertainment: '5567cdd37369643b80510000',
  'Education Management': '5567ce9e736964540d540000',
  Construction: '5567cd4773696439dd350000',
  'Financial Services': '5567cdd67369643e64020000',
  'Government Administration': '5567cd527369643981050000',
  Hospitality: '5567ce9d7369643bc19c0000',
  'Health, Wellness & Fitness': '5567cddb7369644d250c0000',
  'Higher Education': '5567cd4c73696453e1300000',
  'Information Services': '5567e0c97369640d2b3b1600',
}).map(([name, id]) => [normalizeComparable(name), id])) as Record<string, string>;

function canonicalIndustry(value: unknown) {
  const normalized = normalizeComparable(value);
  return INDUSTRY_ALIASES[normalized] || normalized;
}

export function resolveApolloIndustryFilters(requestedIndustries: string[]) {
  const tagIds = new Set<string>();
  const keywordFallbacks = new Set<string>();

  for (const requestedIndustry of requestedIndustries) {
    const canonical = canonicalIndustry(requestedIndustry);
    const tagId = INDUSTRY_TAG_IDS[canonical];
    if (tagId) tagIds.add(tagId);
    else if (requestedIndustry.trim()) keywordFallbacks.add(requestedIndustry.trim());
  }

  return { tagIds: [...tagIds], keywordFallbacks: [...keywordFallbacks] };
}

function buildPhoneNumbers(person: JsonRecord) {
  const candidates: Array<{ value: unknown; type: string }> = [
    ...asArray(person.phone_numbers).map((value) => ({ value, type: 'phone' })),
    { value: person.phone_number, type: 'phone' },
    { value: person.mobile_phone, type: 'mobile' },
    { value: person.work_phone, type: 'work' },
  ];
  const unique = new Map<string, { raw_number: string; sanitized_number: string; type: string }>();

  for (const candidate of candidates) {
    const record = asRecord(candidate.value);
    const phone = record
      ? firstText(record.sanitized_number, record.raw_number, record.number, record.phone_number)
      : asText(candidate.value);
    if (!phone || unique.has(phone)) continue;
    unique.set(phone, {
      raw_number: phone,
      sanitized_number: phone,
      type: firstText(record?.type, record?.type_cd) || candidate.type,
    });
    if (unique.size >= 10) break;
  }

  return [...unique.values()];
}

function mapPersonToLead(
  value: unknown,
  organizations: Array<NonNullable<ReturnType<typeof mapOrganization>>> = [],
) {
  const person = asRecord(value);
  if (!person) return null;

  const organization = asRecord(person.organization) || {};
  const organizationId = firstText(organization.id, person.organization_id);
  const organizationName = firstText(organization.name, person.organization_name);
  const organizationContext = organizations.find((candidate) => (
    (organizationId && candidate.id === organizationId)
    || (organizationName && normalizeComparable(candidate.name) === normalizeComparable(organizationName))
  ));
  const id = firstText(person.id, person.person_id, person.apollo_id, person.linkedin_url);
  if (!id) return null;

  const firstName = firstText(person.first_name);
  const lastName = firstText(person.last_name, person.last_name_obfuscated);
  const fullName = firstText(person.name, person.full_name, [firstName, lastName].filter(Boolean).join(' '));
  const organizationDomain = firstText(
    organization.primary_domain,
    organization.domain,
    person.organization_domain,
    organizationContext?.primary_domain,
  );
  const organizationIndustry = firstText(
    organization.industry,
    person.organization_industry,
    organizationContext?.industry,
  );
  const phoneNumbers = buildPhoneNumbers(person);

  return {
    id,
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    email: firstText(person.email, person.work_email),
    email_status: firstText(person.email_status),
    title: firstText(person.title, person.headline),
    headline: firstText(person.headline),
    linkedin_url: firstText(person.linkedin_url),
    photo_url: firstText(person.photo_url, person.photoUrl),
    apollo_id: firstText(person.id, person.person_id, person.apollo_id),
    city: firstText(person.city),
    state: firstText(person.state),
    country: firstText(person.country),
    seniority: firstText(person.seniority),
    departments: asArray(person.departments).map(asText).filter(Boolean).slice(0, 20),
    primary_phone: firstText(person.phone_number, person.mobile_phone, person.work_phone) || phoneNumbers[0]?.sanitized_number,
    phone_numbers: phoneNumbers,
    organization_name: firstText(organization.name, person.organization_name, organizationContext?.name),
    organization_domain: organizationDomain,
    organization_industry: organizationIndustry,
    organization_size: asNumber(
      organization.estimated_num_employees
      ?? person.organization_size
      ?? organizationContext?.estimated_num_employees,
    ),
    organization: {
      id: firstText(organization.id, person.organization_id, organizationContext?.id),
      name: firstText(organization.name, person.organization_name, organizationContext?.name),
      domain: organizationDomain,
      industry: organizationIndustry,
      website_url: firstText(organization.website_url, person.organization_website, organizationContext?.website_url),
      linkedin_url: firstText(organization.linkedin_url, organizationContext?.linkedin_url),
    },
  };
}

function mapOrganization(value: unknown) {
  const organization = asRecord(value);
  if (!organization) return null;
  const id = firstText(organization.id);
  const name = firstText(organization.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    primary_domain: firstText(organization.primary_domain, organization.domain),
    website_url: firstText(organization.website_url),
    linkedin_url: firstText(organization.linkedin_url, organization.linkedin_url_clean),
    industry: firstText(organization.industry),
    estimated_num_employees: asNumber(organization.estimated_num_employees),
    city: firstText(organization.city),
    state: firstText(organization.state),
    country: firstText(organization.country),
  };
}

async function requestApollo(path: string, payload: JsonRecord, apiKey: string, config: GatewayConfig) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);
  let response: Response;

  try {
    response = await fetch(`${APOLLO_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': apiKey,
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') {
      throw new ApolloGatewayError(504, 'APOLLO_UPSTREAM_TIMEOUT');
    }
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    await response.text().catch(() => '');
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_ERROR');
  }

  try {
    const payload = await response.json();
    const record = asRecord(payload);
    if (!record) throw new Error('invalid response');
    return record;
  } catch {
    throw new ApolloGatewayError(502, 'APOLLO_UPSTREAM_INVALID_RESPONSE');
  }
}

function appendAll(params: URLSearchParams, key: string, values: string[]) {
  for (const value of values) params.append(key, value);
}

async function searchPeople(params: {
  input: LeadSearchInput;
  domains?: string[];
  organizationIds?: string[];
  apiKey: string;
  config: GatewayConfig;
  organizations?: Array<NonNullable<ReturnType<typeof mapOrganization>>>;
}) {
  const organizationIdChunks = params.organizationIds?.length
    ? Array.from({ length: Math.ceil(params.organizationIds.length / 50) }, (_, index) => (
      params.organizationIds!.slice(index * 50, (index + 1) * 50)
    ))
    : [[]];
  const people = new Map<string, NonNullable<ReturnType<typeof mapPersonToLead>>>();
  const industryFilters = resolveApolloIndustryFilters(params.input.industryKeywords);

  for (const organizationIds of organizationIdChunks) {
    const remaining = params.input.maxResults - people.size;
    if (remaining <= 0) break;

    const query = new URLSearchParams();
    query.set('per_page', String(Math.min(100, remaining)));
    query.set('page', '1');
    appendAll(query, 'person_titles[]', params.input.titles);
    if (params.input.titles.length > 0) {
      query.set('include_similar_titles', String(params.input.includeSimilarTitles));
    }
    appendAll(query, 'person_seniorities[]', params.input.seniorities);
    appendAll(query, 'person_locations[]', params.input.personLocations);
    appendAll(query, 'organization_locations[]', params.input.companyLocations);
    appendAll(query, 'organization_num_employees_ranges[]', params.input.employeeRanges);
    appendAll(query, 'q_organization_domains_list[]', params.domains || []);
    appendAll(query, 'organization_ids[]', organizationIds);
    // Verified against People API Search on 2026-08-25; Apollo's public OpenAPI currently omits these filters.
    // Keep the request fail-closed so a provider contract change cannot return an unfiltered lead set.
    appendAll(query, 'organization_industry_tag_ids[]', industryFilters.tagIds);
    appendAll(query, 'q_organization_keyword_tags[]', [
      ...params.input.companyKeywords,
      ...industryFilters.keywordFallbacks,
    ]);

    const payload = await requestApollo(`/mixed_people/api_search?${query.toString()}`, {}, params.apiKey, params.config);
    for (const value of asArray(payload.people)) {
      const person = mapPersonToLead(value, params.organizations);
      if (person && !people.has(person.id)) people.set(person.id, person);
      if (people.size >= params.input.maxResults) break;
    }
  }

  return [...people.values()];
}

async function findOrganizations(name: string, apiKey: string, config: GatewayConfig) {
  const query = new URLSearchParams();
  query.set('per_page', '5');
  query.set('page', '1');
  query.set('q_organization_name', name);
  const payload = await requestApollo(`/mixed_companies/search?${query.toString()}`, {}, apiKey, config);
  return asArray(payload.organizations)
    .map(mapOrganization)
    .filter((organization): organization is NonNullable<typeof organization> => organization !== null);
}

export function getApolloApiKey(environment: Record<string, string | undefined> = process.env) {
  return String(environment.APOLLO_API_KEY || '').trim();
}

export async function executeLeadSearch(input: LeadSearchInput, apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');

  if (input.searchMode === 'linkedin_profile') {
    const payload = await requestApollo('/people/match', {
      linkedin_url: input.linkedinUrl!,
      reveal_personal_emails: input.revealEmail,
      reveal_phone_number: input.revealPhone,
    }, apiKey, config);
    const matchedLead = mapPersonToLead(payload.person);
    const lead = matchedLead && {
      ...matchedLead,
      email: input.revealEmail ? matchedLead.email : undefined,
      email_status: input.revealEmail ? matchedLead.email_status : undefined,
      primary_phone: input.revealPhone ? matchedLead.primary_phone : undefined,
      phone_numbers: input.revealPhone ? matchedLead.phone_numbers : [],
    };
    const phoneNumbers = lead?.phone_numbers || [];
    return {
      count: lead ? 1 : 0,
      leads: lead ? [lead] : [],
      search_mode: 'linkedin_profile',
      requested_reveal: { email: input.revealEmail, phone: input.revealPhone },
      applied_reveal: { email: input.revealEmail, phone: input.revealPhone },
      effective_reveal: {
        email: Boolean(lead?.email),
        phone: phoneNumbers.length > 0 || Boolean(lead?.primary_phone),
      },
    };
  }

  if (input.searchMode === 'company_name') {
    const domains = [...input.organizationDomains];
    const organizationIds = input.selectedOrganizationId ? [input.selectedOrganizationId] : [];
    let candidates: Array<NonNullable<ReturnType<typeof mapOrganization>>> = [];

    if (domains.length === 0 && organizationIds.length === 0 && input.companyName) {
      candidates = await findOrganizations(input.companyName, apiKey, config);
      if (candidates.length === 0) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name',
          company_name: input.companyName,
          organization_candidates: [],
        };
      }
      if (candidates.length > 1) {
        return {
          count: 0,
          leads: [],
          search_mode: 'company_name',
          company_name: input.companyName,
          requires_organization_selection: true,
          organization_candidates: candidates,
        };
      }
      if (candidates.length === 1) {
        if (candidates[0].primary_domain) domains.push(candidates[0].primary_domain);
        else organizationIds.push(candidates[0].id);
      }
    }

    const organizationContext = candidates.length === 1 ? candidates : [];
    const leads = await searchPeople({
      input,
      domains,
      organizationIds,
      apiKey,
      config,
      organizations: organizationContext,
    });
    return {
      count: leads.length,
      leads,
      search_mode: 'company_name',
      company_name: input.companyName || input.selectedOrganizationName,
      enrichment_requested: false,
      ...(organizationContext.length === 1 ? { selected_organization: organizationContext[0] } : {}),
    };
  }

  const leads = await searchPeople({ input, apiKey, config });
  return {
    count: leads.length,
    leads,
    search_mode: 'batch',
    search_strategy: 'people',
    enrichment_requested: false,
  };
}

export async function executeEnrichment(input: EnrichmentInput, apiKey: string, config: GatewayConfig) {
  if (!apiKey) throw new ApolloGatewayError(503, 'APOLLO_PROVIDER_NOT_CONFIGURED');

  const payload: JsonRecord = {
    reveal_personal_emails: input.revealEmail,
    reveal_phone_number: input.revealPhone,
  };
  const personId = input.lead.apolloId || input.lead.id;
  if (personId) payload.id = personId;
  if (input.lead.linkedinUrl) payload.linkedin_url = input.lead.linkedinUrl;
  if (input.lead.firstName) payload.first_name = input.lead.firstName;
  if (input.lead.lastName) payload.last_name = input.lead.lastName;
  if (input.lead.fullName && !input.lead.firstName) payload.name = input.lead.fullName;
  if (input.lead.organizationName) payload.organization_name = input.lead.organizationName;
  if (input.lead.organizationDomain) payload.organization_domain = input.lead.organizationDomain;

  const response = await requestApollo('/people/match', payload, apiKey, config);
  const lead = mapPersonToLead(response.person);
  if (!lead) {
    return {
      success: false,
      enrichment_status: 'not_found',
      extracted_data: null,
    };
  }

  const phoneNumbers = lead.phone_numbers || [];
  return {
    success: true,
    enrichment_status: input.revealPhone && phoneNumbers.length === 0 && !lead.primary_phone ? 'pending_phone' : 'completed',
    extracted_data: {
      first_name: lead.first_name,
      last_name: lead.last_name,
      full_name: lead.name,
      email: input.revealEmail ? lead.email : null,
      email_status: input.revealEmail ? lead.email_status : null,
      title: lead.title,
      linkedin_url: lead.linkedin_url,
      organization_name: lead.organization_name,
      organization_domain: lead.organization_domain,
      organization_industry: lead.organization_industry,
      organization_size: lead.organization_size,
      city: lead.city,
      state: lead.state,
      country: lead.country,
      headline: lead.headline,
      photo_url: lead.photo_url,
      seniority: lead.seniority,
      departments: lead.departments,
      primary_phone: input.revealPhone ? lead.primary_phone : null,
      phone_numbers: input.revealPhone ? phoneNumbers : [],
      enrichment_status: input.revealPhone && phoneNumbers.length === 0 && !lead.primary_phone ? 'pending_phone' : 'completed',
    },
  };
}

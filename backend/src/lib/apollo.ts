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
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
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

function mapPersonToLead(value: unknown) {
  const person = asRecord(value);
  if (!person) return null;

  const organization = asRecord(person.organization) || {};
  const id = firstText(person.id, person.person_id, person.apollo_id, person.linkedin_url);
  if (!id) return null;

  const firstName = firstText(person.first_name);
  const lastName = firstText(person.last_name);
  const fullName = firstText(person.name, person.full_name, [firstName, lastName].filter(Boolean).join(' '));
  const organizationDomain = firstText(organization.primary_domain, organization.domain, person.organization_domain);
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
    organization_name: firstText(organization.name, person.organization_name),
    organization_domain: organizationDomain,
    organization_industry: firstText(organization.industry, person.organization_industry),
    organization_size: asNumber(organization.estimated_num_employees ?? person.organization_size),
    organization: {
      id: firstText(organization.id, person.organization_id),
      name: firstText(organization.name, person.organization_name),
      domain: organizationDomain,
      industry: firstText(organization.industry, person.organization_industry),
      website_url: firstText(organization.website_url, person.organization_website),
      linkedin_url: firstText(organization.linkedin_url),
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
}) {
  const query = new URLSearchParams();
  query.set('per_page', String(params.input.maxResults));
  query.set('page', '1');
  appendAll(query, 'person_titles[]', params.input.titles);
  appendAll(query, 'person_seniorities[]', params.input.seniorities);
  appendAll(query, 'q_organization_keyword_tags[]', params.input.industryKeywords);
  appendAll(query, 'organization_locations[]', params.input.companyLocations);
  appendAll(query, 'organization_num_employees_ranges[]', params.input.employeeRanges);
  appendAll(query, 'q_organization_domains_list[]', params.domains || []);
  appendAll(query, 'q_organization_ids[]', params.organizationIds || []);

  const payload = await requestApollo(`/mixed_people/search?${query.toString()}`, {}, params.apiKey, params.config);
  return asArray(payload.people)
    .map(mapPersonToLead)
    .filter((person): person is NonNullable<typeof person> => person !== null)
    .slice(0, params.input.maxResults);
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

    const leads = await searchPeople({ input, domains, organizationIds, apiKey, config });
    return {
      count: leads.length,
      leads,
      search_mode: 'company_name',
      company_name: input.companyName || input.selectedOrganizationName,
      ...(candidates.length === 1 ? { selected_organization: candidates[0] } : {}),
    };
  }

  const leads = await searchPeople({ input, apiKey, config });
  return {
    count: leads.length,
    leads,
    search_mode: 'batch',
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

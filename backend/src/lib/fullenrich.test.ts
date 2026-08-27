import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FullEnrichGatewayError,
  executeFullEnrichLeadSearch,
  getFullEnrichApiKey,
} from './fullenrich';
import { getGatewayConfig } from './gateway';
import { executeProviderLeadSearch } from './lead-provider';
import { validateLeadSearchInput } from './validation';

function requestBody(init?: RequestInit) {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(init.body) as Record<string, unknown>;
}

test('FullEnrich batch search uses v2 Bearer auth and preserves normalized leads', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return Response.json({
      people: [{
        id: 'person-1',
        full_name: 'Ana Perez',
        first_name: 'Ana',
        last_name: 'Perez',
        headline: 'People leader',
        location: { city: 'Santiago', region: 'Santiago Metropolitan', country: 'Chile' },
        social_profiles: { professional_network: { url: 'https://www.linkedin.com/in/ana-perez' } },
        employment: {
          current: {
            title: 'HR Director',
            seniority: 'Director',
            job_functions: [{ function: 'Human Resources' }],
            company: {
              id: 'company-1',
              name: 'People Co',
              domain: 'people.co',
              website: 'https://people.co',
              headcount: 120,
              industry: { main_industry: 'Human Resources Services' },
            },
          },
        },
      }],
    });
  };

  try {
    const config = getGatewayConfig({
      LEADS_PROVIDER_DEFAULT: 'fullenrich',
      APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100',
    });
    const parsed = validateLeadSearchInput({
      provider: 'fullenrich',
      search_mode: 'batch',
      industry_keywords: ['Human Resources Services'],
      company_keywords: ['payroll'],
      company_location: ['Chile'],
      person_locations: ['Santiago'],
      employee_ranges: ['51-200'],
      titles: ['HR Director'],
      seniorities: ['Director'],
      include_similar_titles: false,
      max_results: 25,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeProviderLeadSearch(parsed.value, config, {
      FULLENRICH_API_KEY: 'fullenrich-test-key',
    });
    assert.equal(result.count, 1);
    assert.equal(result.search_mode, 'batch');
    assert.equal(result.leads[0]?.name, 'Ana Perez');
    assert.equal(result.leads[0]?.title, 'HR Director');
    assert.equal(result.leads[0]?.organization_domain, 'people.co');
    assert.equal(result.leads[0]?.organization_industry, 'Human Resources Services');
    assert.equal(result.leads[0]?.organization_size, 120);
    assert.deepEqual(result.leads[0]?.phone_numbers, []);
    assert.equal(result.leads[0]?.source_provider, 'fullenrich');
    assert.equal(result.leads[0]?.source_provider_id, 'person-1');

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.pathname, '/api/v2/people/search');
    assert.equal(requests[0]?.init?.method, 'POST');
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer fullenrich-test-key');
    assert.equal(headers.get('x-api-key'), null);
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.deepEqual(requestBody(requests[0]?.init), {
      limit: 25,
      current_position_titles: [{ value: 'HR Director', exact_match: true }],
      current_position_seniority_level: [{ value: 'Director', exact_match: false }],
      current_company_industries: [{ value: 'Human Resources Services', exact_match: false }],
      current_company_specialties: [{ value: 'payroll', exact_match: false }],
      current_company_headquarters: [{ value: 'Chile', exact_match: false }],
      current_company_headcounts: [{ min: 51, max: 200 }],
      person_locations: [{ value: 'Santiago', exact_match: false }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich company searches resolve a provider company before people search', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });

    if (url.pathname.endsWith('/company/search')) {
      return Response.json({
        companies: [{
          id: 'company-1',
          name: 'People Co',
          domain: 'people.co',
          website: 'https://people.co',
          headcount: 120,
          industry: { main_industry: 'Human Resources Services' },
          locations: { headquarters: { city: 'Santiago', region: 'Santiago Metropolitan', country: 'Chile' } },
          social_profiles: { professional_network: { url: 'https://www.linkedin.com/company/people-co' } },
        }],
      });
    }

    if (url.pathname.endsWith('/people/search')) {
      return Response.json({
        people: [{
          id: 'person-1',
          full_name: 'Ana Perez',
          employment: { current: { title: 'HR Director', company: { name: 'People Co' } } },
        }],
      });
    }

    throw new Error(`Unexpected FullEnrich request: ${url.pathname}`);
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      provider: 'fullenrich',
      search_mode: 'company_name',
      company_name: 'People Co',
      max_results: 10,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeProviderLeadSearch(parsed.value, config, {
      FULLENRICH_API_KEY: 'fullenrich-test-key',
    });
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.organization_name, 'People Co');
    assert.equal(result.leads[0]?.organization_domain, 'people.co');
    assert.equal(result.leads[0]?.organization_industry, 'Human Resources Services');
    assert.equal(result.leads[0]?.organization_size, 120);

    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.url.pathname, '/api/v2/company/search');
    assert.deepEqual(requestBody(requests[0]?.init), {
      limit: 5,
      names: [{ value: 'People Co', exact_match: false }],
    });
    assert.equal(requests[1]?.url.pathname, '/api/v2/people/search');
    assert.deepEqual(requestBody(requests[1]?.init), {
      limit: 10,
      current_company_domains: [{ value: 'people.co', exact_match: true }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich profile searches use people lookup without claiming contact reveals', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return Response.json({
      people: [{
        id: 'person-1',
        full_name: 'Ana Perez',
        social_profiles: { professional_network: { url: 'https://www.linkedin.com/in/ana-perez' } },
        employment: { current: { title: 'HR Director', company: { name: 'People Co' } } },
      }],
    });
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      provider: 'fullenrich',
      search_mode: 'linkedin_profile',
      linkedin_url: 'https://www.linkedin.com/in/ana-perez',
      reveal_email: true,
      reveal_phone: true,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeFullEnrichLeadSearch(parsed.value, 'fullenrich-test-key', config);
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.email, undefined);
    assert.deepEqual(result.requested_reveal, { email: true, phone: true });
    assert.deepEqual(result.applied_reveal, { email: false, phone: false });
    assert.deepEqual(result.effective_reveal, { email: false, phone: false });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.pathname, '/api/v2/people/lookup');
    assert.deepEqual(requestBody(requests[0]?.init), {
      person_professional_network_url: 'https://www.linkedin.com/in/ana-perez',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich maps missing configuration and aborted requests without exposing upstream details', async () => {
  const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
  const parsed = validateLeadSearchInput({
    provider: 'fullenrich',
    search_mode: 'batch',
    titles: ['Founder'],
  }, config);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(getFullEnrichApiKey({ FULLENRICH_API_KEY: ' fullenrich-test-key ' }), 'fullenrich-test-key');
  await assert.rejects(
    () => executeFullEnrichLeadSearch(parsed.value, '', config),
    (error: unknown) => {
      assert.ok(error instanceof FullEnrichGatewayError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'FULLENRICH_PROVIDER_NOT_CONFIGURED');
      return true;
    },
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };

  try {
    await assert.rejects(
      () => executeFullEnrichLeadSearch(parsed.value, 'fullenrich-test-key', config),
      (error: unknown) => {
        assert.ok(error instanceof FullEnrichGatewayError);
        assert.equal(error.status, 504);
        assert.equal(error.code, 'FULLENRICH_UPSTREAM_TIMEOUT');
        assert.equal(error.message.includes('aborted'), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

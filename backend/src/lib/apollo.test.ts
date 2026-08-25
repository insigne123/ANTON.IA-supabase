import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLeadSearch, resolveApolloIndustryFilters } from './apollo';
import { getGatewayConfig } from './gateway';
import { validateLeadSearchInput } from './validation';

test('industry filters resolve canonical tags and preserve unknown values as keywords', () => {
  assert.deepEqual(resolveApolloIndustryFilters(['Recursos Humanos', 'Computer Software', 'SaaS']), {
    tagIds: ['5567e0e37369640e5ac10c00', '5567cd4e7369643b70010000'],
    keywordFallbacks: ['SaaS'],
  });
});

test('filtered search uses exact industry tags and never enriches people', async () => {
  const requests: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);

    if (url.pathname.endsWith('/mixed_people/api_search')) {
      return Response.json({
        total_entries: 1,
        people: [{
          id: 'person-1',
          first_name: 'Ana',
          last_name_obfuscated: 'Pe***z',
          title: 'HR Director',
          organization: { name: 'People Co' },
        }],
      });
    }

    throw new Error(`Unexpected Apollo request: ${url.pathname}`);
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      search_mode: 'batch',
      industry_keywords: ['Human Resources'],
      company_keywords: ['payroll'],
      company_location: ['Chile'],
      person_locations: ['Santiago'],
      employee_ranges: ['51-200'],
      titles: ['HR Director'],
      include_similar_titles: false,
      max_results: 25,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeLeadSearch(parsed.value, 'test-key', config);
    assert.equal(result.count, 1);
    assert.equal('enrichment_requested' in result && result.enrichment_requested, false);
    assert.equal('search_strategy' in result && result.search_strategy, 'people');
    assert.equal(result.leads[0]?.name, 'Ana Pe***z');
    assert.equal(result.leads[0]?.organization_industry, undefined);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.pathname, '/api/v1/mixed_people/api_search');
    assert.deepEqual(requests[0]?.searchParams.getAll('organization_industry_tag_ids[]'), ['5567e0e37369640e5ac10c00']);
    assert.deepEqual(requests[0]?.searchParams.getAll('q_organization_keyword_tags[]'), ['payroll']);
    assert.deepEqual(requests[0]?.searchParams.getAll('organization_num_employees_ranges[]'), ['51,200']);
    assert.deepEqual(requests[0]?.searchParams.getAll('person_locations[]'), ['Santiago']);
    assert.equal(requests[0]?.searchParams.get('include_similar_titles'), 'false');
    assert.equal(requests.some((url) => url.pathname.includes('/people/match')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('company search uses an authoritative organization id without browser-supplied domain context', async () => {
  const requests: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return Response.json({
      total_entries: 1,
      people: [{
        id: 'person-1',
        first_name: 'Ana',
        organization: { name: 'People Co' },
      }],
    });
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      search_mode: 'company_name',
      selected_organization_id: 'org-1',
      selected_organization_name: 'People Co',
      selected_organization_domain: 'people.co',
      selected_organization_website: 'https://people.co/about',
      selected_organization_industry: 'Human Resources',
      selected_organization_size: 120,
      max_results: 10,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeLeadSearch(parsed.value, 'test-key', config);
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.organization_name, 'People Co');
    assert.equal(result.leads[0]?.organization_domain, undefined);
    assert.equal(result.leads[0]?.organization_industry, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.pathname, '/api/v1/mixed_people/api_search');
    assert.deepEqual(requests[0]?.searchParams.getAll('organization_ids[]'), ['org-1']);
    assert.equal(requests[0]?.searchParams.has('q_organization_domains_list[]'), false);
    assert.equal(requests[0]?.searchParams.has('q_organization_ids[]'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('company lookup backfills only provider-returned organization context', async () => {
  const requests: URL[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith('/mixed_companies/search')) {
      return Response.json({
        organizations: [{
          id: 'org-1',
          name: 'People Co',
          primary_domain: 'people.co',
          website_url: 'https://people.co',
          industry: 'Human Resources',
          estimated_num_employees: null,
        }],
      });
    }
    return Response.json({
      people: [{ id: 'person-1', first_name: 'Ana', organization: { name: 'People Co' } }],
    });
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      search_mode: 'company_name',
      company_name: 'People Co',
      max_results: 10,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeLeadSearch(parsed.value, 'test-key', config);
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.organization_domain, 'people.co');
    assert.equal(result.leads[0]?.organization_industry, 'Human Resources');
    assert.equal(result.leads[0]?.organization_size, undefined);
    assert.equal(result.leads[0]?.organization.website_url, 'https://people.co');
    assert.equal('selected_organization' in result && result.selected_organization?.id, 'org-1');
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

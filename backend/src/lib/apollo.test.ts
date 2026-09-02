import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ApolloGatewayError,
  executeApolloEnrichment,
  executeApolloOrganizationEnrichment,
  getApolloApiKey,
  getApolloUsageSnapshot,
  getApolloWebhookResult,
  resolveApolloIndustryFilters,
} from './apollo';
import { getGatewayConfig } from './gateway';
import { executeProviderLeadSearch } from './lead-provider';
import { validateEnrichmentInput, validateLeadSearchInput } from './validation';

test('industry filters resolve canonical tags and preserve unknown keywords', () => {
  assert.deepEqual(resolveApolloIndustryFilters(['Recursos Humanos', 'Computer Software', 'SaaS']), {
    tagIds: ['5567e0e37369640e5ac10c00', '5567cd4e7369643b70010000'],
    keywordFallbacks: ['SaaS'],
  });
});

test('people search uses Apollo query filters and strips accidental contact data', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      people: [{
        id: 'person-1',
        first_name: 'Ana',
        last_name_obfuscated: 'Pe***z',
        title: 'HR Director',
        email: 'must-not-leak@example.test',
        phone_number: '+15550100001',
        has_email: true,
        has_direct_phone: true,
        organization: { name: 'People Co' },
      }],
    });
  };

  try {
    const config = getGatewayConfig({ APOLLO_BACKEND_MAX_SEARCH_RESULTS: '100' });
    const parsed = validateLeadSearchInput({
      provider: 'apollo',
      search_mode: 'batch',
      industry_keywords: ['Human Resources'],
      company_keywords: ['payroll'],
      person_locations: ['Santiago'],
      employee_ranges: ['51-200'],
      titles: ['HR Director'],
      include_similar_titles: false,
      max_results: 25,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeProviderLeadSearch(parsed.value, config, { APOLLO_API_KEY: 'apollo-test-key' });
    assert.equal(result.count, 1);
    assert.equal(result.leads[0]?.name, 'Ana Pe***z');
    assert.equal(result.leads[0]?.email, undefined);
    assert.equal(result.leads[0]?.primary_phone, undefined);
    assert.deepEqual(result.leads[0]?.phone_numbers, []);
    assert.equal(result.leads[0]?.has_email, true);
    assert.equal(result.leads[0]?.source_provider, 'apollo');

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.pathname, '/api/v1/mixed_people/api_search');
    assert.deepEqual(requests[0]?.url.searchParams.getAll('organization_industry_tag_ids[]'), ['5567e0e37369640e5ac10c00']);
    assert.deepEqual(requests[0]?.url.searchParams.getAll('q_organization_keyword_tags[]'), ['payroll']);
    assert.deepEqual(requests[0]?.url.searchParams.getAll('organization_num_employees_ranges[]'), ['51,200']);
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('x-api-key'), 'apollo-test-key');
    assert.equal(headers.get('authorization'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('company search accounts for its page credit and reuses provider organization context', async () => {
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
        }],
      });
    }
    return Response.json({
      people: [{ id: 'person-1', first_name: 'Ana', organization: { name: 'People Co' } }],
    });
  };

  try {
    const config = getGatewayConfig();
    const parsed = validateLeadSearchInput({
      search_mode: 'company_name',
      company_name: 'People Co',
      max_results: 10,
    }, config);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeProviderLeadSearch(parsed.value, config, { APOLLO_API_KEY: 'apollo-test-key' });
    assert.equal(result.count, 1);
    assert.equal(result.organization_search_credits, 1);
    assert.equal(result.leads[0]?.organization_domain, 'people.co');
    assert.equal(requests[0]?.pathname, '/api/v1/mixed_companies/search');
    assert.equal(requests[1]?.pathname, '/api/v1/mixed_people/api_search');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('standard enrichment uses query params, disables waterfall, and keeps phone asynchronous', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      request_id: '-9223372036854775807',
      credits_consumed: 1,
      person: {
        id: 'person-1',
        first_name: 'Ana',
        email: 'ana@example.test',
        email_status: 'verified',
        organization: { id: 'org-1', name: 'People Co', primary_domain: 'people.co' },
      },
    });
  };

  try {
    const parsed = validateEnrichmentInput({
      lead: { source_provider_id: 'person-1' },
      reveal_email: true,
      reveal_phone: true,
      enrichment_level: 'deep',
      webhook_url: 'https://studio.example.com/api/apollo-webhook/opaque-token',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const result = await executeApolloEnrichment(parsed.value, 'apollo-test-key', getGatewayConfig());
    assert.equal(result.success, true);
    assert.equal(result.enrichment_status, 'pending_phone');
    assert.equal(result.provider_request_id, '-9223372036854775807');
    assert.equal(result.extracted_data?.email, 'ana@example.test');

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url.pathname, '/api/v1/people/match');
    assert.equal(requests[0]?.url.searchParams.get('id'), 'person-1');
    assert.equal(requests[0]?.url.searchParams.get('reveal_phone_number'), 'true');
    assert.equal(requests[0]?.url.searchParams.get('run_waterfall_email'), 'false');
    assert.equal(requests[0]?.url.searchParams.get('run_waterfall_phone'), 'false');
    assert.equal(requests[0]?.url.searchParams.get('webhook_url'), 'https://studio.example.com/api/apollo-webhook/opaque-token');
    assert.equal(requests[0]?.init?.body, '{}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook result polling preserves signed request ids and exposes normalized candidates', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      request_id: '-9223372036854775807',
      status: 'completed',
      person: {
        id: 'person-1',
        phone_numbers: [{ sanitized_number: '+15550100001', type: 'mobile' }],
      },
    });
  };

  try {
    const result = await getApolloWebhookResult('-9223372036854775807', 'apollo-test-key', getGatewayConfig());
    assert.equal(result.provider_request_id, '-9223372036854775807');
    assert.equal(result.status, 'completed');
    assert.equal(result.candidate?.apollo_person_id, 'person-1');
    assert.equal(result.candidate?.primary_phone, '+15550100001');
    assert.equal(requests[0]?.url.pathname, '/api/v1/webhook_result/-9223372036854775807');
    assert.equal(requests[0]?.init?.method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('webhook polling translates deterministic HTTP outcomes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ message: 'not found' }, { status: 404 });
  try {
    const result = await getApolloWebhookResult('missing-request', 'apollo-test-key', getGatewayConfig());
    assert.equal(result.status, 'request_id_unknown');
    assert.equal(result.provider_request_id, 'missing-request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('usage snapshots combine credit and API limits without exposing profile contact data', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname.endsWith('/credit_usage_stats')) {
      return Response.json({ team_id: 'team-1', credits_used: 12, credits_remaining: 88 });
    }
    if (url.pathname.endsWith('/api_usage_stats')) {
      return Response.json({ rate_limit: 100, requests_used: 4 });
    }
    return Response.json({
      user: { id: 'user-1', email: 'private@example.test', phone: '+15550100001' },
      team: { id: 'team-1' },
      credit_usage: { enrichment_credits_used: 12 },
    });
  };

  try {
    const result = await getApolloUsageSnapshot('apollo-test-key', getGatewayConfig());
    assert.deepEqual(result.identity, { user_id: 'user-1', team_id: 'team-1' });
    assert.deepEqual(result.credit_usage, { team_id: 'team-1', credits_used: 12, credits_remaining: 88 });
    assert.deepEqual(result.api_usage, { rate_limit: 100, requests_used: 4 });
    assert.equal(JSON.stringify(result).includes('private@example.test'), false);
    assert.equal(JSON.stringify(result).includes('+15550100001'), false);
    assert.deepEqual(requests.map(({ url }) => url.pathname), [
      '/api/v1/usage_stats/credit_usage_stats',
      '/api/v1/usage_stats/api_usage_stats',
      '/api/v1/users/api_profile',
    ]);
    assert.equal(requests[2]?.url.searchParams.get('include_credit_usage'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('organization enrichment is an explicit domain-only request without contact data', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      credits_consumed: 1,
      organization: {
        id: 'org-1',
        name: 'People Co',
        primary_domain: 'people.co',
        short_description: 'HR software',
        keywords: ['payroll', 'onboarding'],
        annual_revenue: 1000000,
        email: 'must-not-leak@example.test',
        phone: '+15550100001',
      },
    });
  };
  try {
    const result = await executeApolloOrganizationEnrichment(
      { domain: 'people.co' },
      'apollo-test-key',
      getGatewayConfig(),
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.credits_consumed, 1);
    assert.equal(result.organization?.short_description, 'HR software');
    assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
    assert.equal(JSON.stringify(result).includes('+15550100001'), false);
    assert.equal(requests[0]?.url.pathname, '/api/v1/organizations/enrich');
    assert.equal(requests[0]?.url.searchParams.get('domain'), 'people.co');
    assert.equal(requests[0]?.init?.method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('organization enrichment propagates upstream failures instead of returning no data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'private upstream detail' }, { status: 500 });
  try {
    await assert.rejects(
      () => executeApolloOrganizationEnrichment(
        { domain: 'people.co' },
        'apollo-test-key',
        getGatewayConfig(),
      ),
      (error: unknown) => error instanceof ApolloGatewayError
        && error.status === 502
        && error.code === 'APOLLO_UPSTREAM_ERROR'
        && !error.message.includes('private upstream detail'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('enrichment reports exhausted Apollo credits without exposing billing details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    error: 'private billing detail',
    error_details: { code: 'BILLING.LIMIT.CREDITS_EXHAUSTED' },
  }, { status: 422 });
  try {
    const parsed = validateEnrichmentInput({
      lead: { linkedin_url: 'https://www.linkedin.com/in/example' },
      reveal_email: true,
      reveal_phone: false,
      enrichment_level: 'basic',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    await assert.rejects(
      () => executeApolloEnrichment(parsed.value, 'apollo-test-key', getGatewayConfig()),
      (error: unknown) => error instanceof ApolloGatewayError
        && error.status === 429
        && error.code === 'APOLLO_CREDITS_EXHAUSTED'
        && !error.message.includes('private billing detail'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo configuration and timeout failures do not expose upstream details', async () => {
  assert.equal(getApolloApiKey({ APOLLO_API_KEY: ' apollo-test-key ' }), 'apollo-test-key');
  const config = getGatewayConfig();
  const parsed = validateLeadSearchInput({ search_mode: 'batch', titles: ['Founder'] }, config);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  await assert.rejects(
    () => executeProviderLeadSearch(parsed.value, config, {}),
    (error: unknown) => error instanceof ApolloGatewayError
      && error.status === 503
      && error.code === 'APOLLO_PROVIDER_NOT_CONFIGURED',
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('private upstream detail');
    error.name = 'AbortError';
    throw error;
  };
  try {
    await assert.rejects(
      () => executeProviderLeadSearch(parsed.value, config, { APOLLO_API_KEY: 'apollo-test-key' }),
      (error: unknown) => error instanceof ApolloGatewayError
        && error.status === 504
        && error.code === 'APOLLO_UPSTREAM_TIMEOUT'
        && !error.message.includes('private upstream detail'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

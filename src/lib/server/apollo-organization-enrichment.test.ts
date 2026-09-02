import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApolloOrganizationEnrichmentError,
  assertApolloOrganizationEnrichmentConfigured,
  submitApolloOrganizationEnrichment,
} from './apollo-organization-enrichment';

test('organization enrichment configuration fails before any provider request', () => {
  assert.throws(
    () => assertApolloOrganizationEnrichmentConfigured({}),
    (error: unknown) => error instanceof ApolloOrganizationEnrichmentError
      && error.code === 'BACKEND_AUTH_NOT_CONFIGURED'
      && !error.providerOutcomeUnknown,
  );
});

test('organization enrichment BFF calls the authenticated gateway only', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      provider: 'apollo',
      status: 'completed',
      organization: { id: 'org-1', name: 'People Co', primary_domain: 'people.co' },
    });
  };
  try {
    const result = await submitApolloOrganizationEnrichment({
      domain: 'people.co',
      requestId: 'operation-1',
      environment: {
        APOLLO_ORGANIZATION_ENRICHMENT_URL: 'https://gateway.example.test/api/organization-enrich',
        ENRICHMENT_SERVICE_SECRET: 'server-only-secret',
      },
    });
    assert.equal(result.status, 'completed');
    assert.equal(requests[0]?.url, 'https://gateway.example.test/api/organization-enrich');
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('x-api-secret-key'), 'server-only-secret');
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { domain: 'people.co' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('organization enrichment preserves ambiguous provider outcomes without retrying', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'BACKEND_ERROR' }, { status: 502 });
  try {
    await assert.rejects(
      () => submitApolloOrganizationEnrichment({
        domain: 'people.co',
        requestId: 'operation-1',
        environment: {
          APOLLO_ORGANIZATION_ENRICHMENT_URL: 'https://gateway.example.test/api/organization-enrich',
          ENRICHMENT_SERVICE_SECRET: 'server-only-secret',
        },
      }),
      (error: unknown) => error instanceof ApolloOrganizationEnrichmentError
        && error.providerOutcomeUnknown
        && error.status === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

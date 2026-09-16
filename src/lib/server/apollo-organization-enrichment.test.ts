import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApolloOrganizationEnrichmentError,
  assertApolloOrganizationEnrichmentConfigured,
  submitApolloOrganizationEnrichment,
} from './apollo-organization-enrichment';

const API_KEY_ENV = { APOLLO_API_KEY: 'test-apollo-key' };

test('organization enrichment configuration fails before any provider request', () => {
  assert.throws(
    () => assertApolloOrganizationEnrichmentConfigured({}),
    (error: unknown) => error instanceof ApolloOrganizationEnrichmentError
      && error.code === 'APOLLO_PROVIDER_NOT_CONFIGURED'
      && !error.providerOutcomeUnknown,
  );
});

test('organization enrichment calls Apollo directly with the server-only key', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      organization: {
        id: 'org-1',
        name: 'People Co',
        primary_domain: 'people.co',
      },
    });
  };
  try {
    const result = await submitApolloOrganizationEnrichment({
      domain: 'people.co',
      requestId: 'operation-1',
      environment: API_KEY_ENV,
    });
    assert.equal(result.status, 'completed');
    assert.equal(
      new URL(requests[0]?.url || '').origin + new URL(requests[0]?.url || '').pathname,
      'https://api.apollo.io/api/v1/organizations/enrich',
    );
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('X-Api-Key'), 'test-apollo-key');
    assert.equal(headers.has('x-api-secret-key'), false);
    assert.equal(new URL(requests[0]?.url || '').searchParams.get('domain'), 'people.co');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('organization enrichment preserves ambiguous provider outcomes without retrying', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'error' }, { status: 502 });
  try {
    await assert.rejects(
      () => submitApolloOrganizationEnrichment({
        domain: 'people.co',
        requestId: 'operation-1',
        environment: API_KEY_ENV,
      }),
      (error: unknown) => error instanceof ApolloOrganizationEnrichmentError
        && error.providerOutcomeUnknown
        && error.status === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

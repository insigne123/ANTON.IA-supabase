import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApolloEnrichmentError,
  assertApolloEnrichmentConfigured,
  pollApolloWebhookResult,
  submitApolloEnrichment,
} from './apollo-enrichment';

const API_KEY_ENV = { APOLLO_API_KEY: 'test-apollo-key' };

test('Apollo enrichment configuration fails before quota can cross the provider boundary', () => {
  assert.throws(
    () => assertApolloEnrichmentConfigured({}),
    (error: unknown) => error instanceof ApolloEnrichmentError
      && error.status === 503
      && error.code === 'APOLLO_PROVIDER_NOT_CONFIGURED',
  );
});

test('Apollo BFF submits match-only requests directly to Apollo', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      person: {
        id: 'apollo-person-1',
        first_name: 'Ana',
        last_name: 'Perez',
        linkedin_url: 'https://www.linkedin.com/in/ana-perez',
      },
      request_id: '1234567890123456789',
    });
  };

  try {
    const result = await submitApolloEnrichment({
      lead: { linkedinUrl: 'https://www.linkedin.com/in/ana-perez' },
      revealEmail: false,
      revealPhone: false,
      matchOnly: true,
      environment: API_KEY_ENV,
    });
    assert.equal(result.success, true);
    assert.equal(result.providerRequestId, '1234567890123456789');
    assert.equal(requests[0]?.url.origin + requests[0]?.url.pathname, 'https://api.apollo.io/api/v1/people/match');
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('X-Api-Key'), 'test-apollo-key');
    assert.equal(headers.has('x-api-secret-key'), false);
    const query = requests[0]?.url.searchParams;
    assert.equal(query?.get('linkedin_url'), 'https://www.linkedin.com/in/ana-perez');
    assert.equal(result.extractedData?.source_provider_id, 'apollo-person-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo BFF classifies provider timeouts as unknown provider outcomes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const error = new Error('network details');
    error.name = 'AbortError';
    throw error;
  };

  try {
    await assert.rejects(
      () => submitApolloEnrichment({
        lead: { sourceProviderId: 'apollo-person-1' },
        revealEmail: true,
        revealPhone: false,
        environment: API_KEY_ENV,
      }),
      (error: unknown) => error instanceof ApolloEnrichmentError
        && error.providerOutcomeUnknown
        && error.code === 'APOLLO_UPSTREAM_TIMEOUT'
        && !error.message.includes('network details'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo BFF treats ambiguous upstream errors as unknown outcomes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: 'error' }, { status: 502 });

  try {
    await assert.rejects(
      () => submitApolloEnrichment({
        lead: { sourceProviderId: 'apollo-person-1' },
        revealEmail: true,
        revealPhone: false,
        environment: API_KEY_ENV,
      }),
      (error: unknown) => error instanceof ApolloEnrichmentError
        && error.providerOutcomeUnknown
        && error.code === 'APOLLO_UPSTREAM_ERROR',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo polling uses the signed provider request ID as an opaque path segment', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      request_id: '-9223372036854775807',
      status: 'result_pending',
      retry_after_seconds: 30,
    });
  };

  try {
    const result = await pollApolloWebhookResult({
      providerRequestId: '-9223372036854775807',
      environment: API_KEY_ENV,
    });
    assert.equal(new URL(requestedUrl).pathname, '/api/v1/webhook_result/-9223372036854775807');
    assert.equal(result.status, 'result_pending');
    assert.equal(result.retryAfterSeconds, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

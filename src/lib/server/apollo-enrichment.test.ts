import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApolloEnrichmentError,
  assertApolloEnrichmentConfigured,
  pollApolloWebhookResult,
  submitApolloEnrichment,
} from './apollo-enrichment';

test('Apollo enrichment configuration fails before quota can cross the provider boundary', () => {
  assert.throws(
    () => assertApolloEnrichmentConfigured({}),
    (error: unknown) => error instanceof ApolloEnrichmentError
      && error.status === 503
      && error.code === 'ENRICHMENT_SERVICE_SECRET_NOT_CONFIGURED',
  );
});

test('Apollo BFF submits match-only requests through the authenticated gateway', async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({
      success: true,
      enrichment_status: 'completed',
      provider_request_id: '1234567890123456789',
      extracted_data: {
        source_provider: 'apollo',
        source_provider_id: 'apollo-person-1',
        full_name: 'Ana Perez',
      },
    });
  };

  try {
    const result = await submitApolloEnrichment({
      lead: { linkedinUrl: 'https://www.linkedin.com/in/ana-perez' },
      revealEmail: false,
      revealPhone: false,
      matchOnly: true,
      environment: {
        ENRICHMENT_SERVICE_URL: 'https://gateway.example.test/api/enrich',
        ENRICHMENT_SERVICE_SECRET: 'internal-secret',
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.providerRequestId, '1234567890123456789');
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get('x-api-secret-key'), 'internal-secret');
    assert.equal(headers.has('x-apollo-api-key'), false);
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.match_only, true);
    assert.deepEqual(body.requested_fields, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo BFF classifies gateway timeouts as unknown provider outcomes', async () => {
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
        environment: {
          ENRICHMENT_SERVICE_URL: 'https://gateway.example.test/api/enrich',
          ENRICHMENT_SERVICE_SECRET: 'internal-secret',
        },
      }),
      (error: unknown) => error instanceof ApolloEnrichmentError
        && error.providerOutcomeUnknown
        && error.code === 'APOLLO_GATEWAY_TIMEOUT'
        && !error.message.includes('network details'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo BFF treats ambiguous upstream network errors as unknown outcomes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: 'APOLLO_UPSTREAM_ERROR' },
    { status: 502 },
  );

  try {
    await assert.rejects(
      () => submitApolloEnrichment({
        lead: { sourceProviderId: 'apollo-person-1' },
        revealEmail: true,
        revealPhone: false,
        environment: {
          ENRICHMENT_SERVICE_URL: 'https://gateway.example.test/api/enrich',
          ENRICHMENT_SERVICE_SECRET: 'internal-secret',
        },
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
      provider_request_id: '-9223372036854775807',
      status: 'result_pending',
      retry_after_seconds: 30,
      candidate: null,
    });
  };

  try {
    const result = await pollApolloWebhookResult({
      providerRequestId: '-9223372036854775807',
      environment: {
        BACKEND_HOSTED_APP_URL: 'https://gateway.example.test',
        ENRICHMENT_SERVICE_SECRET: 'internal-secret',
      },
    });
    assert.equal(new URL(requestedUrl).pathname, '/api/webhook-result/-9223372036854775807');
    assert.equal(result.status, 'result_pending');
    assert.equal(result.retryAfterSeconds, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

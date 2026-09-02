import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ApolloSearchClientError, requestApolloSearch } from './apollo-search-client';

const legacySearchRoute = readFileSync('src/app/api/opportunities/leads-apollo/route.ts', 'utf8');
const supliaProspecting = readFileSync('src/lib/server/suplia-prospecting.ts', 'utf8');

test('Apollo search uses only the authenticated gateway and forces Apollo', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ count: 0, leads: [] });
  };

  try {
    await requestApolloSearch({ search_mode: 'batch', titles: ['CEO'], provider: 'retired' }, {
      ANTONIA_LEAD_SEARCH_URL: 'https://gateway.example.test/api/lead-search',
      ENRICHMENT_SERVICE_SECRET: 'internal-secret',
    });
    assert.equal(requests[0]?.input, 'https://gateway.example.test/api/lead-search');
    assert.equal(new Headers(requests[0]?.init?.headers).get('x-api-secret-key'), 'internal-secret');
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.provider, 'apollo');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo search fails closed without the server-to-server secret', async () => {
  await assert.rejects(
    () => requestApolloSearch({ search_mode: 'batch', titles: ['CEO'] }, {
      ANTONIA_LEAD_SEARCH_URL: 'https://gateway.example.test/api/lead-search',
    }),
    (error: unknown) => error instanceof ApolloSearchClientError
      && error.status === 503
      && error.code === 'APOLLO_SEARCH_AUTH_NOT_CONFIGURED',
  );
});

test('ambiguous company searches return candidates instead of auto-selecting the first match', () => {
  for (const source of [legacySearchRoute, supliaProspecting]) {
    assert.match(source, /organization_candidates/);
    assert.match(source, /requiresOrganizationSelection/);
    assert.doesNotMatch(source, /candidates\[0\][\s\S]*selected_organization_id/);
  }
});

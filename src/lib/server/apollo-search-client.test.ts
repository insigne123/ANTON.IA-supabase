import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ApolloSearchClientError, requestApolloSearch } from './apollo-search-client';

const legacySearchRoute = readFileSync('src/app/api/opportunities/leads-apollo/route.ts', 'utf8');
const supliaProspecting = readFileSync('src/lib/server/suplia-prospecting.ts', 'utf8');

const API_KEY_ENV = { APOLLO_API_KEY: 'test-apollo-key' };

function apolloPeopleResponse(people: unknown[]) {
  return async () => Response.json({
    people,
    pagination: { page: 1, per_page: 25, total_entries: people.length, total_pages: 1 },
  });
}

test('Apollo search runs in-process against Apollo and forces the Apollo provider', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return apolloPeopleResponse([])();
  };

  try {
    const result = await requestApolloSearch(
      { search_mode: 'batch', titles: ['CEO'], provider: 'retired' },
      API_KEY_ENV,
    );
    assert.equal(Array.isArray((result as { leads?: unknown }).leads), true);
    assert.match(requests[0]?.input || '', /^https:\/\/api\.apollo\.io\/api\/v1\/mixed_people\/api_search/);
    assert.equal(new Headers(requests[0]?.init?.headers).get('X-Api-Key'), 'test-apollo-key');
    assert.doesNotMatch(requests[0]?.input || '', /gateway\.example\.test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo search fails closed without the provider API key', async () => {
  await assert.rejects(
    () => requestApolloSearch({ search_mode: 'batch', titles: ['CEO'] }, {}),
    (error: unknown) => error instanceof ApolloSearchClientError
      && error.status === 503
      && error.code === 'APOLLO_SEARCH_AUTH_NOT_CONFIGURED',
  );
});

test('Apollo search surfaces invalid requests without calling the provider', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ people: [] });
  };
  try {
    await assert.rejects(
      () => requestApolloSearch({ search_mode: 'batch' }, API_KEY_ENV),
      (error: unknown) => error instanceof ApolloSearchClientError
        && error.status === 400
        && error.code === 'INVALID_REQUEST',
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo search maps exhausted credits to a 429 client error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { error: 'credit usage limit exceeded', error_details: { code: 'BILLING.LIMIT.CREDITS_EXHAUSTED' } },
    { status: 402 },
  );
  try {
    await assert.rejects(
      () => requestApolloSearch(
        { search_mode: 'batch', titles: ['CEO'] },
        API_KEY_ENV,
      ),
      (error: unknown) => error instanceof ApolloSearchClientError
        && error.status === 429
        && error.code === 'APOLLO_CREDITS_EXHAUSTED',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ambiguous company searches return candidates instead of auto-selecting the first match', () => {
  for (const source of [legacySearchRoute, supliaProspecting]) {
    assert.match(source, /organization_candidates/);
    assert.match(source, /requiresOrganizationSelection/);
    assert.doesNotMatch(source, /candidates\[0\][\s\S]*selected_organization_id/);
  }
});

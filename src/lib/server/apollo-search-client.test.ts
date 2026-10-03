import assert from 'node:assert/strict';
import test from 'node:test';

import { ApolloSearchClientError, requestApolloSearch } from './apollo-search-client';


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

test('an exact profile uses people/match, requires matching identity and never returns email or phone', async () => {
  const originalFetch = globalThis.fetch;
  const profile = 'https://www.linkedin.com/in/contacto-de-prueba-23825746';
  const requests: string[] = [];
  let wrong = false;
  globalThis.fetch = async input => {
    requests.push(String(input));
    return Response.json({ person: {
      id: 'person-id', name: wrong ? 'Otra Persona' : 'Contacto De Prueba', first_name: 'Contacto', last_name: 'De Prueba',
      linkedin_url: wrong ? 'https://www.linkedin.com/in/otra-persona' : profile,
      email: 'private@example.com', phone_number: '+56900000000',
      organization: { name: 'Empresa de prueba' },
    } });
  };
  try {
    const payload = { search_mode: 'profile', linkedin_url: profile, max_results: 1, reveal_email: false, reveal_phone: false };
    const found = await requestApolloSearch(payload, API_KEY_ENV);
    assert.equal(found.leads.length, 1);
    assert.equal(found.leads[0].name, 'Contacto De Prueba');
    const url = new URL(requests[0]);
    assert.match(url.pathname, /\/people\/match$/);
    assert.equal(url.searchParams.get('linkedin_url'), profile);
    assert.equal(url.searchParams.get('reveal_personal_emails'), 'false');
    assert.equal(url.searchParams.get('reveal_phone_number'), 'false');
    assert.doesNotMatch(JSON.stringify(found), /private@example|56900000000/);
    wrong = true;
    await assert.rejects(() => requestApolloSearch(payload, API_KEY_ENV),
      error => error instanceof ApolloSearchClientError && error.code === 'APOLLO_PERSON_IDENTITY_MISMATCH');
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid profile lookups and filter/reveal overrides never reach the provider; not found stays empty', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ person: null }); };
  const payload = { search_mode: 'profile', linkedin_url: 'https://www.linkedin.com/in/contacto-de-prueba-23825746' };
  try {
    for (const extra of [{ linkedin_url: 'https://example.com/in/user' }, { reveal_email: true }, { reveal_phone: true },
      { max_results: 25 }, { per_page: 25 }, { page: 2 }, { titles: ['Gerente'] }, { titles: 'Gerente' }]) {
      await assert.rejects(() => requestApolloSearch({ ...payload, ...extra }, API_KEY_ENV),
        error => error instanceof ApolloSearchClientError && error.code === 'INVALID_REQUEST');
    }
    assert.equal(calls, 0);
    const found = await requestApolloSearch(payload, API_KEY_ENV);
    assert.equal(calls, 1);
    assert.deepEqual(found.leads, []);
  } finally { globalThis.fetch = originalFetch; }
});

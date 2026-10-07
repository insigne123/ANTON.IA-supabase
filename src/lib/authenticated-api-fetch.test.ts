import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthenticatedApiFetch } from './authenticated-api-fetch';

const session = (token = 'browser-current', id = 'user-a') => ({ access_token: token, user: { id } });
const result = (value = session()) => ({ data: { session: value } });
const unauthorized = () => Response.json({ error: 'Unauthorized', code: 'AUTH_SESSION_EXPIRED' }, { status: 401 });

test('same-origin BFF receives the current browser token; a stale supplied header is replaced', async () => {
  let request: RequestInit | undefined;
  const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => assert.fail('no refresh'),
    fetch: (async (_path, init) => { request = init; return Response.json({ ok: true }); }) as typeof fetch });
  await call('/api/leads/search', { method: 'POST', headers: { Authorization: 'Bearer stale-cookie-token', 'Content-Type': 'application/json' }, body: '{"company_name":"acciona"}' });
  assert.equal(new Headers(request?.headers).get('authorization'), 'Bearer browser-current');
  assert.equal(request?.credentials, 'same-origin');
  assert.equal(request?.body, '{"company_name":"acciona"}');
  for (const path of ['https://evil.test/api/search', '//evil.test/api/search', '/api\\evil', '/api/\nsearch']) await assert.rejects(call(path), /API_PATH_NOT_ALLOWED/);
});

test('a definitive pre-auth 401 refreshes once and preserves operation identity and body', async () => {
  const seen: Array<RequestInit | undefined> = [];
  let refreshed = 0;
  const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => { refreshed++; return result(session('renewed')); },
    fetch: (async (_path, init) => { seen.push(init); return seen.length === 1 ? unauthorized() : Response.json({ ok: true }); }) as typeof fetch });
  const body = '{"operationId":"same-id","linkedinUrl":"https://www.linkedin.com/in/flaviobaronti"}';
  const response = await call('/api/opportunities/enrich-apollo', { method: 'POST', headers: { 'Idempotency-Key': 'same-id' }, body });
  assert.equal(response.status, 200); assert.equal(refreshed, 1); assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(init => init?.body), [body, body]);
  assert.deepEqual(seen.map(init => new Headers(init?.headers).get('idempotency-key')), ['same-id', 'same-id']);
  assert.deepEqual(seen.map(init => new Headers(init?.headers).get('authorization')), ['Bearer browser-current', 'Bearer renewed']);
});

test('concurrent failures share a refresh; a still-unauthorized retry is not looped', async () => {
  let refreshes = 0; let requests = 0;
  let finish!: (value: ReturnType<typeof result>) => void;
  const pending = new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; });
  const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: () => { refreshes++; return pending; },
    fetch: (async () => { requests++; return unauthorized(); }) as typeof fetch });
  const first = call('/api/leads/search'); const second = call('/api/leads/search/checkpoint');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(refreshes, 1); finish(result(session('renewed')));
  assert.deepEqual((await Promise.all([first, second])).map(response => response.status), [401, 401]);
  assert.equal(requests, 4); assert.equal(refreshes, 1);
});

test('permission, quota, provider/ambiguous outcomes and network failures are never replayed', async () => {
  for (const [status, code] of [[403, 'ORGANIZATION_ACCESS_REQUIRED'], [429, 'DAILY_SEARCH_QUOTA_EXCEEDED'], [409, 'ENRICHMENT_PROVIDER_OUTCOME_UNKNOWN'], [503, 'APOLLO_UPSTREAM_ERROR'], [401, 'APOLLO_UPSTREAM_ERROR']] as const) {
    let requests = 0;
    const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => assert.fail('no replay'),
      fetch: (async () => { requests++; return Response.json({ error: code }, { status }); }) as typeof fetch });
    assert.equal((await call('/api/leads/search', { method: 'POST', body: '{}' })).status, status);
    assert.equal(requests, 1);
  }
  const failed = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => assert.fail('no refresh after a lost response'),
    fetch: (async () => { throw new Error('Failed to fetch'); }) as typeof fetch });
  await assert.rejects(failed('/api/opportunities/enrich-apollo'), /Failed to fetch/);
});

test('refresh failures, account changes and cancellation never replay under another identity', async () => {
  for (const refreshed of [{ data: { session: null }, error: new Error('invalid refresh') }, result(session('other-token', 'user-b'))]) {
    let requests = 0;
    const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => refreshed,
      fetch: (async () => { requests++; return unauthorized(); }) as typeof fetch });
    assert.equal((await call('/api/leads/search')).status, 401); assert.equal(requests, 1);
  }
  const controller = new AbortController(); let requests = 0;
  const call = createAuthenticatedApiFetch({ getSession: async () => result(), refreshSession: async () => { controller.abort(); return result(session('renewed')); },
    fetch: (async () => { requests++; return unauthorized(); }) as typeof fetch });
  assert.equal((await call('/api/leads/search', { signal: controller.signal })).status, 401); assert.equal(requests, 1);
});

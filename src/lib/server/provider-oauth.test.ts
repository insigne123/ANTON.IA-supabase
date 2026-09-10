import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('src/lib/server/provider-oauth.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options: { userId?: string | null; tokens?: object; tokenStatus?: number; saveError?: object; env?: object; throws?: boolean } = {}) {
  const calls: any[] = [];
  const saves: any[] = [];
  const exports: any = {};
  const env = { NEXT_PUBLIC_BASE_URL: 'https://app.example.test', NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret', NEXT_PUBLIC_AZURE_AD_CLIENT_ID: 'azure-id', AZURE_AD_CLIENT_SECRET: 'azure-secret', ...options.env };
  const dependencies: Record<string, any> = {
    'node:crypto': { createHash, randomBytes },
    '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.userId === null ? null : { id: options.userId || 'user-a' } } }) } }) },
    'next/headers': { cookies: () => {} },
    'next/server': { NextResponse: { redirect: (url: URL) => {
      const response = { url: String(url), headers: new Headers(), values: {} as Record<string, any>, cookies: { set(name: string, value: string, attributes: any) { response.values[name] = { value, attributes }; } } };
      return response;
    } } },
    '@/lib/services/token-service': { tokenService: { saveToken: async (...args: any[]) => { saves.push(args); return options.saveError || null; } } },
  };
  new Function('require', 'exports', 'process', 'fetch', compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, { env }, async (url: string, init: any) => {
    calls.push({ url, init });
    if (options.throws) throw new Error('Network failure');
    return Response.json(options.tokens || {}, { status: options.tokenStatus || 200 });
  });
  return { ...exports, calls, saves };
}

function request(path: string, values: Record<string, any> = {}) {
  return { nextUrl: new URL(path, 'https://app.example.test'), cookies: { get: (name: string) => values[name] }, headers: new Headers({ 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }) };
}

for (const provider of ['google', 'azure']) {
  const page = provider === 'google' ? '/gmail' : '/outlook';
  const scope = provider === 'google' ? 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly' : 'User.Read Mail.Send Mail.Read';
  test(`${provider}: start and callback complete a session-bound PKCE flow`, async () => {
    const flow = harness({ tokens: { refresh_token: 'fake-refresh', scope } });
    const start = await flow.startProviderOAuth(request(`/api/auth/connect/${provider}`), provider);
    const authorize = new URL(start.url);
    const cookie = start.values[`provider_oauth_${provider}`];
    const attempt = JSON.parse(cookie.value);
    assert.equal(cookie.attributes.httpOnly, true);
    assert.equal(cookie.attributes.secure, true);
    assert.equal(cookie.attributes.sameSite, 'lax');
    assert.equal(cookie.attributes.maxAge, 600);
    assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(attempt.verifier).digest('base64url'));
    assert.equal(authorize.searchParams.get('state'), attempt.state);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.has('client_secret'), false);
    const finish = await flow.finishProviderOAuth(request(`/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`, start.values), provider);
    assert.equal(finish.url, `https://app.example.test${page}?connected=true`);
    assert.equal(finish.values[`provider_oauth_${provider}`].attributes.maxAge, 0);
    assert.equal(flow.calls[0].init.body.get('code_verifier'), attempt.verifier);
    assert.equal(flow.calls[0].init.body.get('redirect_uri'), authorize.searchParams.get('redirect_uri'));
    assert.equal(flow.saves[0][1], provider === 'azure' ? 'outlook' : 'google');
    assert.equal(flow.saves[0][2], 'fake-refresh');
  });

  test(`${provider}: rejects absent, mismatched, expired and cross-user attempts without token exchange`, async () => {
    const flow = harness();
    const start = await flow.startProviderOAuth(request(`/api/auth/connect/${provider}`), provider);
    const name = `provider_oauth_${provider}`;
    const attempt = JSON.parse(start.values[name].value);
    for (const value of [null, {}, { ...attempt, state: 'other' }, { ...attempt, userId: 'other' }, { ...attempt, redirectUri: 'https://evil.example' }, { ...attempt, createdAt: Date.now() - 601_000 }, { ...attempt, createdAt: Date.now() + 60_000 }]) {
      const response = await flow.finishProviderOAuth(request(`/api/auth/callback/${provider}?code=fake&state=${attempt.state}`, { [name]: { value: JSON.stringify(value) } }), provider);
      assert.equal(new URL(response.url).searchParams.get('error'), 'invalid_state');
    }
    assert.equal(flow.calls.length, 0);
    assert.equal(flow.saves.length, 0);
  });

  test(`${provider}: unauthenticated start and callback never exchange credentials`, async () => {
    const flow = harness({ userId: null });
    for (const operation of ['startProviderOAuth', 'finishProviderOAuth']) {
      const response = await flow[operation](request(`/api/auth/callback/${provider}?code=fake`), provider);
      assert.equal(new URL(response.url).searchParams.get('error'), 'session_expired');
    }
    assert.equal(flow.calls.length, 0);
  });

  test(`${provider}: proxy origins do not loop and OAuth destinations stay canonical`, async () => {
    for (const header of ['host', 'x-forwarded-host']) {
      const req = request(`http://0.0.0.0:8080/api/auth/connect/${provider}`);
      req.headers = new Headers({ [header]: 'app.example.test' });
      const flow = harness();
      const start = await flow.startProviderOAuth(req, provider);
      assert.equal(new URL(start.url).searchParams.get('redirect_uri'), `https://app.example.test/api/auth/callback/${provider}`);
      assert.equal(start.values[`provider_oauth_${provider}`].attributes.secure, true);
      const anonymous = await harness({ userId: null }).startProviderOAuth(req, provider);
      assert.equal(anonymous.url, `https://app.example.test${page}?error=session_expired`);
    }
    const otherHost = request(`https://other.example/api/auth/connect/${provider}`);
    const result = await harness().startProviderOAuth(otherHost, provider);
    assert.equal(result.url, `https://app.example.test/api/auth/connect/${provider}`);
    assert.deepEqual(result.values, {});
  });

  test(`${provider}: cancellation, missing permissions and failed exchange preserve stored credentials`, async () => {
    const cases = [
      { options: {}, query: '&error=access_denied', error: 'consent_denied' },
      { options: { tokens: { refresh_token: 'fake', scope: 'openid' } }, query: '&code=fake', error: 'missing_permissions' },
      { options: { tokens: { scope } }, query: '&code=fake', error: 'no_refresh_token' },
      { options: { tokenStatus: 400 }, query: '&code=fake', error: 'token_exchange_failed' },
      { options: { throws: true }, query: '&code=fake', error: 'exchange_failed' },
    ];
    for (const item of cases) {
      const flow = harness(item.options);
      const start = await flow.startProviderOAuth(request(`/api/auth/connect/${provider}`), provider);
      const state = new URL(start.url).searchParams.get('state');
      const result = await flow.finishProviderOAuth(request(`/api/auth/callback/${provider}?state=${state}${item.query}`, start.values), provider);
      assert.equal(new URL(result.url).searchParams.get('error'), item.error);
      assert.equal(flow.saves.length, 0);
    }
  });
}

test('OAuth fails closed without server configuration and does not trust forwarded host', async () => {
  const flow = harness({ env: { GOOGLE_CLIENT_SECRET: '' } });
  const result = await flow.startProviderOAuth(request('/api/auth/connect/google'), 'google');
  assert.equal(result.url, 'https://app.example.test/gmail?error=configuration_missing');
  assert.equal(flow.calls.length, 0);
});

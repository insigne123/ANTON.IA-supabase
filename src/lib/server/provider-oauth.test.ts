import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { publicAppOrigin, requestAppOrigin } from './app-origins';

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
    // The two addresses, read from this harness's environment (app-origins.ts).
    '@/lib/server/app-origins': { publicAppOrigin: () => publicAppOrigin(env), requestAppOrigin: (headers: Headers, canonical: string) => requestAppOrigin(headers, canonical, env) },
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

// Signed in at the public address (APP_PUBLIC_URL): the session and the attempt live there, while Google and Microsoft only know the
// app's own callback. The consent starts at the public address, answers at the app's callback, and is handed on to where it started.
const OPEN = 'https://open.example.test';
const atOpen = (path: string, values: Record<string, any> = {}, header = 'x-forwarded-host') => ({
  nextUrl: new URL(path, 'http://0.0.0.0:8080'), cookies: { get: (name: string) => values[name] }, headers: new Headers({ [header]: 'open.example.test' }),
});
for (const provider of ['google', 'azure']) {
  const page = provider === 'google' ? '/gmail' : '/outlook';
  const scope = provider === 'google' ? 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly' : 'User.Read Mail.Send Mail.Read';
  test(`${provider}: signed in at the public address, the mailbox is connected there through the callback the provider knows`, async () => {
    const flow = harness({ tokens: { refresh_token: 'fake-refresh', scope }, env: { APP_PUBLIC_URL: OPEN } });
    for (const header of ['host', 'x-forwarded-host']) {
      const start = await flow.startProviderOAuth(atOpen(`/api/auth/connect/${provider}`, {}, header), provider);
      const authorize = new URL(start.url);
      const attempt = JSON.parse(start.values[`provider_oauth_${provider}`].value);
      // It starts here, not at the app's own address, and the provider is told the one callback it knows.
      assert.ok(authorize.host.endsWith('google.com') || authorize.host.endsWith('microsoftonline.com'));
      assert.equal(authorize.searchParams.get('redirect_uri'), `https://app.example.test/api/auth/callback/${provider}`);
      assert.equal(attempt.redirectUri, `https://app.example.test/api/auth/callback/${provider}`);
      assert.match(attempt.state, /^p\.[A-Za-z0-9_-]{43}$/);
      assert.equal(authorize.searchParams.get('state'), attempt.state);
      assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(attempt.verifier).digest('base64url'));

      // The answer lands at the app's own callback, which has neither the session nor the attempt: handed on whole, nothing read.
      const before = flow.calls.length;
      const landed = await flow.finishProviderOAuth(request(`/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`), provider);
      assert.equal(landed.url, `${OPEN}/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`);
      assert.equal(landed.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(landed.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(landed.values, {}, 'no cookie is touched at the app\'s own address');
      assert.equal(flow.calls.length, before, 'the code is not exchanged there');

      // At the public address it ends as any other: the same session, the same attempt, the same verifier.
      const saved = flow.saves.length;
      const finish = await flow.finishProviderOAuth(atOpen(`/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`, start.values, header), provider);
      assert.equal(finish.url, `${OPEN}${page}?connected=true`);
      assert.equal(flow.calls.at(-1).init.body.get('code_verifier'), attempt.verifier);
      assert.equal(flow.calls.at(-1).init.body.get('redirect_uri'), `https://app.example.test/api/auth/callback/${provider}`);
      assert.equal(flow.saves.length, saved + 1);
      assert.equal(flow.saves.at(-1)[2], 'fake-refresh');
    }
  });

  test(`${provider}: the hand-on gives nothing away: no session, another person's attempt or a made-up state end with nothing connected`, async () => {
    const env = { APP_PUBLIC_URL: OPEN };
    const flow = harness({ tokens: { refresh_token: 'fake-refresh', scope }, env });
    const start = await flow.startProviderOAuth(atOpen(`/api/auth/connect/${provider}`), provider);
    const attempt = JSON.parse(start.values[`provider_oauth_${provider}`].value);
    const name = `provider_oauth_${provider}`;
    // Without the attempt's cookie (another browser, a link someone passed on), or with a state that is not the cookie's.
    for (const values of [{}, { [name]: { value: JSON.stringify({ ...attempt, state: `p.${'x'.repeat(43)}` }) } }, { [name]: { value: JSON.stringify({ ...attempt, userId: 'other' }) } }]) {
      const response = await flow.finishProviderOAuth(atOpen(`/api/auth/callback/${provider}?code=fake&state=${attempt.state}`, values), provider);
      assert.equal(response.url, `${OPEN}${page}?error=invalid_state`);
    }
    // Nobody signed in at the public address: nothing starts and nothing ends.
    const anonymous = harness({ userId: null, env });
    assert.equal((await anonymous.startProviderOAuth(atOpen(`/api/auth/connect/${provider}`), provider)).url, `${OPEN}${page}?error=session_expired`);
    assert.equal((await anonymous.finishProviderOAuth(atOpen(`/api/auth/callback/${provider}?code=fake&state=${attempt.state}`, start.values), provider)).url, `${OPEN}${page}?error=session_expired`);
    assert.equal(flow.calls.length + anonymous.calls.length, 0, 'no code is ever exchanged');
    assert.equal(flow.saves.length, 0);
    // An attempt of the app's own address is never handed on, whatever its state looks like without the mark.
    const own = await flow.startProviderOAuth(request(`/api/auth/connect/${provider}`), provider);
    assert.doesNotMatch(JSON.parse(own.values[name].value).state, /^p\./);
    // Without a public address configured, a marked state is just a state that matches no attempt; and a host the server was not
    // configured with is not a place to hand anything on to.
    const plain = harness();
    assert.equal((await plain.finishProviderOAuth(request(`/api/auth/callback/${provider}?code=fake&state=${attempt.state}`), provider)).url, `https://app.example.test${page}?error=invalid_state`);
    const elsewhere = { nextUrl: new URL(`http://0.0.0.0:8080/api/auth/connect/${provider}`), cookies: { get: () => undefined }, headers: new Headers({ 'x-forwarded-host': 'evil.example' }) };
    const sent = await flow.startProviderOAuth(elsewhere, provider);
    assert.equal(sent.url, `https://app.example.test/api/auth/connect/${provider}`);
    assert.deepEqual(sent.values, {});
  });
}

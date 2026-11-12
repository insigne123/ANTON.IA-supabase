import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { dropLinkHref } from './lead-drop-link';

// Gmail or Outlook connected from a «Contacto del día» email: the real OAuth helper and the link flow, with the provider, the
// database and the link check answered by hand.
const compile = (file: string) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const OAUTH = compile('src/lib/server/provider-oauth.ts');
const LINK = compile('src/lib/server/provider-oauth-link.ts');
const TOKEN = 'T'.repeat(48);
const BASE = 'https://app.example.test';

function harness(options: { owner?: string | null; connected?: Array<'google' | 'outlook'>; tokens?: object; tokenStatus?: number; saveError?: object; sessionUser?: string | null } = {}) {
  const saves: any[] = [], sessionSaves: any[] = [], exchanges: any[] = [], resolved: unknown[] = [];
  const env = { NEXT_PUBLIC_BASE_URL: BASE, NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'google-id', GOOGLE_CLIENT_SECRET: 'google-secret', NEXT_PUBLIC_AZURE_AD_CLIENT_ID: 'azure-id', AZURE_AD_CLIENT_SECRET: 'azure-secret' };
  const connected = new Set(options.connected || []);
  const redirect = (url: URL | string) => {
    const response = { url: String(url), headers: new Headers(), values: {} as Record<string, any>, cookies: { set(name: string, value: string, attributes: any) { response.values[name] = { value, attributes }; } } };
    return response;
  };
  const tokenService = {
    saveToken: async (...args: any[]) => { sessionSaves.push(args); return null; },
    saveTokenFor: async (userId: string, provider: string, refresh: string) => { saves.push({ userId, provider, refresh }); if (!options.saveError) connected.add(provider as any); return options.saveError || null; },
  };
  const load = (code: string, dependencies: Record<string, any>) => {
    const exports: any = {};
    new Function('require', 'exports', 'process', 'fetch', code)((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
      exports, { env }, async (url: string, init: any) => { exchanges.push({ url, body: new URLSearchParams(init.body) }); return Response.json(options.tokens || {}, { status: options.tokenStatus || 200 }); });
    return exports;
  };
  const next = { NextResponse: { redirect } };
  const oauth = load(OAUTH, {
    'node:crypto': { createHash, randomBytes }, 'next/headers': { cookies: () => {} }, 'next/server': next, '@/lib/services/token-service': { tokenService },
    '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.sessionUser ? { id: options.sessionUser } : null } }) } }) },
  });
  const link = load(LINK, {
    'next/server': next, '@/lib/server/lead-drop-link': { dropLinkHref }, '@/lib/server/provider-oauth': oauth, '@/lib/services/token-service': { tokenService },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({}) },
    '@/lib/server/lead-drop-mail': { resolveDropLink: async (_client: unknown, token: unknown) => {
      resolved.push(token);
      if (token !== TOKEN || options.owner === null) throw new Error('not a link');
      return { dropId: 'drop-1', scope: { userId: options.owner || 'u-ana', organizationId: 'org-1' } };
    } },
    '@/lib/server/mail-sender-preference': { readMailSenderPreference: async () => ({ connected: { google: connected.has('google'), outlook: connected.has('outlook') } }) },
  });
  return { ...link, oauth, saves, sessionSaves, exchanges, resolved };
}
const request = (path: string, values: Record<string, any> = {}) => ({ nextUrl: new URL(path, BASE), cookies: { get: (name: string) => values[name] }, headers: new Headers({ host: 'app.example.test' }) });
const page = (state: string) => `${BASE}/contactos/${TOKEN}?correo=${state}`;
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

for (const [provider, saved, scope] of [['google', 'google', GOOGLE_SCOPE], ['azure', 'outlook', 'User.Read Mail.Send Mail.Read']] as const) {
  test(`${provider}: a person with no mailbox connects one from the email's link, without a session, and lands back on their contacts`, async () => {
    const flow = harness({ tokens: { refresh_token: 'fake-refresh', scope } });
    const start = await flow.startLinkOAuth(request(`/api/auth/connect/${provider}?enlace=${TOKEN}`), provider, TOKEN);
    const authorize = new URL(start.url);
    const cookie = start.values[`provider_oauth_${provider}`];
    const attempt = JSON.parse(cookie.value);
    assert.equal(authorize.searchParams.get('redirect_uri'), `${BASE}/api/auth/callback/${provider}`, 'the same callback the app registered');
    assert.equal(authorize.searchParams.get('state'), attempt.state);
    assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(attempt.verifier).digest('base64url'));
    assert.deepEqual([attempt.userId, attempt.link], ['u-ana', TOKEN], 'for the drop\'s own person, and the link goes with the attempt');
    assert.deepEqual([cookie.attributes.httpOnly, cookie.attributes.secure, cookie.attributes.path], [true, true, '/api/auth']);
    assert.equal(flow.attemptLink(cookie.value), TOKEN);
    const finish = await flow.finishLinkOAuth(request(`/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`, start.values), provider, TOKEN);
    assert.equal(finish.url, page('conectado'));
    assert.equal(finish.values[`provider_oauth_${provider}`].attributes.maxAge, 0);
    assert.deepEqual(flow.saves, [{ userId: 'u-ana', provider: saved, refresh: 'fake-refresh' }]);
    assert.equal(flow.exchanges[0].body.get('code_verifier'), attempt.verifier);
    assert.equal(flow.sessionSaves.length, 0);
    assert.deepEqual(flow.resolved, [TOKEN, TOKEN], 'the link is checked when the consent starts and again when it comes back');
  });
}

test('a link never replaces a mailbox that already sends: nothing is asked of the provider, nothing is saved', async () => {
  const flow = harness({ connected: ['outlook'], tokens: { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE } });
  const start = await flow.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  assert.equal(start.url, page('conectado'));
  assert.deepEqual(start.values, {});
  // Connected from the app while the consent was open: the consent is dropped.
  const late = harness({ tokens: { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE } });
  const begun = await late.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  const attempt = JSON.parse(begun.values.provider_oauth_google.value);
  const other = harness({ connected: ['google'], tokens: { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE } });
  const finish = await other.finishLinkOAuth(request(`/api/auth/callback/google?code=fake-code&state=${attempt.state}`, begun.values), 'google', TOKEN);
  assert.equal(finish.url, page('conectado'));
  assert.deepEqual(other.saves, []);
});

test('the cookie alone never says for whom: a forged attempt, another person\'s, a stale state or a link that is not ours save nothing', async () => {
  const tokens = { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE };
  const flow = harness({ tokens });
  const start = await flow.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  const attempt = JSON.parse(start.values.provider_oauth_google.value);
  const callback = (state: string, cookie: object, extra = '') => request(`/api/auth/callback/google?code=fake-code&state=${state}${extra}`, { provider_oauth_google: { value: JSON.stringify(cookie) } });
  // An attempt written by hand for someone else: the link says who the drop belongs to, and it is not them.
  assert.equal((await flow.finishLinkOAuth(callback(attempt.state, { ...attempt, userId: 'u-victima' }), 'google', TOKEN)).url, page('error'));
  assert.equal((await flow.finishLinkOAuth(callback('otro-estado', attempt), 'google', TOKEN)).url, page('error'));
  assert.equal((await flow.finishLinkOAuth(callback(attempt.state, { ...attempt, createdAt: Date.now() - 11 * 60_000 }), 'google', TOKEN)).url, page('error'));
  assert.equal((await flow.finishLinkOAuth(callback(attempt.state, attempt, '&error=access_denied'), 'google', TOKEN)).url, page('cancelado'));
  // The drop changed hands or the link is not ours any more: checked again on the way back.
  const gone = harness({ tokens, owner: null });
  assert.equal((await gone.finishLinkOAuth(callback(attempt.state, attempt), 'google', TOKEN)).url, page('error'));
  const moved = harness({ tokens, owner: 'u-otra' });
  assert.equal((await moved.finishLinkOAuth(callback(attempt.state, attempt), 'google', TOKEN)).url, page('error'));
  for (const each of [flow, gone, moved]) assert.deepEqual(each.saves, []);
  assert.equal(flow.exchanges.length + gone.exchanges.length + moved.exchanges.length, 0, 'the provider is never asked for a token');
  // A link that is not ours does not start a consent: its page says so.
  const start2 = await gone.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  assert.equal(start2.url, `${BASE}/contactos/${TOKEN}`);
  assert.deepEqual(start2.values, {});
  // Partial consent, a failed exchange and a failed save are an error, not a connection.
  for (const options of [{ tokens: { refresh_token: 'r', scope: 'https://www.googleapis.com/auth/gmail.send' } }, { tokens: {}, tokenStatus: 400 }, { tokens, saveError: { message: 'db' } }]) {
    const failing = harness(options);
    const begun = await failing.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
    const made = JSON.parse(begun.values.provider_oauth_google.value);
    assert.equal((await failing.finishLinkOAuth(callback(made.state, made), 'google', TOKEN)).url, page('error'));
  }
  assert.equal(flow.attemptLink(JSON.stringify({ state: 'x' })), null);
  assert.equal(flow.attemptLink('no es json'), null);
  assert.equal(flow.attemptLink(undefined), null);
});

test('the app\'s own connection is as it was: it needs the session, and an attempt of the app is not a link attempt', async () => {
  const flow = harness({ sessionUser: 'u-ana', tokens: { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE } });
  const start = await flow.oauth.startProviderOAuth(request('/api/auth/connect/google'), 'google');
  const attempt = JSON.parse(start.values.provider_oauth_google.value);
  assert.equal('link' in attempt, false);
  assert.equal(flow.attemptLink(start.values.provider_oauth_google.value), null);
  const finish = await flow.oauth.finishProviderOAuth(request(`/api/auth/callback/google?code=fake-code&state=${attempt.state}`, start.values), 'google');
  assert.equal(finish.url, `${BASE}/gmail?connected=true`);
  assert.equal(flow.sessionSaves.length, 1);
  assert.deepEqual(flow.saves, []);
  const signedOut = harness({ sessionUser: null });
  assert.equal((await signedOut.oauth.startProviderOAuth(request('/api/auth/connect/google'), 'google')).url, `${BASE}/gmail?error=session_expired`);
});

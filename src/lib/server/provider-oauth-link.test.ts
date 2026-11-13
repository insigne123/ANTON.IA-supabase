import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

import { dropLinkBase, dropLinkHref } from './lead-drop-link';

// Gmail or Outlook connected from a «Contacto del día» email: the real OAuth helper and the link flow, with the provider, the
// database and the link check answered by hand.
const compile = (file: string) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const OAUTH = compile('src/lib/server/provider-oauth.ts');
const LINK = compile('src/lib/server/provider-oauth-link.ts');
const TOKEN = 'T'.repeat(48);
const BASE = 'https://app.example.test';

/** Google's id token, as its token endpoint returns it: the mailbox's address is in its claims. */
const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const OWN = 'ana@brigadas.example';

function harness(options: { owner?: string | null; connected?: Array<'google' | 'outlook'>; tokens?: object; tokenStatus?: number; saveError?: object; sessionUser?: string | null;
  /** The email the drop's person signs in with, and what Microsoft says of the mailbox that consented. */ signIn?: string | null; me?: object; meStatus?: number;
  /** The address the emails' link opens at, when it is not the app's own (LEAD_DROPS_PUBLIC_URL). */ publicUrl?: string } = {}) {
  const saves: any[] = [], sessionSaves: any[] = [], exchanges: any[] = [], resolved: unknown[] = [], profiles: any[] = [];
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
      exports, { env }, async (url: string, init: any) => {
        if (String(url).startsWith('https://graph.microsoft.com/')) { profiles.push({ url: String(url), authorization: init.headers.Authorization }); return Response.json(options.me ?? { mail: OWN }, { status: options.meStatus || 200 }); }
        exchanges.push({ url, body: new URLSearchParams(init.body) });
        return Response.json(options.tokens || {}, { status: options.tokenStatus || 200 });
      });
    return exports;
  };
  const next = { NextResponse: { redirect } };
  const oauth = load(OAUTH, {
    'node:crypto': { createHash, randomBytes }, 'next/headers': { cookies: () => {} }, 'next/server': next, '@/lib/services/token-service': { tokenService },
    // The link's consent runs at the app's own address, whatever the public one is (app-origins.ts).
    '@/lib/server/app-origins': { publicAppOrigin: () => null, requestAppOrigin: (_headers: unknown, canonical: string) => canonical },
    '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.sessionUser ? { id: options.sessionUser } : null } }) } }) },
  });
  const link = load(LINK, {
    'next/server': next, '@/lib/server/lead-drop-link': { dropLinkHref, dropLinkBase: (base: string) => dropLinkBase(base, { LEAD_DROPS_PUBLIC_URL: options.publicUrl }) }, '@/lib/server/provider-oauth': oauth, '@/lib/services/token-service': { tokenService },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({ auth: { admin: { getUserById: async (id: string) => options.signIn === null ? { data: { user: null }, error: { message: 'not found' } }
      : { data: { user: { id, email: options.signIn ?? 'Ana@Brigadas.example' } }, error: null } } } }) },
    '@/lib/server/lead-drop-mail': { resolveDropLink: async (_client: unknown, token: unknown) => {
      resolved.push(token);
      if (token !== TOKEN || options.owner === null) throw new Error('not a link');
      return { dropId: 'drop-1', scope: { userId: options.owner || 'u-ana', organizationId: 'org-1' } };
    } },
    '@/lib/server/mail-sender-preference': { readMailSenderPreference: async () => ({ connected: { google: connected.has('google'), outlook: connected.has('outlook') } }) },
  });
  return { ...link, oauth, saves, sessionSaves, exchanges, resolved, profiles };
}
const request = (path: string, values: Record<string, any> = {}) => ({ nextUrl: new URL(path, BASE), cookies: { get: (name: string) => values[name] }, headers: new Headers({ host: 'app.example.test' }) });
const page = (state: string) => `${BASE}/contactos/${TOKEN}?correo=${state}`;
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

const GOOGLE = { refresh_token: 'fake-refresh', scope: GOOGLE_SCOPE, id_token: idToken({ email: 'Ana@Brigadas.example', email_verified: true }) };
const AZURE = { refresh_token: 'fake-refresh', scope: 'User.Read Mail.Send Mail.Read', access_token: 'fake-access' };

for (const [provider, saved, tokens] of [['google', 'google', GOOGLE], ['azure', 'outlook', AZURE]] as const) {
  test(`${provider}: a person with no mailbox connects their own from the email's link, without a session, and lands back on their contacts`, async () => {
    const flow = harness({ tokens });
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
  const flow = harness({ connected: ['outlook'], tokens: GOOGLE });
  const start = await flow.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  assert.equal(start.url, page('conectado'));
  assert.deepEqual(start.values, {});
  // Connected from the app while the consent was open: the consent is dropped.
  const late = harness({ tokens: GOOGLE });
  const begun = await late.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  const attempt = JSON.parse(begun.values.provider_oauth_google.value);
  const other = harness({ connected: ['google'], tokens: GOOGLE });
  const finish = await other.finishLinkOAuth(request(`/api/auth/callback/google?code=fake-code&state=${attempt.state}`, begun.values), 'google', TOKEN);
  assert.equal(finish.url, page('conectado'));
  assert.deepEqual(other.saves, []);
});

test('the cookie alone never says for whom: a forged attempt, another person\'s, a stale state or a link that is not ours save nothing', async () => {
  const tokens = GOOGLE;
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
  for (const options of [{ tokens: { ...GOOGLE, scope: 'https://www.googleapis.com/auth/gmail.send' } }, { tokens: {}, tokenStatus: 400 }, { tokens, saveError: { message: 'db' } }]) {
    const failing = harness(options);
    const begun = await failing.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
    const made = JSON.parse(begun.values.provider_oauth_google.value);
    assert.equal((await failing.finishLinkOAuth(callback(made.state, made), 'google', TOKEN)).url, page('error'));
  }
  assert.equal(flow.attemptLink(JSON.stringify({ state: 'x' })), null);
  assert.equal(flow.attemptLink('no es json'), null);
  assert.equal(flow.attemptLink(undefined), null);
});

test('only the account\'s own mailbox: a link passed on to someone else never ties their mailbox to the account that sent it', async () => {
  const through = async (provider: 'google' | 'azure', options: Parameters<typeof harness>[0]) => {
    const flow = harness(options);
    const start = await flow.startLinkOAuth(request(`/api/auth/connect/${provider}?enlace=${TOKEN}`), provider, TOKEN);
    const attempt = JSON.parse(start.values[`provider_oauth_${provider}`].value);
    const finish = await flow.finishLinkOAuth(request(`/api/auth/callback/${provider}?code=fake-code&state=${attempt.state}`, start.values), provider, TOKEN);
    return { flow, url: finish.url };
  };
  // Whoever consented is someone else (the link reached them by another way): nothing is kept, and the page says why.
  for (const [provider, options] of [
    ['google', { tokens: { ...GOOGLE, id_token: idToken({ email: 'victima@otra.example', email_verified: true }) } }],
    ['google', { tokens: { ...GOOGLE, id_token: idToken({ email: OWN, email_verified: false }) } }],
    ['google', { tokens: { ...GOOGLE, id_token: undefined } }],
    ['google', { tokens: { ...GOOGLE, id_token: 'no-es-un-token' } }],
    ['azure', { tokens: AZURE, me: { mail: 'victima@otra.example', userPrincipalName: 'victima@otra.example' } }],
    ['azure', { tokens: AZURE, meStatus: 401 }],
    ['azure', { tokens: { ...AZURE, access_token: undefined } }],
    // The account has no sign-in email to compare with, or it is not the mailbox's.
    ['google', { tokens: GOOGLE, signIn: null }],
    ['google', { tokens: GOOGLE, signIn: 'otra@brigadas.example' }],
  ] as const) {
    const { flow, url } = await through(provider, options as any);
    assert.equal(url, page('otro'), JSON.stringify(options));
    assert.deepEqual(flow.saves, []);
  }
  // Microsoft names the mailbox by its address or by its sign-in name: either being the account's is enough, in any letter case.
  const upn = await through('azure', { tokens: AZURE, me: { mail: null, userPrincipalName: 'ANA@brigadas.example' } });
  assert.equal(upn.url, page('conectado'));
  assert.deepEqual(upn.flow.saves, [{ userId: 'u-ana', provider: 'outlook', refresh: 'fake-refresh' }]);
  assert.deepEqual(upn.flow.profiles, [{ url: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', authorization: 'Bearer fake-access' }]);
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

test('with an address of its own for the emails, the consent runs on the app and the person goes back to that address', async () => {
  const PUBLIC = 'https://contactos.example.test';
  const flow = harness({ tokens: GOOGLE, publicUrl: PUBLIC });
  const begun = await flow.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN);
  const attempt = JSON.parse(begun.values.provider_oauth_google.value);
  // Google and Microsoft know the app's address only: the consent starts and comes back there.
  assert.equal(attempt.redirectUri, `${BASE}/api/auth/callback/google`);
  const done = await flow.finishLinkOAuth(request(`/api/auth/callback/google?code=fake-code&state=${attempt.state}`, { provider_oauth_google: { value: JSON.stringify(attempt) } }), 'google', TOKEN);
  assert.equal(done.url, `${PUBLIC}/contactos/${TOKEN}?correo=conectado`);
  assert.equal(flow.saves.length, 1);
  // A link that is not ours: its page, at the same address the email opened.
  const gone = harness({ owner: null, publicUrl: PUBLIC });
  assert.equal((await gone.startLinkOAuth(request(`/api/auth/connect/google?enlace=${TOKEN}`), 'google', TOKEN)).url, `${PUBLIC}/contactos/${TOKEN}`);
});

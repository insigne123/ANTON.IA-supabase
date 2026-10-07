import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextResponse } = require('next/server');
const source = readFileSync(new URL('./request-auth.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(options: { bearerUser?: any; error?: any; cookieUser?: any; active?: boolean; trusted?: boolean } = {}) {
  const calls: any[] = [];
  const bearer = { auth: { getUser: async (token: string) => { calls.push({ verified: token }); return { data: { user: options.bearerUser ?? { id: 'verified-a' } }, error: options.error }; } } };
  const cookie = { auth: { getUser: async () => { calls.push('cookie'); return { data: { user: options.cookieUser ?? null } }; } } };
  const modules: Record<string, any> = {
    '@supabase/supabase-js': { createClient: (_url: unknown, _key: unknown, settings: unknown) => { calls.push(settings); return bearer; } },
    '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: () => cookie }, 'next/headers': { cookies: () => ({}) }, 'next/server': { NextResponse },
    '@/lib/server/organization-context': { resolveActiveOrganization: async (client: unknown, userId: string, requested: string | null) => {
      calls.push({ membershipClient: client === bearer ? 'bearer' : 'cookie', userId, requested });
      return { active: options.active === false ? null : { organizationId: 'allowed-org' } };
    } },
    '@/lib/server/internal-api-auth': { isTrustedInternalRequest: () => Boolean(options.trusted) },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => { calls.push('admin'); throw new Error('No admin bypass'); } },
  };
  const testModule = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)((name: string) => modules[name], testModule, testModule.exports);
  return { ...testModule.exports, calls };
}

test('fresh bearer is verified by Auth and binds RLS membership to the same token, ignoring stale cookies/body identity', async () => {
  const f = fixture({ cookieUser: { id: 'stale-other' } });
  const request = new Request('https://app.test/api/leads/search', { method: 'POST', headers: { Authorization: 'Bearer fresh-token', 'x-user-id': 'forged-user' }, body: '{"user_id":"forged"}' });
  const auth = await f.requireSessionOrTrustedInternalRequest(request);
  assert.equal(auth.user.id, 'verified-a'); assert.equal(auth.organizationId, 'allowed-org');
  assert.equal(f.calls.includes('cookie'), false); assert.equal(f.calls.includes('admin'), false);
  assert.deepEqual(f.calls[0].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  assert.equal(f.calls[0].global.headers.Authorization, 'Bearer fresh-token');
  assert.deepEqual(f.calls[2], { membershipClient: 'bearer', userId: 'verified-a', requested: null });
});

test('invalid bearer never falls back to a valid cookie or untrusted internal identity', async () => {
  const f = fixture({ error: { code: 'bad_jwt' }, cookieUser: { id: 'cookie-valid' } });
  await assert.rejects(f.requireSessionOrTrustedInternalRequest(new Request('https://app.test/api/search', { headers: { Authorization: 'Bearer invalid', 'x-user-id': 'forged', 'x-organization-id': 'allowed-org' } })),
    (error: any) => error.status === 401);
  assert.equal(f.calls.includes('cookie'), false); assert.equal(f.calls.includes('admin'), false);
  const malformed = fixture({ cookieUser: { id: 'cookie-valid' } });
  await assert.rejects(malformed.requireSessionOrTrustedInternalRequest(new Request('https://app.test/api/search', { headers: { Authorization: 'Basic invalid' } })), (error: any) => error.status === 401);
});

test('authenticated bearer without membership remains forbidden and cookie-only clients remain supported', async () => {
  const denied = fixture({ active: false });
  await assert.rejects(denied.requireSessionOrTrustedInternalRequest(new Request('https://app.test/api/search', { headers: { Authorization: 'Bearer valid', 'x-organization-id': 'other-org' } })), (error: any) => error.status === 403);
  assert.equal(denied.calls.includes('admin'), false);
  const cookie = fixture({ cookieUser: { id: 'cookie-a' } });
  assert.equal((await cookie.requireSessionOrTrustedInternalRequest(new Request('https://app.test/api/search'))).user.id, 'cookie-a');
  assert.ok(cookie.calls.includes('cookie'));
});

test('auth response distinguishes expired authentication from organization access, without caching', async () => {
  const f = fixture();
  for (const [status, code] of [[401, 'AUTH_SESSION_EXPIRED'], [403, 'ORGANIZATION_ACCESS_REQUIRED'], [500, 'AUTH_CHECK_UNAVAILABLE']] as const) {
    const response = f.requestAuthErrorResponse(new f.RequestAuthError('Safe message', status));
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

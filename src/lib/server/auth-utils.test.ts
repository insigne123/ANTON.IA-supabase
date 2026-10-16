import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/server/auth-utils.ts', 'utf8');

test('route authorization verifies the cookie token with auth.getUser', () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(source, /supabase\.auth\.getSession\(\)/);
  assert.match(source, /return \{[\s\S]+user,[\s\S]+organizationId:[\s\S]+organizationIds,[\s\S]+supabase/);
});

// A revoked session: Supabase clears its cookie while verifying it, which Next forbids inside a Server Component. The
// page must see «no session» (and send the person to sign in), never a 500.
test('a session that Supabase revokes while verifying it is no session, not a server error', async () => {
  const { build } = await import('esbuild');
  const { createRequire } = await import('node:module');
  const bundle = await build({
    stdin: { contents: `export * from './src/lib/server/auth-utils';`, loader: 'ts', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', alias: { '@': `${process.cwd()}/src` },
    plugins: [{ name: 'stubs', setup(builder) {
      builder.onResolve({ filter: /^(@supabase\/auth-helpers-nextjs|next\/headers|next\/server|@\/lib\/server\/organization-context|@\/lib\/server\/request-auth)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ loader: 'js', contents: args.path === '@supabase/auth-helpers-nextjs'
        ? `export function createRouteHandlerClient(){ return { auth: { async getUser(){ throw new Error('Cookies can only be modified in a Server Action or Route Handler.'); } } }; }`
        : args.path === 'next/headers' ? 'export function cookies(){ return {}; }'
          : args.path === 'next/server' ? 'export const NextResponse = { json(){ return null; } };'
            : args.path.endsWith('request-auth') ? 'export class RequestAuthError extends Error {}; export async function requireSessionRequestAuth(){ throw new Error("unused"); }'
              : 'export async function resolveActiveOrganization(){ throw new Error("unused"); }' }));
    } }],
  });
  const compiled: { exports: any } = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  const { requireAuth, AuthError } = compiled.exports;
  await assert.rejects(requireAuth(), (error: any) => error instanceof AuthError && error.status === 401);
});

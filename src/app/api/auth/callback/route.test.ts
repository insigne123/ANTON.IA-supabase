import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { safeNextPath } from '@/lib/safe-next-path';
import { authCallbackOrigin } from '@/lib/server/auth-callback-origin';

const require = createRequire(import.meta.url);
const { NextResponse } = require('next/server');
const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const PUBLIC = 'https://studio--test.example.test';

function fixture(error: any = null, environment: Record<string, string | undefined> = { NODE_ENV: 'production', CANONICAL_APP_URL: PUBLIC }) {
    const calls: string[] = [];
    const warnings: unknown[] = [];
    const cookieStore = { get: () => ({ value: 'cookie-verifier' }) };
    const modules: Record<string, unknown> = {
        'next/server': { NextResponse },
        'next/headers': { cookies: () => cookieStore },
        '@/lib/safe-next-path': { safeNextPath },
        '@/lib/server/auth-callback-origin': { authCallbackOrigin: (url: URL) => authCallbackOrigin(url, environment) },
        '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: (context: any) => {
            assert.equal(context.cookies(), cookieStore, 'the exchange retains its cookie-backed verifier/session storage');
            return { auth: { exchangeCodeForSession: async (code: string) => { calls.push(code); return { error }; } } };
        } },
    };
    const testModule = { exports: {} as any };
    new Function('require', 'module', 'exports', 'console', compiled)((name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
        return modules[name];
    }, testModule, testModule.exports, { warn: (...args: unknown[]) => warnings.push(args) });
    return { GET: testModule.exports.GET as (request: Request) => Promise<Response>, calls, warnings };
}

test('recovery succeeds on the public origin behind App Hosting and keeps the next path and cookie exchange', async () => {
    const env = fixture();
    const response = await env.GET(new Request('https://0.0.0.0:8080/api/auth/callback?code=fixture-code&next=%2Frestablecer-clave', {
        headers: { host: '0.0.0.0:8080', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' },
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), `${PUBLIC}/restablecer-clave`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(env.calls, ['fixture-code']);
});

test('expired provider links and expired PKCE exchanges both land on the real public login', async () => {
    const provider = fixture();
    const response = await provider.GET(new Request('https://0.0.0.0:8080/api/auth/callback?error=access_denied&error_code=otp_expired&next=%2Frestablecer-clave'));
    assert.equal(response.headers.get('location'), `${PUBLIC}/login?enlace=vencido`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(provider.calls, []);
    const exchange = fixture({ code: 'flow_state_expired', status: 422, message: 'private-token-and-email' });
    const failed = await exchange.GET(new Request('https://0.0.0.0:8080/api/auth/callback?code=private-code&next=%2Frestablecer-clave'));
    assert.equal(failed.headers.get('location'), `${PUBLIC}/login?enlace=vencido`);
    assert.match(JSON.stringify(exchange.warnings), /flow_state_expired/);
    assert.doesNotMatch(JSON.stringify(exchange.warnings), /private-token|private-code|cookie-verifier/);
});

test('untrusted next URLs and forwarded hosts cannot redirect a session to another site', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2Fevil.example']) {
        const env = fixture();
        const response = await env.GET(new Request(`https://0.0.0.0:8080/api/auth/callback?code=fixture-code&next=${encodeURIComponent(next)}`));
        assert.equal(response.headers.get('location'), `${PUBLIC}/`);
    }
});

test('production missing or invalid public origin fails without exchanging a code or redirecting to a container', async () => {
    for (const environment of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', CANONICAL_APP_URL: 'https://0.0.0.0:8080' },
        { NODE_ENV: 'production', CANONICAL_APP_URL: 'javascript:alert(1)' }]) {
        const env = fixture(null, environment);
        const response = await env.GET(new Request('https://0.0.0.0:8080/api/auth/callback?code=fixture-code'));
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('location'), null);
        assert.deepEqual(env.calls, []);
    }
});

test('public origin preference, base URL compatibility and localhost development are explicit', () => {
    const internal = new URL('http://0.0.0.0:8080');
    assert.equal(authCallbackOrigin(internal, { CANONICAL_APP_URL: `${PUBLIC}/path`, NEXT_PUBLIC_BASE_URL: 'https://other.example' }), PUBLIC);
    assert.equal(authCallbackOrigin(internal, { NEXT_PUBLIC_BASE_URL: PUBLIC }), PUBLIC);
    assert.equal(authCallbackOrigin(internal, { NEXT_PUBLIC_APP_URL: PUBLIC }), PUBLIC);
    assert.equal(authCallbackOrigin(new URL('http://localhost:9003'), { NODE_ENV: 'development' }), 'http://localhost:9003');
    assert.throws(() => authCallbackOrigin(internal, { CANONICAL_APP_URL: 'https://user:password@evil.example' }));
});

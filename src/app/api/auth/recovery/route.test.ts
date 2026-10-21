import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { recoveryTokenHash } from '@/lib/recovery-link';

const require = createRequire(import.meta.url);
const { NextResponse } = require('next/server');
const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(error: any = null) {
    const verified: unknown[] = [];
    const warnings: unknown[] = [];
    const cookieStore = { get: () => ({ value: 'cookie-session' }) };
    const modules: Record<string, unknown> = {
        'next/server': { NextResponse },
        'next/headers': { cookies: async () => cookieStore },
        '@/lib/recovery-link': { recoveryTokenHash },
        '@supabase/auth-helpers-nextjs': { createRouteHandlerClient: (context: any) => {
            assert.equal(context.cookies(), cookieStore, 'the session the token opens is written to the response cookies');
            return { auth: { verifyOtp: async (params: unknown) => { verified.push(params); return { error }; } } };
        } },
    };
    const testModule = { exports: {} as any };
    new Function('require', 'module', 'exports', 'console', compiled)((name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
        return modules[name];
    }, testModule, testModule.exports, { warn: (...args: unknown[]) => warnings.push(args) });
    return { POST: testModule.exports.POST as (request: Request) => Promise<Response>, verified, warnings };
}

const post = (body: unknown) => new Request('https://0.0.0.0:8080/api/auth/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('pressing «Continuar» spends the recovery token once and answers ok', async () => {
    const env = fixture();
    const response = await env.POST(post({ tokenHash: 'abc_DEF-123' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(env.verified, [{ token_hash: 'abc_DEF-123', type: 'recovery' }]);
});

test('a token that is gone, used or expired answers «vencido» and logs only its code and status', async () => {
    const env = fixture({ code: 'otp_expired', status: 403, message: 'secret-token-and-person@example.test' });
    const response = await env.POST(post({ tokenHash: 'secret-token' }));
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: 'vencido' });
    assert.match(JSON.stringify(env.warnings), /otp_expired/);
    assert.doesNotMatch(JSON.stringify(env.warnings), /secret-token|person@example/);
});

test('anything that is not a token is refused before asking Supabase', async () => {
    for (const body of ['not json', {}, { tokenHash: 7 }, { tokenHash: '' }, { tokenHash: '<script>' }, { tokenHash: 'a'.repeat(300) }, null]) {
        const env = fixture();
        const response = await env.POST(post(body));
        assert.equal(response.status, 400, JSON.stringify(body)?.slice(0, 30));
        assert.deepEqual(await response.json(), { error: 'vencido' });
        assert.deepEqual(env.verified, []);
    }
});

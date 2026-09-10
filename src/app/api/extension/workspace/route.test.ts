import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { ExtensionRequestSchema, assertExtensionScope } from '../../../../lib/extension-contracts';

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const org = '550e8400-e29b-41d4-a716-446655440000';
const user = '550e8400-e29b-41d4-a716-446655440001';
const profile = { linkedinUrl: 'https://www.linkedin.com/in/ana' };
const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture() {
  const calls: any[] = [];
  class AuthError extends Error { status = 401; }
  const modules: Record<string, any> = {
    '@/app/api/opportunities/enrich-apollo/route': { POST: async (req: any) => { const body = await req.json(); calls.push(body); return NextResponse.json({ enriched: [] }); } },
    'next/server': { NextRequest, NextResponse }, zod: require('zod'),
    '@/lib/extension-contracts': { ExtensionRequestSchema, assertExtensionScope },
    '@/lib/server/auth-utils': { AuthError, requireAuth: async () => ({ organizationId: org, user: { id: user } }), handleAuthError: (error: any) => NextResponse.json({ error: error.message }, { status: error.status }) },
    '@/lib/server/extension-leads': { findExtensionLead: async (...args: any[]) => { calls.push(args); return null; }, saveExtensionLead: async (...args: any[]) => { calls.push(args); return { lead: { id: 'saved' } }; } },
  };
  const testModule = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (!modules[id]) throw new Error(`Unexpected dependency: ${id}`);
    return modules[id];
  }, testModule, testModule.exports);
  return { POST: testModule.exports.POST, calls };
}
function request(body: any, origin = 'https://app.antonia.ai', marker = '1') {
  return new NextRequest('https://app.antonia.ai/api/extension/workspace', { method: 'POST', headers: { origin, 'x-antonia-extension': marker }, body: JSON.stringify(body) });
}
test('rejects cross-origin and unmarked requests before reading authenticated data', async () => {
  const env = fixture();
  assert.equal((await env.POST(request({ action: 'session' }, 'https://www.linkedin.com'))).status, 403);
  assert.equal((await env.POST(request({ action: 'session' }, 'https://app.antonia.ai', ''))).status, 403);
  assert.equal(env.calls.length, 0);
});
test('revalidates both user and organization before a save', async () => {
  const env = fixture();
  const body = { action: 'save', profile, organizationId: org, userId: user };
  assert.equal((await env.POST(request({ ...body, organizationId: user }))).status, 409);
  assert.equal((await env.POST(request({ ...body, userId: org }))).status, 409);
  assert.equal(env.calls.length, 0);
  const response = await env.POST(request(body));
  assert.equal(response.status, 200);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0][0].organizationId, org);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('rejects malformed and oversized requests without side effects', async () => {
  const env = fixture();
  assert.equal((await env.POST(request({ action: 'save', organizationId: org, userId: user, profile: { linkedinUrl: 'https://evil.test/in/ana' } }))).status, 400);
  assert.equal((await env.POST(request({ action: 'message', previousMessage: 'x'.repeat(17000) }))).status, 413);
  assert.equal(env.calls.length, 0);
});
test('accepts the explicit browser origin behind an internal proxy URL', async () => {
  const env = fixture();
  const req = new NextRequest('http://localhost:8080/api/extension/workspace', { method: 'POST',
    headers: { origin: 'https://studio--leadflowai-3yjcy.us-central1.hosted.app', 'x-antonia-extension': '1' },
    body: JSON.stringify({ action: 'save', profile, organizationId: org, userId: user }) });
  assert.equal((await env.POST(req)).status, 200);
  assert.equal(env.calls.length, 1);
});
test('LinkedIn enrichment uses the idempotent enrichment route, not retired search mode', async () => {
  const env = fixture();
  const body = { action: 'enrich', profile, organizationId: org, userId: user, operationId: org, revealEmail: true, revealPhone: false };
  assert.equal((await env.POST(request(body))).status, 200);
  assert.deepEqual(env.calls[0], { tableName: 'people_search_leads', operationId: org, leads: [{ linkedinUrl: profile.linkedinUrl }], revealEmail: true, revealPhone: false });
});

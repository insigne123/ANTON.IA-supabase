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
function fixture(withLead = false) {
  const calls: any[] = [];
  class AuthError extends Error { status = 401; }
  const modules: Record<string, any> = {
    '@/app/api/opportunities/enrich-apollo/route': { POST: async (req: any) => { const body = await req.json(); calls.push(body); return NextResponse.json({ enriched: [] }); } },
    'next/server': { NextRequest, NextResponse }, zod: require('zod'),
    '@/lib/extension-contracts': { ExtensionRequestSchema, assertExtensionScope },
    '@/lib/server/auth-utils': { AuthError, requireAuth: async () => ({ organizationId: org, user: { id: user } }), handleAuthError: (error: any) => NextResponse.json({ error: error.message }, { status: error.status }) },
    '@/lib/server/extension-leads': { findExtensionLead: async (...args: any[]) => { calls.push(args); return withLead ? { id: 'lead', email: 'ana@example.test', linkedin_url: profile.linkedinUrl } : null; }, saveExtensionLead: async (...args: any[]) => { calls.push(args); return { lead: { id: 'saved' } }; } },
    '@/lib/server/extension-sends': { claimExtensionSend: async (...args: any[]) => { calls.push({ claim: args }); return { id: org, claimed: true }; }, finishExtensionSend: async (...args: any[]) => { calls.push({ finish: args }); return { id: org, status: 'confirmed' }; } },
    '@/lib/server/linkedin-bridge-ops': {
      listPendingLinkedinJobs: async (...args: any[]) => { calls.push({ jobs: args }); return []; },
      claimLinkedinJob: async (...args: any[]) => { calls.push({ jobClaim: args }); if (args[1] === user) return { id: 'job', status: 'claimed' }; throw new Error('Otro navegador reclamó este trabajo.'); },
      finishLinkedinJob: async (...args: any[]) => { calls.push({ jobFinish: args }); return { id: 'job', status: 'confirmed' }; },
      reportLinkedinNetwork: async (...args: any[]) => { calls.push({ network: args }); return { observed: 1, hasMore: false }; },
      reportLinkedinInbox: async (...args: any[]) => { calls.push({ inbox: args }); return { observed: 1, hasMore: false }; },
    },
    '@/lib/server/native-research': { listNativeResearchLeadStatuses: async () => [{ researchSnapshotId: 'snapshot', reportId: 'report' }] },
    '@/app/api/native-research/[reportId]/route': { POST: async (_req: any, context: any) => { calls.push({ retry: await context.params }); return NextResponse.json({ ok: true }); } },
    '@/lib/extension-profile-url': { canonicalExtensionProfileUrl: (value: string) => value },
    '@/lib/server/supabase-admin': { getSupabaseAdminClient: () => ({ from: (table: string) => {
      calls.push({ table });
      const query: any = { select: () => query, eq: (key: string, value: string) => { calls.push({ filter: key, value }); return query; }, maybeSingle: async () => ({ data: { linkedin_url: profile.linkedinUrl, primary_phone: '+511234567', enrichment_status: 'completed' }, error: null }) };
      return query;
    } }) },
    '@/lib/server/native-drafts': { createNativeDraft: async (input: any) => { calls.push({ draft: input }); return { status: 'drafted', draft: { draftId: org, versionId: user } }; } },
    'node:crypto': require('node:crypto'),
    '@/lib/server/extension-research-report': { extensionResearchReport: async (research: any) => ({ ...research, reportDocumentV2: { evidenceGraph: { claims: [{ type: 'fact', statement: 'Hecho validado V2', evidenceIds: ['fact'] }], facts: [{ id: 'fact', sourceId: 'source' }], sources: [{ id: 'source', url: 'https://example.test' }] }, sections: [{ key: 'angle', title: 'Ángulo comercial', paragraphs: [{ text: 'Enfoque comercial V2' }] }] } }) },
    '@/lib/server/seller-profile': { loadSellerProfile: async () => ({}) },
    '@/lib/server/linkedin-message-writer': { writeLinkedinMessage: async (input: any) => { calls.push({ generation: { prompt: JSON.stringify(input) } }); return { message: 'Mensaje de prueba', writerVersion: 'linkedin-conversation/v1' }; } },
  };
  modules['@/lib/server/extension-leads'].extensionResearchSubject = (row: any) => ({ id: row.id, linkedinUrl: row.linkedin_url });
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
test('phone status is a scoped read and synthesis retry delegates without enrichment or new research', async () => {
  const env = fixture(true);
  const base = { profile, organizationId: org, userId: user };
  assert.equal((await env.POST(request({ ...base, action: 'phone-status' }))).status, 400);
  const response = await env.POST(request({ ...base, action: 'phone-status', enrichmentId: 'person' }));
  assert.equal((await response.json()).phone, '+511234567');
  assert.ok(env.calls.some(call => call.filter === 'organization_id' && call.value === org));
  assert.ok(env.calls.some(call => call.filter === 'user_id' && call.value === user));
  assert.equal((await env.POST(request({ ...base, action: 'research-retry' }))).status, 200);
  assert.deepEqual(env.calls.find(call => call.retry).retry, { reportId: 'report' });
});
test('rejects cross-origin and unmarked requests before reading authenticated data', async () => {
  const env = fixture();
  assert.equal((await env.POST(request({ action: 'session' }, 'https://www.linkedin.com'))).status, 403);
  assert.equal((await env.POST(request({ action: 'session' }, 'https://app.antonia.ai', ''))).status, 403);
  assert.equal(env.calls.length, 0);
});
test('LinkedIn drafting receives final V2 facts and commercial analysis', async () => {
  const env = fixture(true);
  const response = await env.POST(request({ action: 'message', profile, organizationId: org, userId: user, instruction: 'Iniciar conversación' }));
  assert.equal(response.status, 200);
  const prompt = JSON.parse(env.calls.find(item => item.generation).generation.prompt);
  assert.equal(prompt.evidence[0].statement, 'Hecho validado V2');
  assert.equal(prompt.commercialAnalysis[0].paragraphs[0].text, 'Enfoque comercial V2');
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
test('extension worker origin still requires authenticated matching scope and marker', async () => {
  const env = fixture();
  const origin = `chrome-extension://${'a'.repeat(32)}`;
  const body = { action: 'save', profile, organizationId: org, userId: user };
  assert.equal((await env.POST(request(body, origin, ''))).status, 403);
  assert.equal((await env.POST(request(body, `${origin}.evil.test`))).status, 403);
  assert.equal((await env.POST(request({ ...body, userId: org }, origin))).status, 409);
  assert.equal(env.calls.length, 0);
  assert.equal((await env.POST(request(body, origin))).status, 200);
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
test('send authorization requires saved lead and authenticated scope; confirmed results require evidence', async () => {
  const env = fixture(true);
  const body = { action: 'send-claim', profile, organizationId: org, userId: user, sendMessage: 'Hola Ana' };
  assert.equal((await env.POST(request({ ...body, userId: org }))).status, 409);
  assert.equal(env.calls.length, 0);
  assert.equal((await fixture().POST(request(body))).status, 409);
  assert.equal((await env.POST(request(body))).status, 200);
  assert.deepEqual(env.calls.find(item => item.claim).claim[0], { organizationId: org, userId: user });
  const result = { action: 'send-result', profile, organizationId: org, userId: user, sendResult: { id: org, claimToken: user, status: 'confirmed' } };
  assert.equal((await env.POST(request(result))).status, 400);
  assert.equal((await env.POST(request({ ...result, sendResult: { ...result.sendResult, eventId: 'urn:event' } }))).status, 200);
});
test('linkedin bridge lists, claims and finishes jobs without a profile open', async () => {
  const env = fixture(true);
  const base = { organizationId: org, userId: user };
  const pending = await env.POST(request({ ...base, action: 'linkedin-jobs-pending' }));
  assert.equal(pending.status, 200);
  assert.deepEqual((await pending.json()).jobs, []);
  assert.equal((await env.POST(request({ ...base, action: 'linkedin-job-claim', jobId: user }))).status, 200);
  assert.equal((await env.POST(request({ ...base, action: 'linkedin-job-claim', jobId: org }))).status, 409);
  const done = await env.POST(request({ ...base, action: 'linkedin-job-result',
    jobResult: { jobId: user, claimToken: org, status: 'uncertain', error: 'Revisar' } }));
  assert.equal(done.status, 200);
  assert.equal((await env.POST(request({ ...base, action: 'linkedin-job-result' }))).status, 400);
});

test('linkedin sweeps accept bounded reports and refuse oversized pages', async () => {
  const env = fixture(true);
  const base = { organizationId: org, userId: user };
  const network = await env.POST(request({ ...base, action: 'network-report',
    networkEntries: [{ url: 'https://www.linkedin.com/in/ana', name: 'Ana' }], networkHasMore: false }));
  assert.equal(network.status, 200);
  assert.deepEqual(await network.json(), { observed: 1, hasMore: false });
  const inbox = await env.POST(request({ ...base, action: 'inbox-report',
    inboxThreads: [{ key: 't1', name: 'Ana', direction: 'in', replyNeeded: true }], inboxHasMore: true, inboxCursor: 'p2' }));
  assert.equal(inbox.status, 200);
  const oversized = await env.POST(request({ ...base, action: 'network-report',
    networkEntries: Array.from({ length: 201 }, () => ({ url: 'https://www.linkedin.com/in/a' })) }));
  assert.equal(oversized.status, 400);
  assert.equal(env.calls.filter(item => item.network || item.inbox).length, 2);
});
test('first email receives the visible instruction and different instructions have different idempotency keys', async () => {
  const env = fixture(true);
  for (const instruction of ['Proponer una llamada', 'Compartir un caso aprobado']) {
    const response = await env.POST(request({ action: 'email-draft', profile, organizationId: org, userId: user, instruction }));
    assert.equal(response.status, 200);
  }
  const drafts = env.calls.filter(item => item.draft).map(item => item.draft);
  assert.equal(drafts[0].userInstruction, 'Proponer una llamada');
  assert.equal(drafts[1].userInstruction, 'Compartir un caso aprobado');
  assert.notEqual(drafts[0].idempotencyKey, drafts[1].idempotencyKey);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('./extension-campaigns.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class AuthError extends Error { constructor(message: string, public status: number) { super(message); } }
const testModule = { exports: {} as any };
new Function('require', 'module', 'exports', code)((id: string) => {
  if (id === 'zod') return require('zod');
  if (id === '@/lib/server/auth-utils') return { AuthError };
  throw new Error(id);
}, testModule, testModule.exports);
const { addExtensionCampaignLead, listExtensionCampaigns, extensionCampaignApi } = testModule.exports;
const input = { organizationId: 'org', userId: 'user', campaignId: '550e8400-e29b-41d4-a716-446655440000', revision: 3, email: 'ana@example.test' };
const campaign = () => ({ id: input.campaignId, organization_id: 'org', user_id: 'user', revision: 3, status: 'draft',
  definition: { name: 'Prospección', emails: ['prior@example.test'], criteria: { titles: ['CEO'] }, messages: [{ body: 'Hola' }] } });

test('adds a recipient via revision checked PUT without approval or broadened criteria', async () => {
  const current = campaign(); const calls: any[] = [];
  const result = await addExtensionCampaignLead(input, async (path: string, method: string, body: any) => {
    calls.push({ path, method, body });
    return { campaign: method === 'PUT' ? { ...current, revision: 4 } : current };
  });
  assert.equal(result.revision, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(calls[1].body.definition.emails, ['prior@example.test', input.email]);
  assert.deepEqual(calls[1].body.definition.criteria, current.definition.criteria);
  assert.equal(calls[1].body.revision, 3);
});
test('retries for an included email are read-only and case insensitive', async () => {
  const current = campaign(); current.definition.emails.push('ANA@example.test');
  let count = 0;
  const result = await addExtensionCampaignLead(input, async () => { count++; return { campaign: current }; });
  assert.equal(result.alreadyAdded, true); assert.equal(count, 1);
});
test('rejects stale revisions, other tenants, other owners, immutable campaigns and full audiences', async () => {
  for (const patch of [{ revision: 4 }, { organization_id: 'other' }, { user_id: 'other' }, { status: 'approved' }, { status: 'paused' }, { definition: { ...campaign().definition, emails: Array.from({ length: 100 }, (_, i) => `${i}@example.test`) } }]) {
    const current = { ...campaign(), ...patch };
    await assert.rejects(addExtensionCampaignLead(input, async (_path: string, method: string) => {
      assert.notEqual(method, 'PUT'); return { campaign: current };
    }), AuthError);
  }
});
test('propagates a concurrent save conflict rather than silently retrying', async () => {
  await assert.rejects(addExtensionCampaignLead(input, async (_path: string, method: string) => {
    if (method === 'PUT') throw new AuthError('Concurrent revision', 409);
    return { campaign: campaign() };
  }), /Concurrent revision/);
});
test('list exposes only summary data with included and editable state', async () => {
  const current = campaign();
  const items = await listExtensionCampaigns(async () => ({ campaigns: [current] }), 'PRIOR@example.test');
  assert.equal(items[0].alreadyAdded, true); assert.equal(items[0].editable, true);
  assert.equal(items[0].definition, undefined);
});
test('HTTP adapter rejects arbitrary paths, redirects and unavailable schema', async () => {
  let count = 0;
  const call = extensionCampaignApi('https://app.antonia.ai', 'session=example', async (url: URL, init: any) => {
    count++; assert.equal(url.origin, 'https://app.antonia.ai'); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify({ setupRequired: true }), { status: 503 });
  });
  await assert.rejects(call('https://evil.test'), /INVALID_CAMPAIGN_PATH/); assert.equal(count, 0);
  await assert.rejects(call('/api/campaigns/bulk'), /todavía no están disponibles/);
});

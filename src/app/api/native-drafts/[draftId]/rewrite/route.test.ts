import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { NativeDraftPreflightError, isNativeDraftVersionConflict } from '@/lib/server/native-drafts';
import { normalizeEmailStyleSelection } from '@/lib/outsourcing-email-style-presets';
import { createFailedDraftPreflightV2 } from '@/lib/server/draft-preflight-v2';

const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const versionId = 'e4c25535-06ec-4dcb-b071-6033f4605cb5';
const params = { params: Promise.resolve({ draftId: 'draft-a' }) };
const valid = { instruction: 'Shorten it', expectedVersionId: versionId, previewOnly: true };

function harness(error?: unknown) {
  const calls: any[] = [];
  const sequence = { currentStep: { index: 1 } };
  const dependencies = {
    requireAuth: async () => ({ user: { id: 'user-a' }, organizationIds: ['org-a'] }),
    handleAuthError: () => { throw new Error('Unexpected auth error'); },
    resolveNativeDraftOrganization: async () => 'org-a',
    getCurrentNativeDraft: async () => ({ versionId }),
    resolveCampaignStepRewriteContext: async (input: any) => { calls.push({ sequence: input }); return sequence; },
    rewriteNativeDraft: async (input: any) => { calls.push(input); if (error) throw error; return input.previewOnly ? { proposal: { subject: 'Subject', body: 'Body', expectedVersionId: versionId } } : { draft: { versionId: 'child' } }; },
    normalizeEmailStyleSelection,
    NativeDraftPreflightError,
    isNativeDraftVersionConflict,
    NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200, headers: init?.headers }) },
  };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return { ...exports, calls, sequence };
}

test('preview returns the exact client proposal contract with no-store and server-resolved sequence', async () => {
  const route = harness();
  const result = await route.POST({ json: async () => ({ ...valid, campaignStepId: versionId, organizationId: 'spoof', sequenceContext: 'spoof' }) }, params);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(result.body.proposal, { subject: 'Subject', body: 'Body', expectedVersionId: versionId });
  assert.equal('draft' in result.body, false);
  assert.equal(route.calls[1].previewOnly, true);
  assert.equal(route.calls[1].expectedVersionId, versionId);
  assert.equal(route.calls[1].organizationId, 'org-a');
  assert.deepEqual(route.calls[1].sequenceContext, route.sequence);
});

test('invalid previews and stale versions cannot invoke generation', async () => {
  for (const [body, status] of [[{ ...valid, previewOnly: 'true' }, 400], [{ ...valid, expectedVersionId: undefined }, 400], [{ ...valid, expectedVersionId: '00000000-0000-4000-8000-000000000000' }, 409], [null, 400]] as const) {
    const route = harness();
    assert.equal((await route.POST({ json: async () => body }, params)).status, status);
    assert.equal(route.calls.length, 0);
  }
});

test('preview exposes preflight failures and fails closed for denied styles and archived drafts', async () => {
  for (const [error, status] of [
    [new NativeDraftPreflightError(createFailedDraftPreflightV2(['Invalid evidence'], [])), 422],
    [new Error('EMAIL_STYLE_FORBIDDEN'), 403],
    [new Error('NATIVE_DRAFT_STYLE_NOT_FOUND'), 404],
    [new Error('NATIVE_DRAFT_ARCHIVED'), 409],
    [new Error('NATIVE_DRAFT_PREVIEW_STYLE_CHANGE_UNSUPPORTED'), 409],
  ] as const) {
    const result = await harness(error).POST({ json: async () => valid }, params);
    assert.equal(result.status, status);
    assert.equal(result.body.proposal, undefined);
    if (status === 422) assert.equal(result.body.preflight.status, 'failed');
  }
});

test('existing persisted rewrite callers retain their 201 response', async () => {
  const result = await harness().POST({ json: async () => ({ ...valid, previewOnly: false }) }, params);
  assert.equal(result.status, 201);
  assert.equal(result.body.draft.versionId, 'child');
});

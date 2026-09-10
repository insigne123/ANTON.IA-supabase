import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { isNativeDraftVersionConflict } from '@/lib/server/native-drafts';

const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const versionId = 'e4c25535-06ec-4dcb-b071-6033f4605cb5';
const params = { params: Promise.resolve({ draftId: 'draft-a' }) };

function harness(error?: unknown, organizationId: string | null = 'org-a') {
  const calls: any[] = [];
  const dependencies = {
    requireAuth: async () => ({ user: { id: 'user-a' }, organizationIds: ['org-a'] }),
    handleAuthError: () => { throw new Error('Unexpected auth error'); },
    resolveNativeDraftOrganization: async () => organizationId,
    getCurrentNativeDraft: async () => ({ versionId }),
    reviseNativeDraft: async (input: any) => { calls.push(input); if (error) throw error; return { versionId: 'child', approval: { status: 'pending' } }; },
    isNativeDraftVersionConflict,
    NextResponse: { json: (body: any, init?: any) => ({ body, status: init?.status || 200, headers: init?.headers }) },
  };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return { ...exports, calls };
}

test('PATCH requires a valid current expectedVersionId before saving even identical content', async () => {
  for (const [expectedVersionId, status] of [[undefined, 400], ['bad', 400], ['00000000-0000-4000-8000-000000000000', 409]] as const) {
    const route = harness();
    const result = await route.PATCH({ json: async () => ({ subject: 'Subject', expectedVersionId }) }, params);
    assert.equal(result.status, status);
    assert.equal(route.calls.length, 0);
  }
});

test('PATCH applies only content under server scope, never supplied approval or generation metadata', async () => {
  const route = harness();
  const result = await route.PATCH({ json: async () => ({ expectedVersionId: versionId, subject: 'Subject', text: 'Body', organizationId: 'other', approval: { status: 'approved' }, generation: { provider: 'openai' } }) }, params);
  assert.equal(result.status, 201);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(route.calls[0], { organizationId: 'org-a', userId: 'user-a', draft: { versionId }, expectedVersionId: versionId, subject: 'Subject', text: 'Body' });
  assert.equal(result.body.draft.approval.status, 'pending');
});

test('PATCH rejects invalid content, inaccessible drafts and maps atomic parent races to 409', async () => {
  for (const content of [{}, { subject: 42 }, { text: '' }, { text: {}, body: 'fallback' }]) {
    const route = harness();
    assert.equal((await route.PATCH({ json: async () => ({ ...content, expectedVersionId: versionId }) }, params)).status, 400);
    assert.equal(route.calls.length, 0);
  }
  assert.equal((await harness(undefined, null).PATCH({ json: async () => ({}) }, params)).status, 404);
  for (const error of [{ code: '40001', message: 'stale messaging draft parent' }, new Error('NATIVE_DRAFT_ARCHIVED')]) {
    assert.equal((await harness(error).PATCH({ json: async () => ({ expectedVersionId: versionId, text: 'Body' }) }, params)).status, 409);
  }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { MessagingDraftV1Schema, canonicalSha256, createChildMessagingDraftV1, hashMessagingDraftContent } from '@/lib/messaging-contracts';

const source = await readFile(new URL('./native-drafts.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('native-drafts.ts', source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'appendNativeDraftRevisionWithMetadata')!;
const code = ts.transpileModule(`${helper.getText(ast)}\nexport { appendNativeDraftRevisionWithMetadata };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const parent = MessagingDraftV1Schema.parse({
  schemaVersion: 1,
  draftId: '10000000-0000-4000-8000-000000000001',
  versionId: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000003',
  userId: '10000000-0000-4000-8000-000000000004',
  researchSnapshotId: '10000000-0000-4000-8000-000000000005',
  revision: 1, parentVersionId: null, lifecycle: 'draft', channel: 'email',
  recipient: { leadRef: null, displayName: 'Ada', email: 'ada@example.com', linkedinUrl: null },
  content: { subject: 'Original', text: 'Original body', html: null },
  approval: { status: 'pending', decidedBy: null, decidedAt: null, reason: null },
  preflight: { status: 'pending', checkedAt: null, errors: [], warnings: [] },
  createdAt: '2026-09-09T12:00:00.000Z',
});
const metadata = {
  versionId: parent.versionId, draftId: parent.draftId, organizationId: parent.organizationId, userId: parent.userId,
  researchSnapshotId: parent.researchSnapshotId, generationMethod: 'human', provider: null, model: null,
  promptVersion: 'native-draft/manual-revision/v1', styleProfileId: null, claimIds: ['claim-1'],
};
function harness(rpc: (name: string, args: any) => Promise<any>) {
  const dependencies = {
    MessagingDraftV1Schema, canonicalSha256, createChildMessagingDraftV1, hashMessagingDraftContent,
    randomUUID: () => '10000000-0000-4000-8000-000000000006',
    unique: (values: string[]) => [...new Set(values)],
    getSupabaseAdminClient: () => ({ rpc }),
  };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return exports.appendNativeDraftRevisionWithMetadata;
}

test('native revision sends child content and attribution in exactly one scoped RPC', async () => {
  let calls = 0;
  const append = harness(async (name, args) => {
    calls += 1;
    assert.equal(name, 'append_native_messaging_draft_revision_v1');
    assert.equal(args.p_expected_parent_version_id, parent.versionId);
    assert.equal(args.p_draft_id, parent.draftId);
    assert.equal(args.p_content_hash, hashMessagingDraftContent(args.p_payload));
    assert.deepEqual(args.p_metadata, { ...metadata, versionId: args.p_payload.versionId });
    assert.notEqual(args.p_metadata.versionId, parent.versionId);
    assert.equal(args.p_payload.approval.status, 'pending');
    assert.equal(args.p_payload.preflight.status, 'pending');
    return { data: args.p_payload, error: null };
  });
  const revised = await append(parent, { content: { ...parent.content, subject: 'Edited' } }, metadata);
  assert.equal(revised.content.subject, 'Edited');
  assert.equal(revised.parentVersionId, parent.versionId);
  assert.equal(calls, 1);
  assert.equal(parent.content.subject, 'Original');
});

test('native revision propagates RPC errors without a non-atomic fallback and rejects altered responses', async () => {
  for (const error of [{ code: '40001' }, { code: 'PGRST202' }, new Error('metadata failure')]) {
    let calls = 0;
    const append = harness(async () => { calls += 1; return { data: null, error }; });
    await assert.rejects(() => append(parent, { content: parent.content }, metadata), (actual) => actual === error);
    assert.equal(calls, 1);
  }
  const append = harness(async (_name, args) => ({ data: { ...args.p_payload, content: parent.content }, error: null }));
  await assert.rejects(() => append(parent, { content: { ...parent.content, subject: 'Edited' } }, metadata), /NATIVE_DRAFT_PERSISTENCE_CONFLICT/);
});

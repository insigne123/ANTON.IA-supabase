import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { normalizeDraftWritingStyleV2, createDefaultDraftWritingStyleV2 } from './draft-context-v2';
import { getOutsourcingEmailStylePresetFromSelection, styleProfileFromOutsourcingEmailStylePreset, OUTSOURCING_EMAIL_STYLE_PRESETS, outsourcingEmailStylePresetSelection } from '@/lib/outsourcing-email-style-presets';
import { canonicalSha256 } from '@/lib/messaging-contracts';

const source = await readFile(new URL('./native-drafts.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('native-drafts.ts', source, ts.ScriptTarget.Latest, true);
const loader = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'loadServerWritingStyle')!;
const code = ts.transpileModule(`${loader.getText(ast)}\nexport { loadServerWritingStyle };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(resolveEmailStyleProfile: (input: any) => Promise<any>) {
  const dependencies = { resolveEmailStyleProfile, normalizeDraftWritingStyleV2, createDefaultDraftWritingStyleV2, getOutsourcingEmailStylePresetFromSelection, styleProfileFromOutsourcingEmailStylePreset };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return exports.loadServerWritingStyle;
}

test('native style loader delegates explicit organization/user scope and retains shared style identity', async () => {
  const profile = { tone: 'direct' };
  const row = { id: 'e4c25535-06ec-4dcb-b071-6033f4605cb5', name: 'Team style', profile, content_hash: canonicalSha256(profile), revision: 4 };
  const request = { organizationId: 'org-a', userId: 'user-a', styleProfileId: row.id };
  const load = harness(async (input) => { assert.deepEqual(input, { ...request, styleName: undefined }); return row; });
  assert.deepEqual(await load(request), { id: row.id, name: row.name, profile, contentHash: row.content_hash, revision: row.revision });
});

test('native preset preview checks scoped access without forwarding a materializing selection', async () => {
  const preset = OUTSOURCING_EMAIL_STYLE_PRESETS[0];
  let calls = 0;
  const load = harness(async (input) => {
    calls += 1;
    assert.equal(input.organizationId, 'org-a');
    assert.equal(input.userId, 'user-a');
    assert.equal(input.styleProfileId, null);
    assert.equal(input.styleName, null);
    return null;
  });
  const style = await load({ organizationId: 'org-a', userId: 'user-a', styleProfileId: outsourcingEmailStylePresetSelection(preset.id), readOnly: true });
  assert.equal(calls, 1);
  assert.equal(style.id, null);
  assert.deepEqual(style.profile, styleProfileFromOutsourcingEmailStylePreset(preset));
});

test('native loader never replaces access or selection failures with a default style', async () => {
  for (const message of ['EMAIL_STYLE_FORBIDDEN', 'NATIVE_DRAFT_STYLE_NOT_FOUND']) {
    const load = harness(async () => { throw new Error(message); });
    await assert.rejects(() => load({ organizationId: 'org-a', userId: 'user-a', styleProfileId: 'other-owner' }), new RegExp(message));
  }
});

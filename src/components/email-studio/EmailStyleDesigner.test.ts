import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { emailLibraryError, emailStyleDraftKey } from '@/lib/email-studio/library-contract';

const source = await readFile(new URL('./EmailStyleDesigner.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('EmailStyleDesigner.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveFunction: ts.FunctionDeclaration | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveStyle') saveFunction = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(saveFunction);
const code = ts.transpileModule(`${saveFunction.getText(ast)}\nexport { saveStyle };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(options: { readOnly?: boolean; busy?: boolean; error?: string; discard?: boolean } = {}) {
  const saved = { id: 'saved-id', name: 'Original', profile: { bodyTemplate: 'Original body' },
    revision: 3, isDefault: false, libraryScope: 'personal' };
  const draft = { name: 'New style' };
  const state: Record<string, any> = { Styles: [saved] };
  const requests: any[] = [];
  const baseline = { current: 'old baseline' };
  const dirtyRef = { current: true };
  const dependencies: Record<string, any> = {
    isBusy: options.busy || false, readOnly: options.readOnly || false, libraryScope: 'personal',
    discardChanges: () => options.discard !== false, window: { confirm: () => true },
    styleName: saved.name, profile: saved.profile, selectedStyleId: saved.id, selectedRevision: 3,
    styles: [saved], isDefault: false, sourceCollection: null, styleNameRef: { current: null },
    normalizeSavedStyle: (value: any) => value, createStyleDraft: () => draft,
    baseline, dirtyRef, emailStyleDraftKey, emailLibraryError, toast: () => {},
    console: { error: () => {} },
    loadStyles: async () => { state.refreshed = true; },
    fetch: async (_url: string, request: any) => {
      requests.push(JSON.parse(request.body));
      return { ok: !options.error, json: async () => options.error ? { error: options.error } : { style: saved } };
    },
  };
  for (const name of ['IsSaving', 'SaveError', 'SaveStatus', 'NameError', 'Styles', 'SelectedStyleId',
    'SelectedRevision', 'StyleName', 'Profile', 'IsDefault', 'LibraryScope', 'SourceCollection']) {
    dependencies[`set${name}`] = (value: any) => { state[name] = typeof value === 'function' ? value(state[name]) : value; };
  }
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return { saveStyle: exports.saveStyle, state, requests, baseline, dirtyRef, draft };
}

test('designer guards team mutations and busy actions, but permits a personal copy', async () => {
  for (const options of [{ readOnly: true }, { busy: true }, { discard: false }]) {
    const h = harness(options);
    await h.saveStyle('archive');
    assert.equal(h.requests.length, 0);
  }
  const h = harness({ readOnly: true });
  await h.saveStyle('duplicate', 'personal');
  assert.equal(h.requests[0].libraryScope, 'personal');
  assert.equal(h.requests[0].expectedRevision, 3);
});

test('archive clears the selected record before a refresh that may not replace the draft', async () => {
  const h = harness();
  await h.saveStyle('archive');
  assert.deepEqual(h.state.Styles, []);
  assert.equal(h.state.SelectedStyleId, '');
  assert.equal(h.state.SelectedRevision, undefined);
  assert.equal(h.state.LibraryScope, 'personal');
  assert.equal(h.state.SourceCollection, null);
  assert.equal(h.state.Profile, h.draft);
  assert.equal(h.baseline.current, emailStyleDraftKey(h.draft.name, h.draft, false, 'personal'));
  assert.equal(h.dirtyRef.current, false);
  assert.equal(h.state.refreshed, true);
});

test('revision conflict retains the draft, selection and baseline with actionable feedback', async () => {
  const h = harness({ error: 'EMAIL_STYLE_REVISION_CONFLICT' });
  await h.saveStyle();
  assert.equal(h.state.Profile, undefined);
  assert.equal(h.state.SelectedStyleId, undefined);
  assert.equal(h.baseline.current, 'old baseline');
  assert.equal(h.dirtyRef.current, true);
  assert.match(h.state.SaveError, /Recarga la biblioteca/);
  assert.equal(h.state.IsSaving, false);
});

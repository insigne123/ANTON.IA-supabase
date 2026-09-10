import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(result: any = { data: { revision: 3 }, error: null }, unauthorized = false) {
  const calls: any[] = [];
  const query: any = {};
  for (const method of ['select', 'match', 'eq', 'insert', 'update']) query[method] = (...args: any[]) => { calls.push([method, ...args]); return query; };
  query.single = query.maybeSingle = async () => result;
  const dependencies = {
    NextResponse: { json: (body: any, init: any) => ({ body, status: init?.status || 200 }) },
    requireSessionOrTrustedInternalRequest: async () => { if (unauthorized) throw new Error('unauthorized'); return { organizationId: 'org-a', user: { id: 'user-a' } }; },
    requestAuthErrorResponse: () => unauthorized ? { status: 401 } : null,
    getSupabaseAdminClient: () => ({ from: () => query }),
  };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return { ...exports, calls };
}
const request = (body: any) => new Request('https://example.test/checkpoint', { method: 'PUT', body: JSON.stringify(body) });

test('checkpoint scope is derived from auth, never supplied owner or workspace', async () => {
  const route = harness();
  const response = await route.PUT(request({ revision: 2, snapshot: { version: 1 }, user_id: 'victim', organization_id: 'other' }));
  assert.equal(response.status, 200);
  assert.deepEqual(route.calls.find((c: any[]) => c[0] === 'match'), ['match', { organization_id: 'org-a', user_id: 'user-a' }]);
  assert.deepEqual(route.calls.find((c: any[]) => c[0] === 'eq'), ['eq', 'revision', 2]);
});
test('stale updates and concurrent first inserts report conflicts', async () => {
  assert.equal((await harness({ data: null, error: null }).PUT(request({ revision: 3, snapshot: {} }))).status, 409);
  assert.equal((await harness({ data: null, error: { code: '23505' } }).PUT(request({ revision: 0, snapshot: {} }))).status, 409);
});
test('unauthorized and malformed checkpoints do not write', async () => {
  const unauthorized = harness(undefined, true);
  assert.equal((await unauthorized.PUT(request({ revision: 0, snapshot: {} }))).status, 401);
  assert.equal(unauthorized.calls.length, 0);
  for (const body of [{ revision: -1, snapshot: {} }, { revision: 0, snapshot: [] }, { revision: 1.1, snapshot: {} }]) {
    const route = harness();
    assert.equal((await route.PUT(request(body))).status, 400);
    assert.equal(route.calls.length, 0);
  }
});
test('missing migration fails explicitly and absent checkpoint is an empty workspace', async () => {
  assert.equal((await harness({ error: { code: '42P01' } }).GET(new Request('https://example.test'))).status, 503);
  const result = await harness({ data: null }).GET(new Request('https://example.test'));
  assert.deepEqual(result.body, { revision: 0, snapshot: null, scope: 'org-a:user-a' });
});

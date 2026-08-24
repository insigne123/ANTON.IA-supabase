import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const routeSource = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

async function loadRouteFunction(name: string) {
  const node = sourceFile.statements.find((statement) => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  if (!node) throw new Error(`${name} was not found in route.ts`);
  const output = ts.transpileModule(
    `${node.getText(sourceFile)}\nexport { ${name} };`,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const loadedModule = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
  return loadedModule[name] as (...args: any[]) => any;
}

const parseEmailStyleBody = await loadRouteFunction('parseEmailStyleBody');
const serializeEmailStyle = await loadRouteFunction('serializeEmailStyle');

test('email style input validation normalizes valid writes', () => {
  const profile = { tone: 'consultative', structure: ['context', 'value', 'cta'] };
  assert.deepEqual(parseEmailStyleBody({
    id: 'A8BE3D8A-8B6E-4BE3-9A56-9CB4DCEBEF52',
    name: '  Consultivo  ',
    profile,
    isDefault: true,
  }), {
    id: 'a8be3d8a-8b6e-4be3-9a56-9cb4dcebef52',
    name: 'Consultivo',
    profile,
    isDefault: true,
  });
});

test('email style input validation rejects malformed or over-broad writes', () => {
  const valid = { name: 'Directo', profile: { tone: 'direct' }, isDefault: false };
  const invalidInputs = [
    null,
    [],
    { ...valid, id: 'not-a-uuid' },
    { ...valid, name: '   ' },
    { ...valid, name: 'a'.repeat(121) },
    { ...valid, profile: [] },
    { ...valid, profile: null },
    { ...valid, profile: { template: 'invalid\0text' } },
    { ...valid, isDefault: 'true' },
    { ...valid, organizationId: 'spoofed-org' },
    { ...valid, profile: { template: 'a'.repeat(256 * 1024 + 1) } },
  ];

  for (const input of invalidInputs) {
    assert.throws(() => parseEmailStyleBody(input), /EMAIL_STYLE_INVALID_REQUEST/);
  }
});

test('email style responses preserve the public camel-case contract', () => {
  assert.deepEqual(serializeEmailStyle({
    id: 'style-1',
    name: 'Directo',
    profile: { tone: 'direct' },
    revision: 3,
    is_default: true,
    updated_at: '2026-08-24T12:00:00.000Z',
  }), {
    id: 'style-1',
    name: 'Directo',
    profile: { tone: 'direct' },
    revision: 3,
    isDefault: true,
    updatedAt: '2026-08-24T12:00:00.000Z',
  });
});

test('email style reads use authenticated user and primary organization scope and ordering', () => {
  assert.match(routeSource, /const auth = await requireAuth\(\)/);
  assert.match(routeSource, /\.eq\('organization_id', auth\.organizationId\)\s*\.eq\('user_id', auth\.user\.id\)/);
  assert.match(routeSource, /\.order\('is_default', \{ ascending: false \}\)\s*\.order\('updated_at', \{ ascending: false \}\)/);
  assert.doesNotMatch(routeSource, /getSupabaseAdminClient|service_role/);
});

test('email style writes derive ownership and revisions on the server', () => {
  assert.match(routeSource, /organization_id: organizationId,\s*user_id: userId,/);
  assert.match(routeSource, /revision: currentRevision \+ 1/);
  assert.match(routeSource, /\.eq\('id', input\.id\)\s*\.eq\('organization_id', organizationId\)\s*\.eq\('user_id', userId\)\s*\.eq\('revision', currentRevision\)/);
  assert.match(routeSource, /const contentHash = canonicalSha256\(input\.profile\)/);
});

test('default selection is serialized and reconciles prior defaults within the same scope', () => {
  assert.match(routeSource, /withMutationLock\(\s*`\$\{auth\.organizationId\}:\$\{auth\.user\.id\}`/);
  assert.match(routeSource, /\.update\(\{ is_default: false, updated_at: updatedAt \}\)\s*\.eq\('organization_id', organizationId\)\s*\.eq\('user_id', userId\)\s*\.eq\('is_default', true\)\s*\.neq\('id', row\.id\)/);
  assert.match(routeSource, /\.update\(\{ is_default: true, updated_at: updatedAt \}\)\s*\.eq\('id', row\.id\)\s*\.eq\('organization_id', organizationId\)\s*\.eq\('user_id', userId\)/);
  assert.ok(
    routeSource.indexOf('.update({ is_default: true, updated_at: updatedAt })')
      < routeSource.indexOf('.update({ is_default: false, updated_at: updatedAt })'),
    'the target must be promoted before other defaults are cleared so concurrent writes cannot leave multiple defaults',
  );
});

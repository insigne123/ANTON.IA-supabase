import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const routeSource = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function sourceFor(name: string) {
  const statement = sourceFile.statements.find((candidate) => (
    ts.isFunctionDeclaration(candidate) && candidate.name?.text === name
  ));
  if (!statement) throw new Error(`${name} was not found in route.ts`);
  return statement.getText(sourceFile);
}

const uuidDeclaration = sourceFile.statements.find((candidate) => (
  ts.isVariableStatement(candidate)
  && candidate.declarationList.declarations.some((declaration) => (
    ts.isIdentifier(declaration.name) && declaration.name.text === 'UUID_RE'
  ))
));
if (!uuidDeclaration) throw new Error('UUID_RE was not found in route.ts');

const helperModuleSource = [
  uuidDeclaration.getText(sourceFile),
  sourceFor('isUuid'),
  sourceFor('resolveExistingRecordIds'),
  'export { resolveExistingRecordIds };',
].join('\n');
const helperModuleCode = ts.transpileModule(helperModuleSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = await import(`data:text/javascript;base64,${Buffer.from(helperModuleCode).toString('base64')}`);
const resolveExistingRecordIds = helperModule.resolveExistingRecordIds as (leads: Array<Record<string, string>>) => {
  ok: boolean;
  recordIds?: string[];
};

test('only UUID database references are treated as existing enrichment records', () => {
  const result = resolveExistingRecordIds([
    { id: 'apollo-person-id', clientRef: 'temporary-client-ref' },
    { existingRecordId: '11111111-1111-4111-8111-111111111111' },
    { clientRef: '11111111-1111-4111-8111-111111111111' },
  ]);

  assert.deepEqual(result, {
    ok: true,
    recordIds: ['11111111-1111-4111-8111-111111111111'],
  });
});

test('explicit non-UUID record references are rejected before provider work begins', () => {
  assert.deepEqual(resolveExistingRecordIds([
    { existingRecordId: 'record-from-another-system' },
  ]), { ok: false });
});

test('record updates remain scoped to the requesting organization', () => {
  const protectedUpdates = routeSource.match(/\.update\(updateData\)[\s\S]*?\.eq\('id', enrichedId\)[\s\S]*?\.eq\('organization_id', organizationId\)/g) || [];
  assert.equal(protectedUpdates.length, 2);
  assert.match(routeSource, /existingRecordsBelongToOrganization\([\s\S]*?\.eq\('organization_id', params\.organizationId\)/);
});

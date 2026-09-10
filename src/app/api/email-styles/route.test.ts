import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';
import { canonicalSha256 } from '@/lib/messaging-contracts';
import { canPublishEmailTemplates } from '@/lib/email-studio/library-contract';
import { GRUPOEXPRO_REFERENCE_TEMPLATES } from '@/lib/email-studio/grupoexpro-templates';
import { OUTSOURCING_EMAIL_STYLE_PRESETS, outsourcingEmailStylePresetSelection, styleProfileFromOutsourcingEmailStylePreset } from '@/lib/outsourcing-email-style-presets';

const source = await readFile(new URL('./route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const stripped = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join('\n');
const code = ts.transpileModule(`${stripped}\nexport { parseEmailStyleBody, serializeEmailStyle };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = 'a8be3d8a-8b6e-4be3-9a56-9cb4dcebef52';
const valid = { name: 'Directo', profile: { tone: 'direct' }, isDefault: false };
const row = { id, name: 'Directo', profile: valid.profile, content_hash: canonicalSha256(valid.profile),
  revision: 2, is_default: false, library_scope: 'personal', user_id: 'user-a', updated_at: '2026-09-09' };

function harness(options: { role?: string; rows?: any[]; rpcError?: any } = {}) {
  const calls: any[] = [];
  const filters: any[] = [];
  const query: any = {};
  for (const method of ['select', 'eq', 'or', 'is', 'order']) query[method] = (...args: any[]) => {
    filters.push([method, ...args]); return query;
  };
  query.range = async () => ({ data: options.rows || [row], error: null });
  const auth = { organizationId: 'org-a', user: { id: 'user-a' }, organizationRole: options.role || 'member',
    supabase: { from: () => query, rpc: async (...args: any[]) => { calls.push(args); return { data: row, error: options.rpcError }; } } };
  const dependencies = { z, canonicalSha256, canPublishEmailTemplates, GRUPOEXPRO_REFERENCE_TEMPLATES,
    OUTSOURCING_EMAIL_STYLE_PRESETS, outsourcingEmailStylePresetSelection, styleProfileFromOutsourcingEmailStylePreset,
    materializedOutsourcingEmailStylePresetId: () => null, requireAuth: async () => auth,
    handleAuthError: () => { throw new Error('unexpected auth error'); },
    NextResponse: { json: (body: any, init: any) => ({ body, status: init?.status || 200, headers: init?.headers }) } };
  const exports: any = {};
  new Function(...Object.keys(dependencies), 'exports', code)(...Object.values(dependencies), exports);
  return { ...exports, calls, filters };
}

test('legacy create remains personal; update requires client revision and strips preset identity', () => {
  const { parseEmailStyleBody: parse } = harness();
  assert.equal(parse(valid).libraryScope, 'personal');
  assert.throws(() => parse({ ...valid, id }), /INVALID_REQUEST/);
  const result = parse({ ...valid, id: id.toUpperCase(), expectedRevision: 7, profile: { presetId: 'pas', bodyTemplate: 'Hola' } });
  assert.equal(result.id, id); assert.equal(result.expectedRevision, 7);
  assert.deepEqual(result.profile, { bodyTemplate: 'Hola' });
});

test('rejects spoofed scope, metadata, invalid revisions and malformed JSON profiles', () => {
  const { parseEmailStyleBody: parse } = harness();
  for (const input of [null, [], { ...valid, organizationId: 'other' }, { ...valid, ownerId: 'other' },
    { ...valid, publishedBy: 'admin' }, { ...valid, libraryScope: 'official' },
    { ...valid, libraryScope: 'team' }, { ...valid, expectedRevision: 1 },
    { ...valid, id, expectedRevision: 0 }, { ...valid, id, expectedRevision: 1.5 },
    { ...valid, action: 'archive' }, { ...valid, action: 'duplicate' },
    { ...valid, profile: [] }, { ...valid, profile: null }, { ...valid, profile: { a: NaN } },
    { ...valid, name: '\0bad' }, { ...valid, name: ' ' }, { ...valid, name: 'a'.repeat(121) },
    { ...valid, profile: { a: 'bad\0' } }, { ...valid, profile: { a: 'x'.repeat(262145) } }]) {
    assert.throws(() => parse(input), /INVALID_REQUEST/);
  }
});

test('POST derives organization and forwards expected revision to transactional RPC', async () => {
  const route = harness();
  const response = await route.POST({ json: async () => ({ ...valid, id, expectedRevision: 1 }) });
  assert.equal(response.status, 200);
  assert.equal(route.calls[0][0], 'mutate_email_template_v1');
  assert.equal(route.calls[0][1].p_organization_id, 'org-a');
  assert.equal(route.calls[0][1].p_expected_revision, 1);
  assert.equal(route.calls[0][1].p_content_hash, canonicalSha256(valid.profile));
  assert.equal(response.body.style.libraryScope, 'personal');
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('publish allowed only for existing owner/admin roles, never client assertions', async () => {
  for (const role of ['member', 'super_admin', 'owner', 'admin']) {
    const route = harness({ role });
    const response = await route.POST({ json: async () => ({ ...valid, libraryScope: 'team', publishConfirmed: true }) });
    const allowed = role === 'owner' || role === 'admin';
    assert.equal(response.status, allowed ? 201 : 403);
    assert.equal(route.calls.length, allowed ? 1 : 0);
  }
});

test('duplicate and archive preserve source revision contract', async () => {
  for (const action of ['duplicate', 'archive']) {
    const route = harness();
    const response = await route.POST({ json: async () => ({ ...valid, id, action, expectedRevision: 2 }) });
    assert.equal(response.status, action === 'duplicate' ? 201 : 200);
    assert.equal(route.calls[0][1].p_action, action);
    assert.equal(route.calls[0][1].p_expected_revision, 2);
  }
});

test('mutation error statuses distinguish stale revision, name, access and missing row', async () => {
  for (const [error, status, code] of [
    [{ message: 'EMAIL_STYLE_REVISION_CONFLICT' }, 409, 'EMAIL_STYLE_REVISION_CONFLICT'],
    [{ code: '23505' }, 409, 'EMAIL_STYLE_NAME_CONFLICT'],
    [{ code: '42501' }, 403, 'EMAIL_STYLE_FORBIDDEN'],
    [{ message: 'EMAIL_STYLE_NOT_FOUND' }, 404, 'EMAIL_STYLE_NOT_FOUND'],
  ] as const) {
    const route = harness({ rpcError: error });
    const response = await route.POST({ json: async () => valid });
    assert.equal(response.status, status); assert.equal(response.body.error, code);
  }
});

test('GET scopes personal/team rows to active organization and hides references by default', async () => {
  const route = harness();
  const response = await route.GET({ nextUrl: new URL('https://example.test/api/email-styles?includePresets=true') });
  assert.deepEqual(response.body.references, []);
  assert.equal(response.body.styles.length, 5);
  assert.equal(response.body.canPublish, false);
  assert.ok(route.filters.some((filter: any[]) => JSON.stringify(filter) === JSON.stringify(['eq', 'organization_id', 'org-a'])));
  assert.ok(route.filters.some((filter: any[]) => filter[0] === 'or' && filter[1] === 'library_scope.eq.team,and(library_scope.eq.personal,user_id.eq.user-a)'));
  assert.ok(route.filters.some((filter: any[]) => filter[0] === 'is' && filter[1] === 'archived_at' && filter[2] === null));
});

test('explicit reference request returns six unapproved starters separately from saved styles', async () => {
  const route = harness();
  const response = await route.GET({ nextUrl: new URL('https://example.test/api/email-styles?referenceCollection=grupoexpro') });
  assert.equal(response.body.references.length, 6);
  assert.equal(response.body.styles.length, 1);
  assert.ok(response.body.references.every((reference: any) => reference.status === 'editable-reference'));
});

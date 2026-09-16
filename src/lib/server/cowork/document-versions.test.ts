import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthContext } from '@/lib/server/auth-utils';
import { listCoworkDocumentVersions } from './document-versions';

const id = '00000000-0000-4000-8000-000000000001';
test('version lookup restricts both older and newer sibling branches', async () => {
  const queries: Array<Record<string, unknown>> = [];
  const parentId = '00000000-0000-4000-8000-000000000002';
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {}; queries.push(filters);
    const chain = { select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      in: (key: string, value: unknown) => { filters[`in:${key}`] = value; return chain; },
      maybeSingle: async () => ({ data: table === 'cowork_runs' ? { id: filters.id, parent_run_id: filters.id === id ? parentId : null } : { document_id: 'doc', revision: 2 }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [{ revision: 2, run_id: id }], error: null })),
    }; return chain;
  } };
  const result = await listCoworkDocumentVersions({ user: { id: 'owner' }, organizationId: 'org', supabase: client } as AuthContext, id);
  assert.equal(result.currentRevision, 2);
  assert.ok(queries.every(query => query.user_id === 'owner' && query.organization_id === 'org'));
  assert.equal(queries[3].document_id, 'doc');
  assert.deepEqual(queries[3]['in:run_id'], [id, parentId]);
});

test('a work without document returns no versions', async () => {
  let calls = 0;
  const client = { from() { calls++; const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }; return q; } };
  const result = await listCoworkDocumentVersions({ user: { id: 'owner' }, organizationId: 'org', supabase: client } as AuthContext, id);
  assert.deepEqual(result.versions, []); assert.equal(calls, 1);
});

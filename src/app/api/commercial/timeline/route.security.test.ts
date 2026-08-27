import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

test('admin CRM lookup remains scoped to the authenticated organization', () => {
  assert.match(
    source,
    /\.from\('unified_crm_data'\)[\s\S]*?\.eq\('id', gid\)[\s\S]*?\.eq\('organization_id', organizationId\)[\s\S]*?\.maybeSingle\(\)/,
  );
});

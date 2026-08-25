import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/server/auth-utils.ts', 'utf8');

test('route authorization verifies the cookie token with auth.getUser', () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(source, /supabase\.auth\.getSession\(\)/);
  assert.match(source, /return \{[\s\S]+user,[\s\S]+organizationId:[\s\S]+organizationIds,[\s\S]+supabase/);
});

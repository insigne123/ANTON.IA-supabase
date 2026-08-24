import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260822140000_clone_messaging_draft_generation_metadata.sql', 'utf8');

test('every child messaging version atomically inherits immutable generation metadata', () => {
  assert.match(sql, /create or replace function public\.clone_messaging_draft_generation_metadata_v1/);
  assert.match(sql, /if new\.parent_version_id is null then/);
  assert.match(sql, /metadata\.version_id = new\.parent_version_id/);
  assert.match(sql, /metadata\.draft_id = new\.draft_id/);
  assert.match(sql, /metadata\.organization_id = new\.organization_id/);
  assert.match(sql, /metadata\.user_id = new\.user_id/);
  assert.match(sql, /on conflict \(version_id\) do nothing/);
  assert.match(sql, /after insert on public\.messaging_draft_versions/);
  assert.match(sql, /security definer/);
});

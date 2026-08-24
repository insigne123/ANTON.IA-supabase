import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260823150000_repair_native_draft_persistence.sql', 'utf8');

test('native draft persistence repair restores the style profile dependency and provenance column', () => {
  assert.match(migration, /create table if not exists public\.email_style_profiles/);
  assert.match(migration, /add column if not exists style_profile_id uuid/);
  assert.match(migration, /foreign key \(style_profile_id\)/);
  assert.match(migration, /references public\.email_style_profiles\(id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant all on table public\.email_style_profiles to service_role/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

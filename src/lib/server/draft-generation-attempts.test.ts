import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../../supabase/migrations/20260912130000_draft_generation_attempts.sql', import.meta.url),
  'utf8',
);

test('draft generation attempts are append-only cost telemetry without any send or approval surface', () => {
  assert.match(migration, /create table public\.messaging_draft_generation_attempts/);
  assert.match(migration, /origin in \('create', 'rewrite', 'rewrite_preview'\)/);
  assert.match(migration, /step in \('initial', 'follow_up', 'close'\)/);
  assert.match(migration, /input_tokens|output_tokens|reasoning_tokens/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.messaging_draft_generation_attempts from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.messaging_draft_generation_attempts to authenticated/);
  assert.match(migration, /grant all on table public\.messaging_draft_generation_attempts to service_role/);
  assert.match(migration, /Authenticated members can read draft generation attempts/);
  assert.doesNotMatch(migration, /for\s+(insert|update|delete)\s+to\s+authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete)\s+on table public\.messaging_draft_generation_attempts/i);
  assert.doesNotMatch(migration, /create\s+(trigger|function)/i);
});

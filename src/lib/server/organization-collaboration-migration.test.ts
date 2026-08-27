import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260826120000_organization_collaboration_v1.sql'),
  'utf8',
);

test('collaboration rollout remains disabled and service-owned by default', () => {
  assert.match(migration, /collaboration_v1_enabled boolean not null default false/);
  assert.match(migration, /Collaboration rollout is service-owned/);
  assert.match(migration, /grant execute on function public\.set_organization_collaboration_v1_enabled[\s\S]*to service_role/);
});

test('invitation backfill resolves pgcrypto in the hosted extensions schema', () => {
  assert.match(migration, /extensions\.digest\(token, 'sha256'\)/);
});

test('historical dispatch linking suspends and restores the immutable transition trigger', () => {
  const dropIndex = migration.indexOf('drop trigger if exists outbound_dispatches_transition_guard');
  const backfillIndex = migration.indexOf('update public.outbound_dispatches od\nset contact_thread_id');
  const restoreIndex = migration.indexOf('create trigger outbound_dispatches_transition_guard', backfillIndex);
  assert.ok(dropIndex >= 0 && backfillIndex > dropIndex && restoreIndex > backfillIndex);
});

test('recipient boundary preserves ambiguous outcomes and rejects parallel threads before providers', () => {
  assert.match(migration, /new\.status in \('failed', 'deferred'\)/);
  assert.doesNotMatch(migration, /new\.status in \('failed', 'deferred', 'unknown'\)/);
  assert.match(migration, /error_code = 'pre_provider_rejected'/);
  assert.match(migration, /active_campaign_id is distinct from v_campaign_id/);
});

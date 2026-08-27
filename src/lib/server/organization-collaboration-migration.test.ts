import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migration(name: string) {
  return readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), 'utf8')
    .replace(/\r\n/g, '\n');
}

const rolloutFlag = migration('20260827092000_organization_collaboration_rollout_flag.sql');
const invitations = migration('20260827093000_secure_organization_invitations.sql');
const backfill = migration('20260827101000_backfill_organization_contact_threads.sql');
const contactRuntime = migration('20260827102000_organization_contact_thread_runtime.sql');
const rolloutRuntime = migration('20260827104000_organization_collaboration_rollout_runtime.sql');
const antoniaRls = migration('20260827105000_secure_antonia_exceptions.sql');
const crmRls = migration('20260827106000_secure_unified_crm_data.sql');

test('collaboration rollout remains disabled and service-owned by default', () => {
  assert.match(rolloutFlag, /collaboration_v1_enabled boolean not null default false/);
  assert.match(rolloutFlag, /Collaboration rollout is service-owned/);
  assert.match(rolloutRuntime, /grant execute on function public\.set_organization_collaboration_v1_enabled[\s\S]*to service_role/);
});

test('invitation backfill revokes malformed legacy rows before removing plaintext', () => {
  assert.match(invitations, /extensions\.digest\(token, 'sha256'\)/);
  assert.match(invitations, /revoked_at = coalesce\(revoked_at, now\(\)\)/);
  assert.match(invitations, /role = 'member'/);
  assert.ok(invitations.indexOf('set revoked_at = now()') < invitations.indexOf('set token = null'));
});

test('historical dispatch linking never disables the global transition trigger', () => {
  assert.match(backfill, /set local session_replication_role = replica/);
  assert.match(backfill, /set local session_replication_role = origin/);
  assert.match(backfill, /set local lock_timeout = '5s'/);
  assert.doesNotMatch(backfill, /drop trigger if exists outbound_dispatches_transition_guard/);
});

test('recipient boundary preserves ambiguous outcomes and rejects parallel threads before providers', () => {
  assert.match(contactRuntime, /new\.status in \('failed', 'deferred'\)/);
  assert.doesNotMatch(contactRuntime, /new\.status in \('failed', 'deferred', 'unknown'\)/);
  assert.match(contactRuntime, /error_code = 'pre_provider_rejected'/);
  assert.match(contactRuntime, /active_campaign_id is distinct from v_campaign_id/);
});

test('rollout activation fails closed on unresolved production evidence', () => {
  assert.match(rolloutRuntime, /ambiguousRecipientCount/);
  assert.match(rolloutRuntime, /inFlightOrUnknownDispatchCount/);
  assert.match(rolloutRuntime, /unlinkedConfirmedDispatchCount/);
  assert.match(rolloutRuntime, /invalidConfirmedRecipientCount/);
  assert.match(rolloutRuntime, /Organization collaboration rollout checks failed/);
});

test('rollout activation serializes with outbound claims for the organization', () => {
  const lock = /organization-collaboration-rollout:/;
  assert.match(contactRuntime, lock);
  assert.match(rolloutRuntime, lock);
  assert.ok(
    rolloutRuntime.indexOf('organization-collaboration-rollout:')
      < rolloutRuntime.indexOf('organization_collaboration_rollout_report_v1(p_organization_id)'),
  );
});

test('legacy CRM hardening removes policy drift before granting scoped access', () => {
  assert.match(antoniaRls, /tablename = 'antonia_exceptions'/);
  assert.match(antoniaRls, /revoke all on table public\.antonia_exceptions from public, anon, authenticated/);
  assert.match(crmRls, /tablename = 'unified_crm_data'/);
  assert.match(crmRls, /is_current_user_organization_member\(organization_id\)/);
});

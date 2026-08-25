import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260825120000_campaign_outreach_v2.sql', 'utf8');
const pregeneratedDraftMigration = readFileSync(
  'supabase/migrations/20260825170000_campaign_v2_pregenerated_followup_drafts.sql',
  'utf8',
);
const researchMessagingMigration = readFileSync('supabase/migrations/20260813093000_research_messaging_v1.sql', 'utf8');
const prepareDraftSource = readFileSync('src/lib/server/campaigns-v2/prepare-draft.ts', 'utf8');
const inboundIngestionSource = readFileSync('src/lib/server/inbound-reply-ingestion.ts', 'utf8');
const trackingWebhookSource = readFileSync('src/app/api/tracking/webhook/route.ts', 'utf8');
const unsubscribeRouteSource = readFileSync('src/app/api/tracking/unsubscribe/route.ts', 'utf8');
const replyReconcileSource = readFileSync('src/app/api/replies/reconcile/route.ts', 'utf8');
const outboundDispatchSource = readFileSync('src/lib/server/outbound-dispatch.ts', 'utf8');

function block(start: string, end?: string) {
  const startIndex = migration.indexOf(start);
  assert.ok(startIndex >= 0, `${start} is missing`);
  const endIndex = end ? migration.indexOf(end, startIndex + start.length) : migration.length;
  assert.ok(endIndex > startIndex, `${end} is missing after ${start}`);
  return migration.slice(startIndex, endIndex);
}

function pregeneratedDraftBlock(start: string, end?: string) {
  const startIndex = pregeneratedDraftMigration.indexOf(start);
  assert.ok(startIndex >= 0, `${start} is missing`);
  const endIndex = end
    ? pregeneratedDraftMigration.indexOf(end, startIndex + start.length)
    : pregeneratedDraftMigration.length;
  assert.ok(endIndex > startIndex, `${end} is missing after ${start}`);
  return pregeneratedDraftMigration.slice(startIndex, endIndex);
}

test('Campaign V2 plan creation and dispatch binding share one draft lock and send-before-plan is rejected', () => {
  assert.match(migration, /campaigns_v2_initial_draft_uidx/);
  const bind = block(
    'create or replace function public.bind_campaign_recipient_step_dispatch_v2',
    'drop trigger if exists campaign_v2_bind_outbound_dispatch',
  );
  const rpc = block(
    'create or replace function public.create_first_contact_campaign_plan_v2',
    'create or replace function public.claim_campaign_recipient_step_prepare_v2',
  );
  assert.match(bind, /pg_advisory_xact_lock\(hashtextextended\(concat\(\s*'campaign-v2-draft:', new\.organization_id, ':', new\.draft_id\s*\), 0\)\)/);
  assert.match(rpc, /pg_advisory_xact_lock\(hashtextextended\(concat\(\s*'campaign-v2-draft:', p_organization_id, ':', p_draft_id\s*\), 0\)\)/);
  assert.ok(bind.indexOf('campaign-v2-draft:') < bind.indexOf('from public.campaign_recipient_steps crs'));
  assert.ok(rpc.indexOf('campaign-v2-draft:') < rpc.indexOf('from public.outbound_dispatches od'));
  const dispatchError = rpc.indexOf('Initial native draft already has an outbound dispatch');
  const dispatchCheck = rpc.slice(rpc.lastIndexOf('if exists (', dispatchError), dispatchError);
  assert.match(dispatchCheck, /from public\.outbound_dispatches od[\s\S]+od\.organization_id = p_organization_id[\s\S]+od\.user_id = p_user_id[\s\S]+od\.draft_id = p_draft_id/);
  assert.doesNotMatch(dispatchCheck, /od\.version_id/);
  assert.ok(rpc.indexOf("'created', false") < dispatchError);
  assert.ok(rpc.indexOf("'created', false") < rpc.indexOf('insert into public.campaigns'));
  assert.ok(dispatchError < rpc.indexOf('insert into public.campaigns'));
  assert.match(rpc, /insert into public\.campaign_sequence_versions/);
  assert.match(rpc, /insert into public\.campaign_enrollments/);
  assert.match(rpc, /insert into public\.campaign_recipient_steps/);
  assert.match(migration, /research_snapshot_id uuid not null/);
  assert.match(rpc, /v_version\.research_snapshot_id is null[\s\S]+Campaign V2 initial draft requires a research snapshot/);
  assert.ok(rpc.indexOf('Campaign V2 initial draft requires a research snapshot') < rpc.indexOf('insert into public.campaigns'));
});

test('the sending claim takes the recipient privacy lock before the dispatch row lock', () => {
  const claim = block(
    'create or replace function public.claim_outbound_dispatch_sending_v2',
    'create or replace function public.reject_published_campaign_sequence_change_v2',
  );
  const recipientRead = claim.indexOf("metadata #>> '{recipient,email}'");
  const privacyLock = claim.indexOf("pg_advisory_xact_lock(hashtextextended(concat('privacy-delete:'");
  const dispatchUpdate = claim.indexOf('update public.outbound_dispatches');
  assert.ok(recipientRead >= 0 && recipientRead < privacyLock && privacyLock < dispatchUpdate);
  assert.match(claim, /status in \('pending', 'deferred'\)[\s\S]+attempt_count = p_expected_attempt_count/);
  assert.match(migration, /grant execute on function public\.claim_outbound_dispatch_sending_v2\(uuid, timestamptz, integer\) to service_role/);
  assert.match(outboundDispatchSource, /client\.rpc\('claim_outbound_dispatch_sending_v2'/);
  assert.doesNotMatch(outboundDispatchSource.slice(
    outboundDispatchSource.indexOf('async markSending'),
    outboundDispatchSource.indexOf('markSent', outboundDispatchSource.indexOf('async markSending')),
  ), /\.from\('outbound_dispatches'\)[\s\S]+\.update\(/);
});

test('known pre-provider rejection is a narrow terminal transition without provider invocation', () => {
  const transition = block(
    'create or replace function public.enforce_outbound_dispatch_transition',
    'create or replace function public.guard_campaigns_v2_authenticated_writes',
  );
  assert.match(transition, /old\.status in \('pending', 'deferred'\)[\s\S]+new\.status = 'failed'/);
  assert.match(transition, /new\.error_code = 'pre_provider_rejected'/);
  assert.match(transition, /new\.provider_response ->> 'providerInvoked' = 'false'/);
  const stateCheckStart = migration.indexOf('alter table public.outbound_dispatches\n  drop constraint if exists outbound_dispatches_state_check');
  const stateCheckEnd = migration.indexOf('-- A deterministic rejection before provider invocation is terminal and known.', stateCheckStart);
  assert.ok(stateCheckStart >= 0 && stateCheckEnd > stateCheckStart);
  const stateCheck = migration.slice(stateCheckStart, stateCheckEnd);
  assert.match(stateCheck, /status = 'failed'[\s\S]+started_at is null[\s\S]+completed_at is not null[\s\S]+attempt_count = 0/);
  assert.match(stateCheck, /error_code = 'pre_provider_rejected'[\s\S]+provider_response ->> 'providerInvoked' = 'false'/);
  assert.match(stateCheck, /status = 'failed' and started_at is not null and completed_at is not null and attempt_count >= 1/);
  assert.match(outboundDispatchSource, /function preProviderRejectionCode/);
  assert.match(outboundDispatchSource, /repository\.markPreProviderFailed/);
  assert.ok(outboundDispatchSource.indexOf('repository.markPreProviderFailed') < outboundDispatchSource.indexOf('input.provider.send'));
});

test('Campaign V2 tables are member-readable and service-role writable only', () => {
  assert.match(migration, /inbox_order_at timestamptz/);
  assert.match(migration, /assign_campaign_recipient_step_inbox_order_v2[\s\S]+old\.inbox_order_at[\s\S]+new\.inbox_order_at := old\.inbox_order_at/);
  for (const table of [
    'campaign_sequence_versions',
    'campaign_sequence_steps_v2',
    'campaign_enrollments',
    'campaign_recipient_steps',
  ]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(migration, /guard_campaigns_v2_authenticated_writes/);
  assert.match(migration, /guard_campaigns_v2_feature_flag/);
});

test('Campaign V2 dispatch finalization advances once from confirmed sent timestamps', () => {
  const rpc = block(
    'create or replace function public.finalize_campaign_recipient_step_dispatch_v2',
    '-- The existing history projection marks history_repair_status complete.',
  );
  assert.match(rpc, /if v_step\.state = 'sent' then[\s\S]+replayed', true/);
  assert.match(rpc, /v_sent_at \+ make_interval\(days => v_next_offset\)/);
  assert.match(rpc, /where id = v_next\.id and state = 'not_due' and due_at is null/);
  assert.match(rpc, /crs\.outbound_dispatch_id = v_dispatch\.id/);
  assert.match(rpc, /v_step\.state in \('skipped', 'blocked'\)[\s\S]+preservedTerminalState/);
  assert.match(rpc, /state not in \('sent', 'skipped', 'blocked'\)/);
  assert.doesNotMatch(rpc, /opened_at|clicked_at|open_count|click_count/);
});

test('draft revisions never relink a recipient step after its outbound dispatch is bound', () => {
  const revisionSync = block(
    'create or replace function public.sync_campaign_recipient_step_draft_review_v2',
    'drop trigger if exists sync_campaign_recipient_step_draft_review_v2',
  );
  const finalize = block(
    'create or replace function public.finalize_campaign_recipient_step_dispatch_v2',
    '-- The existing history projection marks history_repair_status complete.',
  );
  assert.match(revisionSync, /set native_version_id = new\.id/);
  assert.match(revisionSync, /and crs\.outbound_dispatch_id is null/);
  assert.match(finalize, /crs\.native_version_id = v_dispatch\.version_id/);
  assert.match(finalize, /v_dispatch\.version_id is distinct from v_step\.native_version_id/);
  assert.doesNotMatch(finalize, /^\s+native_version_id = v_dispatch\.version_id/m);
});

test('pre-generated draft revisions remain not due and due promotion reuses existing review state', () => {
  const revisionSync = pregeneratedDraftBlock(
    'create or replace function public.sync_campaign_recipient_step_draft_review_v2',
    'create or replace function public.promote_due_campaign_recipient_steps_v2',
  );
  const promotion = pregeneratedDraftBlock(
    'create or replace function public.promote_due_campaign_recipient_steps_v2',
    'revoke all on function public.create_first_contact_campaign_plan_v2',
  );
  assert.match(revisionSync, /when crs\.state = 'not_due' then 'not_due'/);
  assert.match(revisionSync, /and crs\.outbound_dispatch_id is null/);
  assert.match(promotion, /when v_step\.native_draft_id is null then 'ready_to_prepare'/);
  assert.match(promotion, /md\.current_version_id = v_step\.native_version_id/);
  assert.match(promotion, /mdv\.approval ->> 'status' = 'approved'/);
  assert.match(promotion, /then 'approved'[\s\S]+else 'review_required'/);
  assert.doesNotMatch(promotion, /set state = 'ready_to_prepare'/);
});

test('draft pre-generation config and linking are service-owned, scoped, atomic, and never approve or send', () => {
  const create = pregeneratedDraftBlock(
    'create or replace function public.create_first_contact_campaign_plan_v2',
    'create or replace function public.link_campaign_recipient_step_draft_v2',
  );
  const link = pregeneratedDraftBlock(
    'create or replace function public.link_campaign_recipient_step_draft_v2',
    'create or replace function public.reject_unlinked_campaign_draft_dispatch_v2',
  );
  const reserve = pregeneratedDraftBlock(
    'create or replace function public.reserve_campaign_recipient_step_draft_v2',
    'create or replace function public.link_campaign_recipient_step_draft_v2',
  );
  const orphanGuard = pregeneratedDraftBlock(
    'create or replace function public.reject_unlinked_campaign_draft_dispatch_v2',
    'create or replace function public.sync_campaign_recipient_step_draft_review_v2',
  );
  assert.match(create, /jsonb_array_length\(p_steps\) not between 1 and 4/);
  assert.match(create, /length\(trim\(coalesce\(p_sequence_instruction, ''\)\)\) not between 1 and 1000/);
  assert.match(create, /followUpDrafting/);
  assert.match(create, /styleProfileId/);
  assert.match(create, /coalesce\(settings, '\{\}'::jsonb\) -> 'followUpDrafting' is null/);

  assert.match(reserve, /pg_advisory_xact_lock\(hashtextextended\(concat\(/);
  assert.match(reserve, /set reserved_native_draft_id = p_draft_id,[\s\S]+reserved_native_version_id = p_version_id/);
  assert.match(reserve, /insert into public\.campaign_v2_draft_reservations/);
  assert.match(reserve, /v_campaign\.v2_status <> 'draft'/);
  assert.match(reserve, /v_enrollment\.status <> 'pending_initial_send'/);
  assert.doesNotMatch(reserve, /approval|outbound_dispatches/);

  assert.match(link, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(link, /feature_campaigns_v2_enabled/);
  assert.match(link, /c\.user_id = p_user_id/);
  assert.match(link, /md\.organization_id = p_organization_id[\s\S]+md\.user_id = p_user_id/);
  assert.match(link, /v_campaign\.v2_status <> 'draft'/);
  assert.match(link, /v_enrollment\.status <> 'pending_initial_send'/);
  assert.match(link, /v_step\.state <> 'not_due'/);
  assert.match(link, /reserved_native_draft_id is distinct from p_draft_id/);
  assert.match(link, /native_draft_id is null[\s\S]+native_version_id is null[\s\S]+outbound_dispatch_id is null/);
  assert.match(link, /native draft is already linked to another step/);
  assert.match(link, /set native_draft_id = p_draft_id,[\s\S]+native_version_id = p_version_id,[\s\S]+last_error = null/);
  assert.match(link, /update public\.campaign_v2_draft_reservations[\s\S]+set linked_at = coalesce\(linked_at, now\(\)\)/);
  assert.doesNotMatch(link, /set state =/);
  assert.doesNotMatch(link, /approval|outbound_dispatches|sendGmail|sendOutlook/);
  assert.match(orphanGuard, /from public\.campaign_v2_draft_reservations reservation/);
  assert.match(orphanGuard, /if found and not exists/);
  assert.match(orphanGuard, /crs\.native_draft_id = new\.draft_id/);
  assert.match(pregeneratedDraftMigration, /create trigger campaign_v2_reject_unlinked_draft_dispatch[\s\S]+before insert on public\.outbound_dispatches/);
  assert.match(pregeneratedDraftMigration, /revoke all on function public\.link_campaign_recipient_step_draft_v2[^;]+from public, anon, authenticated/);
  assert.match(pregeneratedDraftMigration, /grant execute on function public\.link_campaign_recipient_step_draft_v2[^;]+to service_role/);
  assert.match(pregeneratedDraftMigration, /grant execute on function public\.create_first_contact_campaign_plan_v2\(uuid, uuid, uuid, uuid, jsonb\)[\s\S]+to service_role/);
  assert.match(pregeneratedDraftMigration, /alter table public\.campaign_v2_draft_reservations enable row level security/);
  assert.match(pregeneratedDraftMigration, /revoke all on table public\.campaign_v2_draft_reservations from public, anon, authenticated/);
  assert.match(pregeneratedDraftMigration, /revoke all on function public\.bind_campaign_recipient_step_dispatch_v2\(\)[\s\S]+from public, anon, authenticated/);
  assert.match(pregeneratedDraftMigration, /revoke all on function public\.sync_campaign_recipient_step_draft_review_v2\(\)[\s\S]+from public, anon, authenticated/);
});

test('reserved follow-up drafts survive campaign deletion as blocked tombstones and are retained while live', () => {
  const retention = pregeneratedDraftBlock(
    'create or replace function public.delete_research_messaging_retention_v1',
    'create or replace function public.create_first_contact_campaign_plan_v2',
  );
  const orphanGuard = pregeneratedDraftBlock(
    'create or replace function public.reject_unlinked_campaign_draft_dispatch_v2',
    'create or replace function public.sync_campaign_recipient_step_draft_review_v2',
  );
  assert.match(retention, /c\.v2_status in \('draft', 'active'\)/);
  assert.match(retention, /crs\.reserved_native_draft_id = md\.id/);
  assert.match(orphanGuard, /campaign_v2_draft_reservations/);
  assert.match(orphanGuard, /recipient_step_id/);
  assert.doesNotMatch(pregeneratedDraftMigration, /recipient_step_id uuid not null references public\.campaign_recipient_steps/);
});

test('Campaign V2 dispatch insertion atomically claims one safe ready step', () => {
  const trigger = block(
    'create or replace function public.bind_campaign_recipient_step_dispatch_v2',
    'drop trigger if exists campaign_v2_bind_outbound_dispatch',
  );
  assert.match(migration, /outbound_dispatches_campaign_recipient_step_uidx[\s\S]+where campaign_recipient_step_id is not null/);
  assert.match(trigger, /Drafts without a V2 step mapping retain the legacy dispatch behavior/);
  assert.match(trigger, /feature_campaigns_v2_enabled/);
  assert.match(trigger, /v_campaign\.v2_status in \('stopped', 'blocked'\)/);
  assert.match(trigger, /v_step\.state = 'approved'/);
  assert.match(trigger, /current_version_id is distinct from new\.version_id/);
  assert.match(trigger, /approval ->> 'status' <> 'approved'/);
  assert.match(trigger, /preflight ->> 'status' <> 'passed'/);
  assert.match(trigger, /recipient is suppressed/);
  assert.match(trigger, /recipient has replied/);
  assert.match(trigger, /recipient has bounced/);
  assert.match(trigger, /set outbound_dispatch_id = new\.id,[\s\S]+state = 'dispatch_pending'/);
  const draftLock = trigger.indexOf('select md.* into v_draft');
  const stepLock = trigger.indexOf('select crs.* into v_step', trigger.indexOf('for update'));
  assert.ok(draftLock >= 0 && draftLock < stepLock);
  assert.doesNotMatch(trigger, /from public\.contacted_leads cl[\s\S]+order by cl\.id[\s\S]+for share/);
});

test('every Campaign V2 provider transition revalidates the claimed recipient', () => {
  const bind = block(
    'create or replace function public.bind_campaign_recipient_step_dispatch_v2',
    'drop trigger if exists campaign_v2_bind_outbound_dispatch',
  );
  const guard = block(
    'create or replace function public.guard_campaign_recipient_step_dispatch_link_v2',
    'drop trigger if exists campaign_v2_guard_outbound_dispatch_link',
  );
  for (const providerTransition of [bind, guard]) {
    assert.match(providerTransition, /lower\(trim\(ce\.recipient_email\)\)/);
    assert.match(providerTransition, /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_recipient_email\), 0\)\)/);
    assert.match(providerTransition, /evaluation_status, ''\)\) = 'do_not_contact'/);
    assert.match(providerTransition, /campaign_followup_allowed is false/);
    assert.match(providerTransition, /lower\(coalesce\(l\.status, ''\)\) = 'do_not_contact'/);
  }
  assert.match(guard, /new\.status <> 'sending'/);
  assert.match(guard, /v_step\.state not in \('dispatch_pending', 'deferred'\)/);
  assert.match(guard, /v_campaign\.v2_status <> 'draft'/);
  assert.match(guard, /v_campaign\.v2_status <> 'active'/);
  assert.match(guard, /current_version_id is distinct from new\.version_id/);
  assert.match(guard, /recipient became unsafe before provider delivery/);
});

test('privacy suppression is one service-role transaction that persists suppression before safety-stop and ancillary updates', () => {
  const safetyStop = block(
    'create or replace function public.safety_stop_campaign_recipient_v2',
    'create or replace function public.safety_stop_campaign_recipient_from_contacted_v2',
  );
  const suppression = block(
    'create or replace function public.apply_privacy_suppression_v2',
    'create or replace function public.delete_campaign_v2_for_retained_native_draft',
  );
  for (const rpc of [safetyStop, suppression]) {
    assert.match(rpc, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
    assert.match(rpc, /v_email text := lower\(trim\(coalesce\(p_email, ''\)\)\)/);
    assert.match(rpc, /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/);
  }
  const suppressionInsert = suppression.indexOf('insert into public.unsubscribed_emails');
  assert.ok(suppressionInsert >= 0);
  assert.ok(suppressionInsert < suppression.indexOf('safety_stop_campaign_recipient_v2'));
  assert.ok(suppressionInsert < suppression.indexOf('update public.contacted_leads'));
  assert.ok(suppressionInsert < suppression.indexOf('update public.leads'));
  assert.match(suppression, /set campaign_followup_allowed = false,[\s\S]+evaluation_status = 'do_not_contact'/);
  assert.match(suppression, /set status = 'do_not_contact'/);
  assert.match(migration, /revoke all on function public\.apply_privacy_suppression_v2\(text, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.apply_privacy_suppression_v2\(text, text\) to service_role/);
});

test('Campaign V2 privacy cascade and deterministic preparation claims remain recoverable', () => {
  assert.match(migration, /campaigns_initial_native_draft_fkey[\s\S]+on delete cascade/);
  const retainedDraftCleanup = block(
    'create or replace function public.delete_campaign_v2_for_retained_native_draft',
    'drop trigger if exists delete_campaign_v2_for_retained_native_draft',
  );
  assert.match(retainedDraftCleanup, /delete from public\.campaigns c/);
  assert.match(retainedDraftCleanup, /crs\.native_draft_id = old\.id/);
  assert.match(migration, /preparation_claim_token uuid/);
  const claim = block(
    'create or replace function public.claim_campaign_recipient_step_prepare_v2',
    'create or replace function public.stop_campaign_enrollment_v2',
  );
  assert.match(claim, /interval '15 minutes'/);
  assert.match(claim, /state not in \('ready_to_prepare', 'failed', 'drafting'\)/);
  assert.match(claim, /draft_preparation_in_progress/);
  assert.match(claim, /v_enrollment\.research_snapshot_id is null[\s\S]+'reason', 'research_snapshot_required'/);
  const snapshotGuard = claim.indexOf('research_snapshot_required');
  const lockedStepRead = claim.indexOf('select crs.* into v_step', snapshotGuard);
  assert.ok(snapshotGuard >= 0 && lockedStepRead > snapshotGuard);
  assert.match(claim, /'claimToken', v_claim_token/);
  assert.match(prepareDraftSource, /idempotencyKey: `campaign-recipient-step:\$\{input\.stepId\}`/);
  assert.ok((prepareDraftSource.match(/\.eq\('preparation_claim_token', claim\.claimToken\)/g) || []).length >= 3);
  assert.match(prepareDraftSource, /preparation_claim_token: null/);
});

test('retention exempts live Campaign V2 drafts while privacy deletion cascades after dispatch deletion', () => {
  const retainedDraftCleanup = block(
    'create or replace function public.delete_campaign_v2_for_retained_native_draft',
    'drop trigger if exists delete_campaign_v2_for_retained_native_draft',
  );
  const privacyDelete = block(
    'create or replace function public.delete_native_research_messaging_subject_v1',
    'alter function public.delete_research_messaging_retention_v1',
  );
  const retention = block(
    'create or replace function public.delete_research_messaging_retention_v1',
    'create or replace function public.create_first_contact_campaign_plan_v2',
  );
  assert.match(retainedDraftCleanup, /app\.privacy_delete'[\s\S]+app\.retention_delete'[\s\S]+delete from public\.campaigns c/);
  assert.match(retainedDraftCleanup, /elsif coalesce\(current_setting\('app\.retention_delete'[\s\S]+c\.v2_status in \('completed', 'stopped', 'blocked'\)/);
  assert.ok(privacyDelete.indexOf("set_config('app.retention_delete', 'off', true)") < privacyDelete.indexOf('apply_privacy_suppression_v2'));
  assert.ok(privacyDelete.indexOf('apply_privacy_suppression_v2') < privacyDelete.indexOf('delete_native_research_messaging_subject_core_v1'));
  assert.match(privacyDelete, /od\.status = 'sending'/);
  assert.match(privacyDelete, /'outcome', 'pending'[\s\S]+'reason', 'outbound_dispatch_sending'/);
  assert.ok(privacyDelete.indexOf("od.status = 'sending'") < privacyDelete.indexOf('delete_native_research_messaging_subject_core_v1'));
  const transition = block(
    'create or replace function public.enforce_outbound_dispatch_transition',
    'create or replace function public.guard_campaigns_v2_authenticated_writes',
  );
  assert.doesNotMatch(transition, /or coalesce\(auth\.role\(\), ''\) = 'service_role'/);
  assert.match(retention, /set_config\('app\.privacy_delete', 'off', true\)/);
  assert.match(retention, /set_config\('app\.retention_delete', 'on', true\)/);
  assert.match(retention, /c\.v2_status in \('draft', 'active'\)/);
  assert.match(retention, /c\.initial_native_draft_id = md\.id[\s\S]+crs\.native_draft_id = md\.id/);
  assert.match(migration, /revoke all on function public\.delete_native_research_messaging_subject_core_v1\(text\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\.delete_research_messaging_subject_v1\(text\) from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\.delete_research_messaging_retention_core_v1[^\n]+from public, anon, authenticated, service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.delete_native_research_messaging_subject_core_v1/);
  assert.doesNotMatch(migration, /grant execute on function public\.delete_research_messaging_retention_core_v1/);

  const subjectDelete = researchMessagingMigration.slice(
    researchMessagingMigration.indexOf('create or replace function public.delete_research_messaging_subject_v1'),
    researchMessagingMigration.indexOf('create or replace function public.delete_research_messaging_retention_v1'),
  );
  assert.ok(subjectDelete.indexOf('delete from public.outbound_dispatches od') < subjectDelete.indexOf('delete from public.messaging_drafts md'));
});

test('stop and dispatch finalization lock campaign, enrollment, and ordered steps consistently', () => {
  const stop = block(
    'create or replace function public.stop_campaign_enrollment_v2',
    'create or replace function public.promote_due_campaign_recipient_steps_v2',
  );
  const finalize = block(
    'create or replace function public.finalize_campaign_recipient_step_dispatch_v2',
    '-- The existing history projection marks history_repair_status complete.',
  );
  for (const rpc of [stop, finalize]) {
    assert.ok(rpc.indexOf('select c.*') < rpc.indexOf('select ce.*'));
    assert.ok(rpc.indexOf('select ce.*') < rpc.indexOf('order by crs.step_index'));
  }
  assert.ok(finalize.indexOf('select od.*') < finalize.indexOf('select c.*'));
  assert.match(finalize, /from public\.outbound_dispatches od[\s\S]+where od\.id = p_dispatch_id[\s\S]+for update/);
  assert.match(stop, /if v_enrollment\.status = 'stopped'[\s\S]+'replayed', true/);
  assert.match(stop, /if v_enrollment\.status in \('completed', 'blocked'\)[\s\S]+cannot be manually stopped/);
  assert.match(stop, /v_enrollment\.status not in \('pending_initial_send', 'active'\)/);
  assert.match(stop, /set status = 'stopped'[\s\S]+status in \('pending_initial_send', 'active'\)/);
  assert.match(stop, /state not in \('sent', 'skipped', 'blocked', 'sending', 'unknown'\)/);
  assert.match(stop, /od\.status in \('pending', 'deferred', 'failed'\)/);

  const promotion = block(
    'create or replace function public.promote_due_campaign_recipient_steps_v2',
    'create or replace function public.finalize_campaign_recipient_step_dispatch_v2',
  );
  const promotionLoop = promotion.slice(promotion.indexOf('loop'));
  assert.ok(promotionLoop.indexOf('select c.*') < promotionLoop.indexOf('select ce.*'));
  assert.ok(promotionLoop.indexOf('select ce.*') < promotionLoop.indexOf('select crs.*'));
  assert.doesNotMatch(promotion, /for update of crs skip locked/);
});

test('the locked safety-stop helper truthfully blocks live sequences and is used by privacy suppression', () => {
  const safetyStop = block(
    'create or replace function public.safety_stop_campaign_recipient_v2',
    'create or replace function public.safety_stop_campaign_recipient_from_contacted_v2',
  );
  const suppression = block(
    'create or replace function public.apply_privacy_suppression_v2',
    'create or replace function public.delete_campaign_v2_for_retained_native_draft',
  );
  assert.match(safetyStop, /ce\.status in \('pending_initial_send', 'active'\)/);
  assert.match(safetyStop, /c\.v2_status in \('draft', 'active'\)/);
  assert.match(safetyStop, /p_organization_id uuid default null/);
  assert.match(safetyStop, /p_user_id uuid default null/);
  assert.match(safetyStop, /p_organization_id is null or ce\.organization_id = p_organization_id/);
  assert.match(safetyStop, /p_user_id is null or ce\.user_id = p_user_id/);
  assert.ok(safetyStop.indexOf('select c.*') < safetyStop.indexOf('select ce.*'));
  assert.ok(safetyStop.indexOf('select ce.*') < safetyStop.indexOf('order by crs.step_index'));
  assert.match(safetyStop, /set state = 'blocked'/);
  assert.match(safetyStop, /set status = 'blocked'/);
  assert.match(safetyStop, /set v2_status = 'blocked'/);
  assert.match(suppression, /v_safety_stop := public\.safety_stop_campaign_recipient_v2\(v_email, 'recipient_suppressed'\)/);
  assert.match(migration, /revoke all on function public\.safety_stop_campaign_recipient_v2\(text, text, uuid, uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.safety_stop_campaign_recipient_v2\(text, text, uuid, uuid\) to service_role/);
});

test('scoped unsubscribe and contacted-derived stops fence Campaign V2 without cross-tenant authority', () => {
  const contactedStop = block(
    'create or replace function public.safety_stop_campaign_recipient_from_contacted_v2',
    'create or replace function public.record_scoped_unsubscribe_v2',
  );
  assert.match(contactedStop, /from public\.contacted_leads cl[\s\S]+where cl\.id = trim\(p_contacted_id\)/);
  assert.match(contactedStop, /v_contact\.organization_id,[\s\S]+v_contact\.user_id/);
  assert.match(contactedStop, /v_contact\.user_id is null or v_contact\.organization_id is null[\s\S]+contact_scope_missing/);

  const scopedUnsubscribe = block(
    'create or replace function public.record_scoped_unsubscribe_v2',
    'create or replace function public.apply_privacy_suppression_v2',
  );
  const privacyLock = scopedUnsubscribe.indexOf('pg_advisory_xact_lock');
  const unsubscribeInsert = scopedUnsubscribe.indexOf('insert into public.unsubscribed_emails');
  const safetyStop = scopedUnsubscribe.indexOf('safety_stop_campaign_recipient_v2', unsubscribeInsert);
  assert.ok(privacyLock >= 0 && privacyLock < unsubscribeInsert && unsubscribeInsert < safetyStop);
  assert.match(scopedUnsubscribe, /values \(v_email, p_user_id, p_organization_id, v_reason\)/);
  assert.match(scopedUnsubscribe, /p_organization_id,[\s\S]+p_user_id/);

  const lockTrigger = block(
    'create or replace function public.lock_unsubscribed_email_privacy_v2',
    'create or replace function public.safety_stop_campaign_recipient_v2',
  );
  assert.match(lockTrigger, /lower\(trim\(coalesce\(new\.email, ''\)\)\)/);
  assert.match(lockTrigger, /pg_try_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/);
  assert.match(lockTrigger, /errcode = '40001'/);
  assert.doesNotMatch(lockTrigger, /perform pg_advisory_xact_lock/);
  assert.match(lockTrigger, /before insert or update on public\.unsubscribed_emails/);
  assert.doesNotMatch(lockTrigger, /safety_stop_campaign_recipient_v2/);

  const contactedLock = block(
    'create or replace function public.lock_contacted_lead_campaign_safety_v2',
    'create or replace function public.lock_lead_campaign_safety_v2',
  );
  assert.match(contactedLock, /evaluation_status[\s\S]+campaign_followup_allowed[\s\S]+replied_at[\s\S]+bounced_at/);
  assert.match(contactedLock, /privacy-delete:/);
  assert.match(contactedLock, /pg_try_advisory_xact_lock[\s\S]+errcode = '40001'/);
  assert.match(contactedLock, /before insert or update on public\.contacted_leads/);
  const leadLock = block(
    'create or replace function public.lock_lead_campaign_safety_v2',
    'create or replace function public.safety_stop_campaign_recipient_v2',
  );
  assert.match(leadLock, /new\.status[\s\S]+do_not_contact[\s\S]+privacy-delete:/);
  assert.match(leadLock, /pg_try_advisory_xact_lock[\s\S]+errcode = '40001'/);
  assert.match(leadLock, /before insert or update on public\.leads/);

  assert.match(migration, /grant execute on function public\.safety_stop_campaign_recipient_from_contacted_v2\(text, text\) to service_role/);
  assert.match(migration, /grant execute on function public\.record_scoped_unsubscribe_v2\(text, uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.safety_stop_campaign_recipient[^\n]+to authenticated/);

  assert.match(unsubscribeRouteSource, /\.rpc\('record_scoped_unsubscribe_v2', \{[\s\S]+p_email: email,[\s\S]+p_user_id: userId,[\s\S]+p_organization_id: orgId/);
  assert.doesNotMatch(unsubscribeRouteSource, /\.from\('unsubscribed_emails'\)/);
});

test('inbound and direct bypass writers stop the contacted scope before Campaign V2 can continue', () => {
  const resolver = trackingWebhookSource.slice(
    trackingWebhookSource.indexOf('async function resolveContactedLeadForEvent'),
    trackingWebhookSource.indexOf('function fallbackFailureFromEvent'),
  );
  assert.match(resolver, /\.eq\('lead_id', leadId\)/);
  assert.match(resolver, /\.eq\('email', recipientEmail\)/);
  assert.match(resolver, /\.limit\(2\)/);
  assert.ok((resolver.match(/if \(error\) throw error/g) || []).length >= 2);
  assert.doesNotMatch(resolver, /\.maybeSingle\(\)/);
  assert.match(trackingWebhookSource, /recipientEmail: email/);

  const ingestRpc = inboundIngestionSource.indexOf("supabase.rpc('ingest_inbound_reply_v1'");
  const clientIngestEnd = inboundIngestionSource.indexOf('\n}', ingestRpc) + 2;
  const clientIngest = inboundIngestionSource.slice(ingestRpc, clientIngestEnd);
  const inboundWrapper = block(
    'create or replace function public.ingest_inbound_reply_v1',
    'create or replace function public.lookup_campaign_v2_subject_v2',
  );
  assert.ok(ingestRpc >= 0 && clientIngestEnd > ingestRpc);
  assert.doesNotMatch(clientIngest, /safetyStopCampaignRecipientFromContacted|recordInboundUnsubscribe/);
  assert.match(inboundWrapper, /ingest_inbound_reply_core_v1/);
  assert.match(inboundWrapper, /record_inbound_unsubscribe_v1/);
  assert.match(inboundWrapper, /safety_stop_campaign_recipient_from_contacted_v2/);

  const failureBranch = trackingWebhookSource.indexOf("if (['bounce', 'blocked', 'dropped', 'deferred'].includes(eventType))");
  const webhookStop = trackingWebhookSource.indexOf('safetyStopCampaignRecipientFromContacted(supabase', failureBranch);
  const webhookUpdate = trackingWebhookSource.indexOf('updateContactedLead(supabase', failureBranch);
  assert.ok(failureBranch >= 0 && webhookStop > failureBranch && webhookStop < webhookUpdate);
  assert.match(trackingWebhookSource.slice(webhookStop, webhookUpdate), /reason: 'recipient_bounced'/);

  const reconcileStop = replyReconcileSource.indexOf('safetyStopCampaignRecipientFromContacted(admin');
  const reconcileUpdate = replyReconcileSource.indexOf(".from('contacted_leads')", reconcileStop);
  assert.ok(reconcileStop >= 0 && reconcileStop < reconcileUpdate);
  assert.match(replyReconcileSource.slice(reconcileStop, reconcileUpdate), /reason: 'recipient_replied'/);
  assert.match(replyReconcileSource, /if \(contactedResult\.error\) throw contactedResult\.error/);
  assert.match(replyReconcileSource, /RECONCILIATION_PAGE_SIZE \+ 1/);
  assert.match(replyReconcileSource, /nextCursor: hasMore/);
  assert.match(replyReconcileSource, /await findLatestReply\(admin, organizationId, row\)/);
  assert.doesNotMatch(replyReconcileSource, /\.limit\(1000\)/);
});

test('sent history completion includes Campaign V2 finalization in the same retryable transaction', () => {
  const wrapper = block(
    'create or replace function public.finalize_sent_outbound_dispatch_history_v1',
    'revoke all on function public.finalize_sent_outbound_dispatch_history_core_v1',
  );
  assert.match(migration, /rename to finalize_sent_outbound_dispatch_history_core_v1/);
  assert.ok(
    wrapper.indexOf('finalize_sent_outbound_dispatch_history_core_v1(p_dispatch_id)')
      < wrapper.indexOf('finalize_campaign_recipient_step_dispatch_v2(p_dispatch_id)'),
  );
  assert.match(wrapper, /return v_history \|\| jsonb_build_object\('campaignV2'/);
});

test('a sent recipient suppressed after provider claim settles without recreating contact history', () => {
  const finalize = block(
    'create or replace function public.finalize_campaign_recipient_step_dispatch_v2',
    '-- The existing history projection marks history_repair_status complete.',
  );
  assert.match(finalize, /sent_before_recipient_suppression/);
  assert.match(finalize, /'recipientSuppressed', true/);
  assert.match(finalize, /set status = 'blocked'/);
  assert.match(finalize, /set v2_status = 'blocked'/);
});

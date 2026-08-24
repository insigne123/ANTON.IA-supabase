import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260813093000_research_messaging_v1.sql';
const sql = readFileSync(migrationPath, 'utf8');
const nativeMigration = readFileSync('supabase/migrations/20260820100000_native_research_workspace.sql', 'utf8');
const nativeResearch = readFileSync('src/lib/server/native-research.ts', 'utf8');
const privacySubjectData = readFileSync('src/lib/server/privacy-subject-data.ts', 'utf8');
const privacySubjectActionsRoute = readFileSync('src/app/api/privacy/subject-actions/route.ts', 'utf8');
const privacyRequestsPage = readFileSync('src/app/(app)/settings/privacy-requests/page.tsx', 'utf8');

function functionBody(name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sql.slice(start, end);
}

test('privacy export filters recipient-bearing linked rows and reports omissions', () => {
  const body = functionBody('lookup_research_messaging_subject_v1');
  assert.match(body, /where lower\(trim\(coalesce\(lrj\.email, ''\)\)\) = v_email/);
  assert.match(body, /and lower\(trim\(coalesce\(mdv\.recipient ->> 'email', ''\)\)\) = v_email/);
  assert.match(body, /where lower\(trim\(coalesce\(od\.metadata #>> '\{recipient,email\}', ''\)\)\) = v_email/);
  assert.match(body, /'privacyReview'/);
  assert.match(body, /'cross_subject_linked_records_omitted'/);
  assert.doesNotMatch(body, /where lrj\.research_snapshot_id = any\(v_snapshot_ids\)\s+or lower/);
});

test('privacy lead responses traverse only through an exact-email contacted row', () => {
  for (const name of ['lookup_research_messaging_subject_v1', 'delete_research_messaging_subject_v1']) {
    const body = functionBody(name);
    assert.match(body, /cl\.id = lr\.contacted_id|lr\.contacted_id in/);
    assert.match(body, /lower\(trim\(coalesce\(cl\.email, ''\)\)\) = v_email/);
    assert.doesNotMatch(body, /l\.id::text = lr\.lead_id/);
    assert.doesNotMatch(body, /cl\.lead_id = lr\.lead_id/);
    assert.doesNotMatch(body, /lr\.organization_id is not distinct from/);
  }
});

test('linked snapshots require a matching payload subject email', () => {
  const lookup = functionBody('lookup_research_messaging_subject_v1');
  const deletion = functionBody('delete_research_messaging_subject_v1');

  assert.match(lookup, /into v_linked_snapshot_ids/);
  assert.match(lookup, /nullif\(trim\(coalesce\(rs\.payload #>> '\{subject,email\}', ''\)\), ''\) is null/);
  assert.match(lookup, /lower\(trim\(rs\.payload #>> '\{subject,email\}'\)\) <> v_email/);
  assert.match(lookup, /'legacyResearchSnapshots'/);
  assert.match(lookup, /'mismatchedResearchSnapshots'/);
  assert.match(deletion, /'linked_legacy_snapshot_missing_subject_email'/);
  assert.match(deletion, /'linked_snapshot_subject_email_mismatch'/);
  assert.match(deletion, /where lower\(trim\(coalesce\(rs\.payload #>> '\{subject,email\}', ''\)\)\) = v_email/);
});

test('privacy deletion globally suppresses before every manual-review return', () => {
  const deletion = functionBody('delete_research_messaging_subject_v1');
  const suppressionIndex = deletion.indexOf('insert into public.unsubscribed_emails (email, reason)');
  const firstManualReviewIndex = deletion.indexOf("'outcome', 'manual_review'");
  const manualReviewCount = (deletion.match(/'outcome', 'manual_review'/g) || []).length;
  const blockedManualReviewCount = (deletion.match(/'outcome', 'manual_review',\s*'blocked', true/g) || []).length;

  assert.ok(suppressionIndex > -1 && suppressionIndex < firstManualReviewIndex);
  assert.equal(blockedManualReviewCount, manualReviewCount);
  assert.match(deletion, /ue\.user_id is null\s+and ue\.organization_id is null/);
  assert.match(deletion, /on conflict do nothing/);
  assert.doesNotMatch(deletion, /delete from public\.unsubscribed_emails where lower\(trim\(email\)\) = v_email/);
});

test('history repair and privacy deletion serialize on the same normalized-email lock', () => {
  const repair = functionBody('repair_reconciled_sent_dispatch_history_v1');
  const deletion = functionBody('delete_research_messaging_subject_v1');
  const lock = /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/;

  assert.match(repair, lock);
  assert.match(deletion, lock);
  assert.ok(repair.indexOf('pg_advisory_xact_lock') < repair.indexOf("from public.unsubscribed_emails ue"));
  assert.ok(repair.lastIndexOf('where od.id = p_dispatch_id') > repair.indexOf('pg_advisory_xact_lock'));
  assert.match(repair, /where od\.id = p_dispatch_id\s+for update/);
  assert.match(repair, /v_dispatch\.status <> 'sent' or v_dispatch\.reconciled_at is null/);
});

test('history repair is one service-role transaction with atomic contact, event, and bookkeeping writes', () => {
  const repair = functionBody('repair_reconciled_sent_dispatch_history_v1');

  assert.match(repair, /security definer/);
  assert.match(repair, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(repair, /insert into public\.contacted_leads/);
  assert.match(repair, /insert into public\.email_events/);
  assert.match(repair, /update public\.outbound_dispatches\s+set history_repair_status = 'complete'/);
  assert.match(repair, /history repair bookkeeping compare-and-set failed/);
  assert.match(sql, /revoke all on function public\.repair_reconciled_sent_dispatch_history_v1\(uuid\) from public/);
  assert.match(sql, /grant execute on function public\.repair_reconciled_sent_dispatch_history_v1\(uuid\) to service_role/);
  assert.match(sql, /alter table public\.contacted_leads\s+add column if not exists thread_id text/);
});

test('both race orderings converge without restoring deleted recipient data', () => {
  const repair = functionBody('repair_reconciled_sent_dispatch_history_v1');
  const deletion = functionBody('delete_research_messaging_subject_v1');

  assert.match(repair, /'reason', 'dispatch_missing'/);
  assert.match(repair, /ue\.user_id is null\s+and ue\.organization_id is null/);
  assert.match(repair, /'reason', 'globally_suppressed'/);
  assert.ok(repair.indexOf("'reason', 'globally_suppressed'") < repair.indexOf('insert into public.contacted_leads'));
  assert.ok(deletion.indexOf('pg_advisory_xact_lock') < deletion.indexOf('delete from public.contacted_leads'));
  assert.match(deletion, /delete from public\.outbound_dispatches/);
  assert.match(deletion, /delete from public\.contacted_leads where lower\(trim\(coalesce\(email, ''\)\)\) = v_email/);
  assert.match(deletion, /set sent_records = coalesce\(c\.sent_records, '\{\}'::jsonb\) - grouped\.recipient_keys/);
  assert.match(deletion, /cl\.organization_id is not distinct from c\.organization_id/);
});

test('deferred deletion is reported honestly by server, API, and UI', () => {
  const runSubjectAction = privacyRequestsPage.slice(privacyRequestsPage.indexOf('async function runSubjectAction'));

  assert.ok(
    privacySubjectData.indexOf("rpc(\n    'delete_native_research_messaging_subject_v1'")
      < privacySubjectData.indexOf('const lookup = await lookupPrivacySubjectData(email);'),
  );
  assert.match(privacySubjectData, /outcome: 'manual_review' as const,\s+blocked: true/);
  assert.match(privacySubjectData, /outcome: 'pending' as const,\s+blocked: true/);
  assert.match(privacySubjectActionsRoute, /result\.outcome === 'manual_review' \|\| result\.outcome === 'pending'/);
  assert.match(privacySubjectActionsRoute, /success: false,\s+outcome: result\.outcome/);
  assert.match(privacySubjectActionsRoute, /\}, \{ status: 409 \}\);/);
  assert.ok(
    runSubjectAction.indexOf("['manual_review', 'pending'].includes(data?.result?.outcome)")
      < runSubjectAction.indexOf('if (!response.ok)'),
  );
  assert.match(privacyRequestsPage, /La eliminacion no se ejecuto y requiere revision manual/);
  assert.match(privacyRequestsPage, /Vuelve a ejecutar la eliminación cuando termine el trabajo en curso/);
});

test('draft SQL contract accepts only canonical delivery options and parseable timestamps', () => {
  assert.match(sql, /content - array\['subject', 'text', 'html', 'deliveryOptions'\] = '\{\}'::jsonb/);
  assert.match(sql, /\(content -> 'deliveryOptions'\) - 'requestReceipts' = '\{\}'::jsonb/);
  assert.match(sql, /jsonb_typeof\(content #> '\{deliveryOptions,requestReceipts\}'\) = 'boolean'/);
  assert.match(sql, /research_messaging_iso_timestamptz_equals_v1\(payload ->> 'createdAt', created_at\)/);
  assert.match(sql, /research_messaging_is_iso_timestamptz_v1\(approval ->> 'decidedAt'\)/);
  assert.match(sql, /linkedinUrl' ~\* '\^https\?:\/\/\[\^\[:space:\]\]\+\$'/);
});

test('quota uses a settled ledger and reserve takes the dispatch lock first', () => {
  const reserve = functionBody('reserve_outbound_contact_quota_v1');
  assert.ok(reserve.indexOf('from public.outbound_dispatches od') < reserve.indexOf('pg_advisory_xact_lock'));
  assert.match(reserve, /for update;/);
  assert.doesNotMatch(reserve, /greatest\(baseline_count, v_input_base\)/);
  assert.match(sql, /reservation_status text not null default 'reserved'/);
  assert.match(sql, /set baseline_count = baseline_count \+ 1,\s+reservation_count = reservation_count - 1/);
  assert.match(sql, /when old\.reservation_status = 'settled' then baseline_count - 1/);
});

test('retention dry run accepts dependency cutoffs and jobs have an email-only index', () => {
  const retention = functionBody('delete_research_messaging_retention_v1');
  assert.match(retention, /p_dispatch_cutoff timestamptz default null/);
  assert.match(retention, /p_draft_cutoff timestamptz default null/);
  assert.match(retention, /p_job_cutoff timestamptz default null/);
  assert.match(retention, /md\.updated_at < p_draft_cutoff/);
  assert.match(retention, /lrj\.completed_at < p_job_cutoff/);
  assert.match(sql, /lead_research_jobs_email_only_idx\s+on public\.lead_research_jobs\(\(lower\(trim\(email\)\)\)\)/);
});

test('native workspace metadata is protected by RLS and tenant-safe updates', () => {
  assert.match(nativeMigration, /alter table public\.messaging_draft_generation_metadata enable row level security/);
  assert.match(nativeMigration, /grant select on table public\.messaging_draft_generation_metadata to authenticated/);
  assert.match(nativeMigration, /create policy "Authenticated members can read draft generation metadata"/);
  assert.match(nativeMigration, /create policy "Authenticated owners can update research runs"[\s\S]*?organization_id in/);
  assert.match(nativeMigration, /create policy "Authenticated owners can update email styles"[\s\S]*?organization_id in/);
  assert.match(nativeMigration, /p_organization_id uuid/);
  assert.match(nativeMigration, /mdv\.organization_id = p_organization_id/);
});

test('native terminal research results retain the snapshot for recovery', () => {
  assert.match(nativeResearch, /resultPayload: \{ \.\.\.output\.result, snapshot: output\.snapshot \}/);
  assert.match(nativeResearch, /const resultPayload = \{[\s\S]*snapshot: input\.output\.snapshot/);
  assert.match(nativeResearch, /requestClaimState === 'terminal_pending'/);
  assert.match(nativeResearch, /\.in\('status', \['queued', 'running', 'completed', 'partial', 'insufficient_data'\]\)/);
  assert.match(nativeResearch, /\.in\('request_claim_state', \['retryable', 'terminal_pending'\]\)/);
  assert.match(nativeResearch, /stalePreProviderQuery[\s\S]*?\.eq\('request_claim_state', 'pre_provider'\)[\s\S]*?\.lt\('request_claimed_at', staleAt\)/);
});

test('native run items accept insufficient data as a terminal status', () => {
  assert.match(nativeMigration, /research_run_items_status_check check \(status in \('queued', 'running', 'completed', 'partial', 'insufficient_data', 'failed', 'cancelled'\)\)/);
});

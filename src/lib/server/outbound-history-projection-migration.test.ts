import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260822130000_finalize_sent_outbound_dispatch_history.sql', 'utf8');

function functionBody(name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = sql.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return sql.slice(start, end);
}

test('sent history finalizer is service-role-only and writes both history projections', () => {
  const finalizer = functionBody('finalize_sent_outbound_dispatch_history_v1');

  assert.match(finalizer, /security definer/);
  assert.match(finalizer, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(finalizer, /from public\.outbound_dispatches od\s+where od\.id = p_dispatch_id\s+for update/);
  assert.match(finalizer, /insert into public\.contacted_leads/);
  assert.match(finalizer, /insert into public\.email_events/);
  assert.match(finalizer, /ee\.meta @> jsonb_build_object\('dispatchId', v_dispatch\.id::text\)/);
  assert.match(finalizer, /update public\.outbound_dispatches\s+set history_repair_status = 'complete'/);
  assert.match(sql, /revoke all on function public\.finalize_sent_outbound_dispatch_history_v1\(uuid\) from public/);
  assert.match(sql, /grant execute on function public\.finalize_sent_outbound_dispatch_history_v1\(uuid\) to service_role/);
  assert.match(sql, /alter function public\.repair_reconciled_sent_dispatch_history_v1\(uuid\)\s+set search_path = public, extensions/);
});

test('sent history finalizer serializes with privacy deletion and finalizes suppression skips', () => {
  const finalizer = functionBody('finalize_sent_outbound_dispatch_history_v1');
  const lock = /pg_advisory_xact_lock\(hashtextextended\(concat\('privacy-delete:', v_email\), 0\)\)/;

  assert.match(finalizer, lock);
  assert.match(finalizer, /ue\.user_id is null\s+and ue\.organization_id is null/);
  assert.match(finalizer, /ue\.user_id = v_dispatch\.user_id\s+or ue\.organization_id = v_dispatch\.organization_id/);
  assert.match(finalizer, /'globally_suppressed'/);
  assert.match(finalizer, /'scoped_suppressed'/);
  assert.ok(finalizer.indexOf("'globally_suppressed'") < finalizer.indexOf('insert into public.contacted_leads'));
});

test('dispatch transition guard allows history completion for direct sent emails', () => {
  const guard = functionBody('enforce_outbound_dispatch_transition');
  const sentHistoryBranch = guard.slice(guard.indexOf("if old.status = 'sent'"));

  assert.match(sentHistoryBranch, /old\.history_repair_status in \('pending', 'failed'\)/);
  assert.doesNotMatch(sentHistoryBranch, /old\.reconciled_at is not null/);
  assert.match(sql, /outbound_dispatches_sent_email_history_projection_idx/);
});

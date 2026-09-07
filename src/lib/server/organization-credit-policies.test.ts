import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260907121351_organization_credit_policies.sql', 'utf8');
const quotaStore = readFileSync('src/lib/server/daily-quota-store.ts', 'utf8');
const functionsSource = readFileSync('functions/index.ts', 'utf8');

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete body`);
  return migration.slice(start, end);
}

test('credit policy data is organization-scoped, versioned, and service-role only', () => {
  assert.match(migration, /create table public\.antonia_credit_policies/);
  assert.match(migration, /create table public\.antonia_credit_team_assignments/);
  assert.match(migration, /create table public\.antonia_daily_credit_buckets/);
  assert.match(migration, /effective_from date not null/);
  assert.match(migration, /cancelled_at timestamptz/);
  assert.match(migration, /alter table public\.antonia_credit_policies enable row level security/);
  assert.match(migration, /revoke all on table public\.antonia_daily_credit_buckets from public, anon, authenticated/);
});

test('hybrid consumption locks and validates both buckets before incrementing either', () => {
  const body = functionBody('consume_antonia_organization_credits_v2');
  const userLock = body.indexOf("bucket.bucket_type = 'user'");
  const teamLock = body.indexOf("bucket.bucket_type = 'team'");
  const firstUpdate = body.indexOf('update public.antonia_daily_credit_buckets bucket');
  assert.ok(userLock >= 0 && teamLock > userLock && firstUpdate > teamLock);
  assert.match(body, /v_mode in \('user', 'hybrid'\)/);
  assert.match(body, /v_mode in \('team', 'hybrid'\)/);
  assert.match(body, /v_allowed := v_allowed[\s\S]*v_team_bucket\.usage_count/);
});

test('refunds use the mode and team captured by the original operation', () => {
  const release = functionBody('release_antonia_quota_operation_v1');
  const settlement = functionBody('settle_apollo_enrichment_quota_if_ready_v1');
  const researchRelease = functionBody('release_lead_research_request_claim_v1');
  for (const body of [release, settlement, researchRelease]) {
    assert.match(body, /release_antonia_organization_credits_v2/);
    assert.match(body, /credit_mode/);
    assert.match(body, /credit_group_id/);
  }
});

test('all deployed consumption entry points route through the organization boundary', () => {
  for (const name of [
    'consume_antonia_daily_quota_v1',
    'claim_antonia_quota_operation_v1',
    'consume_suplia_research_tool_credit_v1',
    'consume_lead_research_request_quota_v1',
  ]) {
    assert.match(functionBody(name), /consume_antonia_organization_credits_v2/);
  }
  assert.match(quotaStore, /'get_antonia_credit_status_v2'/);
  assert.match(functionsSource, /rpc\('get_antonia_credit_status_v2'/);
});

test('status preserves policy limits before the daily bucket exists', () => {
  const status = functionBody('get_antonia_credit_status_v2');
  assert.match(status, /into v_user_count, v_bucket_limit[\s\S]*if found then v_user_limit := v_bucket_limit/);
  assert.match(status, /into v_team_count, v_bucket_limit[\s\S]*if found then v_team_limit := v_bucket_limit/);
});

test('policy and team changes activate at the next UTC reset', () => {
  assert.match(functionBody('schedule_antonia_credit_policy_v1'), /timezone\('utc', now\(\)\)::date \+ 1/);
  assert.match(functionBody('schedule_antonia_credit_team_assignment_v1'), /timezone\('utc', now\(\)\)::date \+ 1/);
  assert.match(migration, /Start organization-aware accounting at the next reset/);
});

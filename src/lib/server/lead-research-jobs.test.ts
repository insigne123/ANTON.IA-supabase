import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { claimLeadResearchRequest } from './lead-research-jobs';

const migrationPath = 'supabase/migrations/20260813103000_atomic_lead_research_request_claim.sql';
const sql = readFileSync(migrationPath, 'utf8');

function claimRow(scopeKey: string, userId: string, key: string, id: string, claimToken: string) {
  return {
    id,
    scope_key: scopeKey,
    organization_id: scopeKey,
    user_id: userId,
    provider_report_id: null,
    request_idempotency_key: key,
    request_claim_state: 'pre_provider',
    request_payload: { lead_ref: 'lead-1' },
    result_payload: null,
    research_snapshot_id: null,
    lead_ref: 'lead-1',
    status: 'queued',
    error_code: null,
    error_message: null,
    request_claim_token: claimToken,
  };
}

function atomicClaimAdmin() {
  const jobs = new Map<string, Record<string, any>>();
  let sequence = 0;
  return {
    jobs,
    async rpc(name: string, args: Record<string, any>) {
      assert.equal(name, 'claim_lead_research_request_v1');
      const ownerKey = `${args.p_scope_key}:${args.p_user_id}:${args.p_request_idempotency_key}`;
      const existing = jobs.get(ownerKey);
      if (existing) {
        return {
          data: { created: false, claimed: false, recovered: false, claim_token: null, job: structuredClone(existing) },
          error: null,
        };
      }

      const claimToken = `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
      const job = claimRow(args.p_scope_key, args.p_user_id, args.p_request_idempotency_key, `job-${sequence}`, claimToken);
      jobs.set(ownerKey, job);
      return {
        data: { created: true, claimed: true, recovered: false, claim_token: claimToken, job: structuredClone(job) },
        error: null,
      };
    },
  };
}

function claimInput(key: string, scopeKey = '30000000-0000-4000-8000-000000000001', userId = '40000000-0000-4000-8000-000000000001') {
  return {
    scopeKey,
    organizationId: scopeKey,
    userId,
    requestIdempotencyKey: key,
    requestPayload: { lead_ref: 'lead-1' },
    leadRef: 'lead-1',
  };
}

test('concurrent same-key requests have one claim winner before quota and provider work', async () => {
  const admin = atomicClaimAdmin();
  const events: string[] = [];
  let quotaCalls = 0;
  let providerCalls = 0;
  const request = async () => {
    events.push('claim');
    const claim = await claimLeadResearchRequest(claimInput('research:v1:same-key'), admin);
    if (!claim.claimed) return claim;
    events.push('quota');
    quotaCalls += 1;
    events.push('provider');
    providerCalls += 1;
    return claim;
  };

  const claims = await Promise.all([request(), request()]);

  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  assert.equal(claims.filter((claim) => !claim.claimed).length, 1);
  assert.equal(quotaCalls, 1);
  assert.equal(providerCalls, 1);
  assert.ok(events.indexOf('claim') < events.indexOf('quota'));
  assert.ok(events.indexOf('quota') < events.indexOf('provider'));
});

test('the same request key is isolated by owner scope and user', async () => {
  const admin = atomicClaimAdmin();
  const claims = await Promise.all([
    claimLeadResearchRequest(claimInput('shared-key', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001'), admin),
    claimLeadResearchRequest(claimInput('shared-key', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002'), admin),
  ]);

  assert.equal(claims.every((claim) => claim.claimed), true);
  assert.equal(admin.jobs.size, 2);
});

test('migration owns request identity durably and protects ambiguous submissions', () => {
  assert.match(sql, /alter column provider_report_id drop not null/);
  assert.match(sql, /add column if not exists request_idempotency_key text/);
  assert.match(sql, /unique index if not exists lead_research_jobs_request_identity_uidx\s+on public\.lead_research_jobs\(scope_key, user_id, request_idempotency_key\)/);
  assert.match(sql, /on conflict \(scope_key, user_id, request_idempotency_key\)[\s\S]+do nothing/);
  assert.match(sql, /v_job\.request_claim_state = 'pre_provider'[\s\S]+request_claimed_at < now\(\) - make_interval/);
  assert.match(sql, /v_job\.request_claim_state = 'provider_submitting'[\s\S]+request_claim_state = 'provider_unknown'/);
  assert.match(sql, /v_job\.request_claim_state = 'terminal_pending'[\s\S]+v_claim_token := v_job\.request_claim_token/);
  assert.match(sql, /store_lead_research_request_terminal_v1[\s\S]+request_claim_state = 'terminal_pending'[\s\S]+result_payload = p_result_payload/);
  assert.match(sql, /finalize_lead_research_request_terminal_v1[\s\S]+request_claim_state = 'terminal_pending'[\s\S]+research_snapshot_id is not null/);
  assert.match(sql, /quota_consumed_at is not null[\s\S]+reused', true/);
  assert.match(sql, /create policy "Users can insert scoped lead research jobs"[\s\S]+request_idempotency_key is null/);
  assert.match(sql, /grant execute on function public\.claim_lead_research_request_v1[^\n]+to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.claim_lead_research_request_v1[^\n]+to authenticated/);
});

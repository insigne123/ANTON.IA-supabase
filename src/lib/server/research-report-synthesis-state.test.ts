import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { retryResearchReportSynthesis } from '@/lib/server/research-report-synthesis-state';

const migration = readFileSync('supabase/migrations/20260908173355_report_v2_foundation.sql', 'utf8');
const source = readFileSync('src/lib/server/research-report-synthesis-state.ts', 'utf8');

test('durable synthesis lifecycle supports enqueue, partial retries, stale leases, and document binding', () => {
  assert.match(migration, /enqueue_research_report_synthesis_v1/);
  assert.match(migration, /status in \('queued', 'retry_scheduled', 'partial'\)/);
  assert.match(migration, /status = 'running'[\s\S]+claimed_at < p_now - interval '15 minutes'/);
  assert.match(migration, /attempt_count = synthesis\.attempt_count \+ 1/);
  assert.match(migration, /synthesis\.attempt_count between 1 and 3/);
  assert.match(migration, /p_retryable boolean default false/);
  assert.match(migration, /document\.schema_version = synthesis\.schema_version/);
  assert.match(migration, /persist_research_report_synthesis_result_v1/);
  assert.match(migration, /where synthesis\.id = p_state_id[\s\S]+synthesis\.claim_token = p_claim_token[\s\S]+for update/);
  assert.match(migration, /research_report_documents_provenance_key/);
  assert.match(migration, /report_schema_version is not null/);
  assert.match(migration, /reject_research_report_synthesis_candidate_v1/);
  assert.match(migration, /insert into public\.research_report_synthesis_states/);
  assert.match(migration, /report\.generation_method = 'model'/);
  assert.match(migration, /not p_retryable or synthesis\.attempt_count >= 4/);
  assert.match(migration, /claim_token = case[\s\S]+then null/);
  assert.match(migration, /where synthesis\.status <> 'running'[\s\S]+claimed_at < p_now - interval '15 minutes'/);
  assert.match(migration, /validate_research_report_synthesis_document_scope_v1/);
});

test('manual retry is tenant- and schema-scoped instead of referencing a nonexistent job column', async () => {
  const filters: Array<[string, unknown]> = [];
  const row = {
    id: 'state-id',
    research_snapshot_id: 'snapshot-id',
    organization_id: 'organization-id',
    user_id: 'user-id',
    schema_version: 'research-report-document/v2',
    status: 'queued',
    prompt_version: 'prompt/v1',
    seller_profile_hash: 'a'.repeat(64),
    attempt_count: 0,
    retryable: true,
    error_code: null,
    error_message: null,
    claim_token: null,
    claimed_at: null,
    next_retry_at: '2026-09-08T00:00:00.000Z',
    report_document_id: null,
    completed_at: null,
    created_at: '2026-09-08T00:00:00.000Z',
    updated_at: '2026-09-08T00:00:00.000Z',
  };
  const builder: any = {
    update() { return builder; },
    eq(field: string, value: unknown) { filters.push([field, value]); return builder; },
    in(field: string, value: unknown) { filters.push([field, value]); return builder; },
    select() { return builder; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  const admin = { from: () => builder };
  const state = await retryResearchReportSynthesis({
    researchSnapshotId: 'snapshot-id',
    schemaVersion: 'research-report-document/v2',
    access: { organizationId: 'organization-id', userId: 'user-id' },
  }, admin);

  assert.equal(state.schemaVersion, 'research-report-document/v2');
  assert.ok(filters.some(([field]) => field === 'organization_id'));
  assert.ok(filters.some(([field]) => field === 'user_id'));
  assert.ok(filters.some(([field]) => field === 'schema_version'));
  assert.doesNotMatch(source, /\.eq\('job_id'/);
});

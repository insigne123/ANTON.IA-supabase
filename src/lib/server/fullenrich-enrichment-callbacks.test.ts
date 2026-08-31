import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FULLENRICH_CALLBACK_CUSTOM_KEY,
  processFullEnrichRetrievedResult,
  parseFullEnrichWebhookPayload,
  processFullEnrichWebhookDelivery,
  verifyFullEnrichWebhookSignature,
} from './fullenrich-enrichment-callbacks';

const API_KEY = 'fullenrich-test-api-key';
const CALLBACK_ID = '11111111-1111-4111-8111-111111111111';

function signedBody(payload: unknown) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    signature: createHmac('sha1', API_KEY).update(rawBody).digest('hex'),
  };
}

function callbackPayload() {
  return {
    id: 'f1c2d3e4-1111-4222-8333-444444444444',
    status: 'IN_PROGRESS',
    data: [{
      input: {
        target_id: 'untrusted-target-id',
        target_table: 'enriched_opportunities',
      },
      custom: {
        [FULLENRICH_CALLBACK_CUSTOM_KEY]: CALLBACK_ID,
        target_id: 'also-untrusted',
      },
      contact_info: {
        most_probable_work_email: { email: 'person@example.test', status: 'DELIVERABLE' },
        most_probable_phone: { number: '+1 (555) 010-0100', region: 'US' },
      },
    }],
  };
}

test('FullEnrich signatures are checked against the original raw body', () => {
  const { rawBody, signature } = signedBody(callbackPayload());

  assert.equal(verifyFullEnrichWebhookSignature(rawBody, signature, API_KEY), true);
  assert.equal(verifyFullEnrichWebhookSignature(Buffer.from(`${rawBody.toString('utf8')}\n`), signature, API_KEY), false);
  assert.equal(verifyFullEnrichWebhookSignature(rawBody, '0'.repeat(40), API_KEY), false);
  assert.equal(verifyFullEnrichWebhookSignature(rawBody, 'not-a-signature', API_KEY), false);
});

test('FullEnrich parsing only accepts the opaque custom callback ID', () => {
  const parsed = parseFullEnrichWebhookPayload(callbackPayload());

  assert.ok(parsed);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].callbackId, CALLBACK_ID);
  assert.deepEqual(parsed.entries[0].candidate, {
    work_email: { email: 'person@example.test', status: 'DELIVERABLE' },
    phone_numbers: [{
      raw_number: '+15550100100',
      sanitized_number: '+15550100100',
      type: 'mobile',
      position: 'current',
      status: 'verified',
      region: 'US',
    }],
    primary_phone: '+15550100100',
  });

  assert.equal(parseFullEnrichWebhookPayload({ id: 'batch', status: 'FINISHED', data: {} }), null);
  assert.deepEqual(
    parseFullEnrichWebhookPayload({
      id: 'batch',
      status: 'FINISHED',
      data: [{ custom: { [FULLENRICH_CALLBACK_CUSTOM_KEY]: 'not-a-uuid' } }],
    })?.entries,
    [],
  );
});

test('FullEnrich webhook processing delegates only an opaque callback and normalized candidate to the RPC', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: { outcome: calls.length === 1 ? 'processed' : 'duplicate' },
        error: null,
      };
    },
  };
  const { rawBody, signature } = signedBody(callbackPayload());

  const first = await processFullEnrichWebhookDelivery({
    rawBody,
    signatureHeader: signature,
    apiKey: API_KEY,
  }, client);
  const retry = await processFullEnrichWebhookDelivery({
    rawBody,
    signatureHeader: signature,
    apiKey: API_KEY,
  }, client);

  assert.deepEqual(first, { kind: 'processed', received: 1, processed: 1, duplicates: 0, ignored: 0 });
  assert.deepEqual(retry, { kind: 'processed', received: 1, processed: 0, duplicates: 1, ignored: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'apply_fullenrich_enrichment_callback_v1');
  assert.deepEqual(Object.keys(calls[0].args).sort(), [
    'p_callback_id',
    'p_candidate',
    'p_payload_fingerprint',
    'p_provider_enrichment_id',
    'p_provider_status',
  ]);
  assert.equal(calls[0].args.p_callback_id, CALLBACK_ID);
  assert.equal('target_id' in calls[0].args, false);
  assert.equal('target_table' in calls[0].args, false);
});

test('FullEnrich retrieval only applies a terminal batch that matches the requested provider ID', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { outcome: 'processed' }, error: null };
    },
  };
  const payload = { ...callbackPayload(), status: 'FINISHED' };
  const rawBody = Buffer.from(JSON.stringify(payload));

  const processed = await processFullEnrichRetrievedResult({
    rawBody,
    apiKey: API_KEY,
    expectedProviderEnrichmentId: payload.id,
  }, client);
  assert.deepEqual(processed, {
    kind: 'processed',
    providerStatus: 'FINISHED',
    callbackIds: [CALLBACK_ID],
    received: 1,
    processed: 1,
    duplicates: 0,
    ignored: 0,
  });
  assert.equal(calls.length, 1);

  const mismatch = await processFullEnrichRetrievedResult({
    rawBody,
    apiKey: API_KEY,
    expectedProviderEnrichmentId: 'different-batch',
  }, client);
  assert.deepEqual(mismatch, { kind: 'invalid_payload' });
  assert.equal(calls.length, 1);

  const pending = await processFullEnrichRetrievedResult({
    rawBody: Buffer.from(JSON.stringify(callbackPayload())),
    apiKey: API_KEY,
    expectedProviderEnrichmentId: payload.id,
  }, client);
  assert.deepEqual(pending, { kind: 'in_progress' });
  assert.equal(calls.length, 1);
});

test('FullEnrich migration keeps callback data service-role-only and finalizes under a row lock', () => {
  const migration = readFileSync('supabase/migrations/20260827110000_fullenrich_enrichment_callbacks.sql', 'utf8');

  assert.match(migration, /create table if not exists public\.fullenrich_enrichment_callbacks/);
  assert.match(migration, /callback_id uuid primary key default gen_random_uuid\(\)/);
  assert.match(migration, /provider_enrichment_id text/);
  assert.match(migration, /quota_resource text not null default 'enrich'/);
  assert.match(migration, /requested_fields text\[\] not null/);
  assert.doesNotMatch(migration, /contact\.personal_emails/);
  assert.match(migration, /terminal_state text check/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.fullenrich_enrichment_callbacks from public, anon, authenticated/);
  assert.match(migration, /for all\s+to service_role\s+using \(true\)\s+with check \(true\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /where callback\.callback_id = p_callback_id\s+for update/);
  assert.match(migration, /fullenrich_enrichment_callbacks_operation_target_key/);
  assert.match(migration, /fullenrich_enrichment_callbacks_active_target_key/);
  assert.match(migration, /complete_antonia_quota_operation_v1/);
  assert.match(migration, /if v_callback\.terminal_state is not null then[\s\S]*?'outcome', 'duplicate'/);
  assert.match(migration, /target\.user_id = v_callback\.user_id[\s\S]*?target\.organization_id = v_callback\.organization_id/);
  assert.match(migration, /target\.organization_id = v_callback\.organization_id::text/);
});

test('FullEnrich reconciliation migration claims stale callbacks atomically and releases exact claims', () => {
  const migration = readFileSync('supabase/migrations/20260830120000_fullenrich_callback_reconciliation.sql', 'utf8');
  const reliabilityMigration = readFileSync('supabase/migrations/20260830130000_fullenrich_reconciliation_reliability.sql', 'utf8');

  assert.match(migration, /reconciliation_attempt_count integer not null default 0/);
  assert.match(migration, /last_reconciliation_at timestamptz/);
  assert.match(migration, /reconciliation_claimed_at timestamptz/);
  assert.match(migration, /reconciliation_last_error_code text/);
  assert.match(migration, /create or replace function public\.claim_fullenrich_enrichment_reconciliation_candidates_v1/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /callback\.status in \('pending', 'processing'\)/);
  assert.match(migration, /callback\.provider_enrichment_id is not null/);
  assert.match(migration, /order by callback\.last_reconciliation_at asc nulls first, callback\.created_at asc/);
  assert.match(migration, /create or replace function public\.release_fullenrich_enrichment_reconciliation_candidates_v1/);
  assert.match(migration, /callback\.reconciliation_claimed_at = p_claimed_at/);
  assert.match(migration, /to service_role/);
  assert.match(reliabilityMigration, /claim_fullenrich_enrichment_reconciliation_candidates_v2/);
  assert.match(reliabilityMigration, /reconciliation_attempt_count integer/);
  assert.match(reliabilityMigration, /release_fullenrich_enrichment_reconciliation_candidates_v2/);
  assert.doesNotMatch(reliabilityMigration, /and callback\.status in \('pending', 'processing'\)/);
});

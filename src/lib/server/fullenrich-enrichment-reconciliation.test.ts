import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileFullEnrichEnrichmentCallbacks } from './fullenrich-enrichment-reconciliation';

const FIRST_CALLBACK_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CALLBACK_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ENRICHMENT_ID = 'enrichment-123';
const CLAIMED_AT = '2026-08-30T12:00:00.000Z';

function clientFor(candidates: unknown[]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === 'claim_fullenrich_enrichment_reconciliation_candidates_v2') {
          return { data: candidates, error: null };
        }
        if (name === 'apply_fullenrich_enrichment_callback_v1') {
          return { data: { outcome: 'processed' }, error: null };
        }
        if (name === 'release_fullenrich_enrichment_reconciliation_candidates_v2') {
          return { data: 1, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
    },
  };
}

test('FullEnrich reconciliation claims once, verifies the provider batch ID, and releases its claim', async () => {
  const { client, calls } = clientFor([{
    callback_id: FIRST_CALLBACK_ID,
    provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
    reconciliation_claimed_at: CLAIMED_AT,
    reconciliation_attempt_count: 1,
  }]);
  const fetches: Array<{ apiKey: string; enrichmentId: string }> = [];
  const processed: Array<{ expectedProviderEnrichmentId: string }> = [];

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    now: new Date('2026-08-30T12:05:00.000Z'),
    fetchResult: async (input) => {
      fetches.push(input);
      return { kind: 'ready', rawBody: Buffer.from('{}') };
    },
    processResult: async (input) => {
      processed.push({ expectedProviderEnrichmentId: input.expectedProviderEnrichmentId });
      return {
        kind: 'processed',
        providerStatus: 'FINISHED',
        callbackIds: [FIRST_CALLBACK_ID],
        received: 1,
        processed: 1,
        duplicates: 0,
        ignored: 0,
      };
    },
  });

  assert.deepEqual(summary, {
    claimed: 1,
    batches: 1,
    processed: 1,
    duplicates: 0,
    inProgress: 0,
    notFound: 0,
    errors: 0,
  });
  assert.deepEqual(fetches, [{ apiKey: 'test-key', enrichmentId: PROVIDER_ENRICHMENT_ID }]);
  assert.deepEqual(processed, [{ expectedProviderEnrichmentId: PROVIDER_ENRICHMENT_ID }]);
  assert.equal(calls[0].name, 'claim_fullenrich_enrichment_reconciliation_candidates_v2');
  assert.equal(calls.at(-1)?.name, 'release_fullenrich_enrichment_reconciliation_candidates_v2');
  assert.equal(calls.at(-1)?.args.p_error_code, null);
});

test('FullEnrich reconciliation keeps in-progress batches pending and releases the cooldown claim', async () => {
  const { client, calls } = clientFor([{
    callback_id: FIRST_CALLBACK_ID,
    provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
    reconciliation_claimed_at: CLAIMED_AT,
    reconciliation_attempt_count: 1,
  }]);

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    fetchResult: async () => ({ kind: 'in_progress' }),
  });

  assert.equal(summary.inProgress, 1);
  assert.equal(summary.processed, 0);
  assert.equal(summary.errors, 0);
  assert.equal(calls.at(-1)?.name, 'release_fullenrich_enrichment_reconciliation_candidates_v2');
  assert.equal(calls.at(-1)?.args.p_error_code, null);
});

test('FullEnrich reconciliation leaves unmatched terminal entries pending for a later safe retry', async () => {
  const { client, calls } = clientFor([
    {
      callback_id: FIRST_CALLBACK_ID,
      provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
      reconciliation_claimed_at: CLAIMED_AT,
      reconciliation_attempt_count: 1,
    },
    {
      callback_id: SECOND_CALLBACK_ID,
      provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
      reconciliation_claimed_at: CLAIMED_AT,
      reconciliation_attempt_count: 1,
    },
  ]);

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    fetchResult: async () => ({ kind: 'ready', rawBody: Buffer.from('{}') }),
    processResult: async () => ({
      kind: 'processed',
      providerStatus: 'FINISHED',
      callbackIds: [FIRST_CALLBACK_ID],
      received: 1,
      processed: 1,
      duplicates: 0,
      ignored: 0,
    }),
  });

  assert.equal(summary.processed, 1);
  assert.equal(calls.some((call) => call.name === 'apply_fullenrich_enrichment_callback_v1'), false);
  const release = calls.at(-1);
  assert.equal(release?.name, 'release_fullenrich_enrichment_reconciliation_candidates_v2');
  assert.equal(release?.args.p_error_code, 'FULLENRICH_RESULT_UNAPPLIED');
});

test('FullEnrich reconciliation finalizes a credit-exhausted batch with persisted callback IDs', async () => {
  const { client, calls } = clientFor([{
    callback_id: FIRST_CALLBACK_ID,
    provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
    reconciliation_claimed_at: CLAIMED_AT,
    reconciliation_attempt_count: 1,
  }]);
  let receivedPayload: any;

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    fetchResult: async () => ({ kind: 'terminal_failure', providerStatus: 'CREDITS_INSUFFICIENT' }),
    processResult: async (input) => {
      receivedPayload = JSON.parse(input.rawBody.toString('utf8'));
      return {
        kind: 'processed',
        providerStatus: 'CREDITS_INSUFFICIENT',
        callbackIds: [FIRST_CALLBACK_ID],
        received: 1,
        processed: 1,
        duplicates: 0,
        ignored: 0,
      };
    },
  });

  assert.equal(summary.processed, 1);
  assert.equal(summary.errors, 0);
  assert.deepEqual(receivedPayload, {
    id: PROVIDER_ENRICHMENT_ID,
    status: 'CREDITS_INSUFFICIENT',
    data: [{ custom: { fullenrich_callback_id: FIRST_CALLBACK_ID } }],
  });
  assert.equal(calls.at(-1)?.name, 'release_fullenrich_enrichment_reconciliation_candidates_v2');
  assert.equal(calls.at(-1)?.args.p_error_code, 'FULLENRICH_RESULT_CREDITS_INSUFFICIENT');
});

test('FullEnrich reconciliation terminalizes an exhausted provider lookup failure', async () => {
  const { client, calls } = clientFor([{
    callback_id: FIRST_CALLBACK_ID,
    provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
    reconciliation_claimed_at: CLAIMED_AT,
    reconciliation_attempt_count: 6,
  }]);
  let receivedPayload: any;

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    fetchResult: async () => ({ kind: 'not_found' }),
    processResult: async (input) => {
      receivedPayload = JSON.parse(input.rawBody.toString('utf8'));
      return {
        kind: 'processed',
        providerStatus: 'UNKNOWN',
        callbackIds: [FIRST_CALLBACK_ID],
        received: 1,
        processed: 1,
        duplicates: 0,
        ignored: 0,
      };
    },
  });

  assert.equal(summary.notFound, 1);
  assert.equal(summary.processed, 1);
  assert.deepEqual(receivedPayload, {
    id: PROVIDER_ENRICHMENT_ID,
    status: 'UNKNOWN',
    data: [{ custom: { fullenrich_callback_id: FIRST_CALLBACK_ID } }],
  });
  assert.equal(calls.at(-1)?.args.p_error_code, 'FULLENRICH_RESULT_NOT_FOUND');
});

test('FullEnrich reconciliation keeps a provider error retryable before the attempt limit', async () => {
  const { client, calls } = clientFor([{
    callback_id: FIRST_CALLBACK_ID,
    provider_enrichment_id: PROVIDER_ENRICHMENT_ID,
    reconciliation_claimed_at: CLAIMED_AT,
    reconciliation_attempt_count: 5,
  }]);
  let processed = false;

  const summary = await reconcileFullEnrichEnrichmentCallbacks({
    apiKey: 'test-key',
    client,
    fetchResult: async () => ({ kind: 'retryable_error', errorCode: 'FULLENRICH_RESULT_UPSTREAM_ERROR' }),
    processResult: async () => {
      processed = true;
      throw new Error('unexpected terminal processing');
    },
  });

  assert.equal(summary.errors, 1);
  assert.equal(processed, false);
  assert.equal(calls.at(-1)?.args.p_error_code, 'FULLENRICH_RESULT_UPSTREAM_ERROR');
});

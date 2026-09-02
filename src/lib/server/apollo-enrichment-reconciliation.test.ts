import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileApolloEnrichmentCallbacks } from './apollo-enrichment-reconciliation';

function clientWithClaim(row: Record<string, unknown>) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc: async (name: string, params: Record<string, unknown>) => {
        calls.push({ name, params });
        if (name === 'claim_apollo_enrichment_reconciliation_candidates_v1') {
          return { data: [row], error: null };
        }
        return { data: name.startsWith('apply_') ? { outcome: 'processed' } : { outcome: 'settled' }, error: null };
      },
    },
  };
}

const baseRow = {
  callback_id: 'a0000000-0000-4000-8000-000000000001',
  token_hash: 'a'.repeat(64),
  provider_request_id: '-9223372036854775807',
  apollo_person_id: 'apollo-person-1',
  expires_at: '2026-09-02T00:00:00.000Z',
  reconciliation_claimed_at: '2026-09-01T12:00:00.000Z',
  reconciliation_attempt_count: 1,
};

test('Apollo reconciliation respects provider retry_after_seconds', async () => {
  const { calls, client } = clientWithClaim(baseRow);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    provider_request_id: '-9223372036854775807',
    status: 'result_pending',
    retry_after_seconds: 42,
    candidate: null,
  });

  try {
    const result = await reconcileApolloEnrichmentCallbacks({
      now: new Date('2026-09-01T12:01:00.000Z'),
      client,
      environment: {
        BACKEND_HOSTED_APP_URL: 'https://gateway.example.test',
        ENRICHMENT_SERVICE_SECRET: 'internal-secret',
      },
    });
    assert.equal(result.pending, 1);
    const release = calls.find((call) => call.name === 'release_apollo_enrichment_reconciliation_candidates_v1');
    assert.equal(release?.params.p_retry_after_seconds, 42);
    assert.equal(release?.params.p_error_code, 'apollo_result_pending');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Apollo reconciliation expires callbacks even when no request ID was returned', async () => {
  const { calls, client } = clientWithClaim({
    ...baseRow,
    provider_request_id: null,
    expires_at: '2026-09-01T11:59:00.000Z',
  });

  const result = await reconcileApolloEnrichmentCallbacks({
    now: new Date('2026-09-01T12:01:00.000Z'),
    client,
  });
  assert.equal(result.expired, 1);
  const settlement = calls.find((call) => call.name === 'settle_apollo_enrichment_callback_v1');
  assert.equal(settlement?.params.p_terminal_state, 'expired');
  assert.equal(settlement?.params.p_error_code, 'apollo_callback_expired');
});

test('Apollo reconciliation sends ready candidates through the atomic callback RPC', async () => {
  const { calls, client } = clientWithClaim(baseRow);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    provider_request_id: '-9223372036854775807',
    status: 'completed',
    candidate: {
      apollo_person_id: 'apollo-person-1',
      primary_phone: '+15550100001',
      phone_numbers: [{
        raw_number: '+15550100001',
        sanitized_number: '+15550100001',
        type: 'mobile',
        position: 'current',
        status: 'verified',
      }],
    },
  });

  try {
    const result = await reconcileApolloEnrichmentCallbacks({
      now: new Date('2026-09-01T12:01:00.000Z'),
      client,
      environment: {
        BACKEND_HOSTED_APP_URL: 'https://gateway.example.test',
        ENRICHMENT_SERVICE_SECRET: 'internal-secret',
      },
    });
    assert.equal(result.processed, 1);
    const apply = calls.find((call) => call.name === 'apply_apollo_enrichment_callback_v1');
    assert.equal(apply?.params.p_provider_request_id, '-9223372036854775807');
    assert.match(String(apply?.params.p_payload_hash), /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

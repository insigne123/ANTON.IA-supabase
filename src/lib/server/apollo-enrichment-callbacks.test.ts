import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createApolloEnrichmentCallback,
  hashApolloCallbackToken,
  parseApolloWebhookPayload,
  processApolloWebhookDelivery,
  resolveApolloWebhookUrl,
} from './apollo-enrichment-callbacks';

test('Apollo callback tokens are opaque and URLs expose no target identity', async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return {
        data: { outcome: 'created', callbackId: 'a0000000-0000-4000-8000-000000000001' },
        error: null,
      };
    },
  };

  const result = await createApolloEnrichmentCallback({
    operationId: 'operation-1',
    claimToken: 'a4000000-0000-4000-8000-000000000001',
    userId: 'a1000000-0000-4000-8000-000000000001',
    organizationId: 'a2000000-0000-4000-8000-000000000001',
    quotaResource: 'investigate',
    targetTable: 'enriched_opportunities',
    targetId: 'a3000000-0000-4000-8000-000000000001',
    apolloPersonId: 'apollo-person-1',
    requestedFields: ['person.email', 'person.phone_numbers'],
    environment: { CANONICAL_APP_URL: 'https://studio.example.test' },
  }, client);

  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.tokenHash, hashApolloCallbackToken(result.token));
  assert.equal(result.webhookUrl, `https://studio.example.test/api/apollo-webhook/${result.token}`);
  assert.equal(result.webhookUrl.includes('enriched_opportunities'), false);
  assert.equal(result.webhookUrl.includes('a3000000-0000-4000-8000-000000000001'), false);
  assert.equal(calls[0]?.params.p_token_hash, result.tokenHash);
  assert.equal(Object.values(calls[0]?.params || {}).includes(result.token), false);
  assert.equal(calls[0]?.params.p_quota_resource, 'investigate');
  assert.equal(calls[0]?.params.p_claim_token, 'a4000000-0000-4000-8000-000000000001');
});

test('an unsubmitted callback replay rotates its opaque token under the current claim', async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === 'create_apollo_enrichment_callback_v1') {
        return {
          data: { outcome: 'replay', callbackId: 'a0000000-0000-4000-8000-000000000001' },
          error: null,
        };
      }
      return {
        data: { outcome: 'replaced', callbackId: 'a0000000-0000-4000-8000-000000000001' },
        error: null,
      };
    },
  };

  const result = await createApolloEnrichmentCallback({
    operationId: 'operation-1',
    claimToken: 'a4000000-0000-4000-8000-000000000001',
    userId: 'a1000000-0000-4000-8000-000000000001',
    organizationId: 'a2000000-0000-4000-8000-000000000001',
    quotaResource: 'investigate',
    targetTable: 'enriched_opportunities',
    targetId: 'a3000000-0000-4000-8000-000000000001',
    requestedFields: ['person.phone_numbers'],
    environment: { CANONICAL_APP_URL: 'https://studio.example.test' },
  }, client);

  assert.equal(calls[1]?.name, 'replace_unsubmitted_apollo_callback_v1');
  assert.equal(calls[1]?.params.p_claim_token, 'a4000000-0000-4000-8000-000000000001');
  assert.equal(calls[1]?.params.p_token_hash, result.tokenHash);
  assert.equal(Object.values(calls[1]?.params || {}).includes(result.token), false);
});

test('callback creation rejects a target already suppressed by privacy controls', async () => {
  const client = {
    rpc: async () => ({ data: { outcome: 'target_suppressed' }, error: null }),
  };

  await assert.rejects(createApolloEnrichmentCallback({
    operationId: 'operation-1',
    claimToken: 'a4000000-0000-4000-8000-000000000001',
    userId: 'a1000000-0000-4000-8000-000000000001',
    organizationId: 'a2000000-0000-4000-8000-000000000001',
    quotaResource: 'investigate',
    targetTable: 'people_search_leads',
    targetId: 'a3000000-0000-4000-8000-000000000001',
    requestedFields: ['person.phone_numbers'],
    environment: { CANONICAL_APP_URL: 'https://studio.example.test' },
  }, client), /ENRICHMENT_TARGET_SUPPRESSED/);
});

test('Apollo webhook parser preserves signed request IDs and bounds contact fields', () => {
  const parsed = parseApolloWebhookPayload({
    request_id: '-9223372036854775807',
    status: 'completed',
    person: {
      id: 'apollo-person-1',
      email: 'ana@example.test',
      email_status: 'verified',
      phone_numbers: [{ sanitized_number: '+1 (555) 010-0001', type: 'mobile' }],
    },
  });

  assert.equal(parsed?.providerRequestId, '-9223372036854775807');
  assert.equal(parsed?.providerStatus, 'COMPLETED');
  assert.equal(parsed?.candidate.apollo_person_id, 'apollo-person-1');
  assert.equal(parsed?.candidate.email, 'ana@example.test');
  assert.equal(parsed?.candidate.primary_phone, '+15550100001');
  assert.equal(parsed?.candidate.phone_numbers?.length, 1);
});

test('Apollo webhook processing hashes the raw payload before the atomic RPC', async () => {
  const token = 'a'.repeat(43);
  const rawBody = Buffer.from(
    '{"request_id":7729515760484695000,"status":"success","person":{"id":"apollo-person-1","phone_number":"+15550100001"}}',
  );
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return { data: { outcome: 'processed' }, error: null };
    },
  };

  const result = await processApolloWebhookDelivery({ token, rawBody }, client);
  assert.deepEqual(result, { kind: 'processed', outcome: 'processed' });
  assert.equal(calls[0]?.name, 'apply_apollo_enrichment_callback_v1');
  assert.equal(calls[0]?.params.p_token_hash, hashApolloCallbackToken(token));
  assert.equal(calls[0]?.params.p_provider_request_id, '7729515760484695000');
  assert.match(String(calls[0]?.params.p_payload_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls[0]?.params).includes(token), false);
});

test('native Apollo phone webhooks resolve the request ID from the callback row', async () => {
  const token = 'c'.repeat(43);
  const providerRequestId = '7729515760484695000';
  const rawBody = Buffer.from(JSON.stringify({
    status: 'success',
    total_requested_enrichments: 1,
    people: [{
      id: 'apollo-person-1',
      status: 'success',
      phone_numbers: [{
        raw_number: '+1 555 010 0001',
        sanitized_number: '+15550100001',
        type_cd: 'mobile',
        status_cd: 'valid_number',
        position: 0,
      }],
    }],
  }));
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { provider_request_id: providerRequestId }, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return { data: { outcome: 'processed' }, error: null };
    },
  };

  const result = await processApolloWebhookDelivery({ token, rawBody }, client);
  assert.deepEqual(result, { kind: 'processed', outcome: 'processed' });
  assert.equal(calls[0]?.params.p_provider_request_id, providerRequestId);
  assert.equal(calls[0]?.params.p_provider_status, 'SUCCESS');
  assert.deepEqual(calls[0]?.params.p_candidate, {
    apollo_person_id: 'apollo-person-1',
    phone_numbers: [{
      raw_number: '+1 555 010 0001',
      sanitized_number: '+15550100001',
      type: 'mobile',
      position: '0',
      status: 'valid_number',
    }],
    primary_phone: '+15550100001',
  });
});

test('Apollo webhook URLs fail closed for local or insecure origins', () => {
  const token = 'b'.repeat(43);
  assert.equal(resolveApolloWebhookUrl(token, { CANONICAL_APP_URL: 'http://example.test' }), null);
  assert.equal(resolveApolloWebhookUrl(token, { CANONICAL_APP_URL: 'https://localhost:9003' }), null);
});

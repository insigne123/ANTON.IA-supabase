import assert from 'node:assert/strict';
import test from 'node:test';

import { buildN8nResearchRequestIdempotencyKey } from '@/lib/server/research-request-identity';

test('n8n request identity normalizes owner and lead fields and includes client key and freshness', () => {
  const input = {
    userId: ' USER-1 ',
    organizationId: ' ORG-1 ',
    leadRef: ' LEAD-1 ',
    email: 'JANE@ACME.TEST',
    companyDomain: 'https://www.ACME.TEST/about',
    clientKey: ' CLIENT-1 ',
    freshnessBucket: '2026-08-13',
  };
  const first = buildN8nResearchRequestIdempotencyKey(input);
  const normalized = buildN8nResearchRequestIdempotencyKey({
    ...input,
    userId: 'user-1',
    organizationId: 'org-1',
    leadRef: 'lead-1',
    email: 'jane@acme.test',
    companyDomain: 'acme.test',
    clientKey: 'client-1',
  });

  assert.equal(first, normalized);
  assert.notEqual(first, buildN8nResearchRequestIdempotencyKey({ ...input, organizationId: 'org-2' }));
  assert.notEqual(first, buildN8nResearchRequestIdempotencyKey({ ...input, clientKey: 'client-2' }));
  assert.notEqual(first, buildN8nResearchRequestIdempotencyKey({ ...input, freshnessBucket: '2026-08-14' }));
});

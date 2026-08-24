import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  INTERNAL_AUTH_HEADER,
  authenticateInternalRequest,
  consumeEndpointRateLimit,
  getGatewayConfig,
  readBoundedJsonBody,
} from './gateway';

test('internal authentication fails closed when the shared secret is missing or incorrect', () => {
  const headers = new Headers();
  const missing = authenticateInternalRequest(headers, {});
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.status, 503);
    assert.equal(missing.code, 'INTERNAL_AUTH_NOT_CONFIGURED');
  }

  headers.set(INTERNAL_AUTH_HEADER, 'wrong-secret');
  const incorrect = authenticateInternalRequest(headers, { ENRICHMENT_SERVICE_SECRET: 'correct-secret' });
  assert.equal(incorrect.ok, false);
  if (!incorrect.ok) {
    assert.equal(incorrect.status, 401);
    assert.equal(incorrect.code, 'INTERNAL_AUTH_REQUIRED');
  }

  headers.set(INTERNAL_AUTH_HEADER, 'correct-secret');
  assert.deepEqual(authenticateInternalRequest(headers, { ENRICHMENT_SERVICE_SECRET: 'correct-secret' }), { ok: true });
});

test('endpoint rate limiting is bounded and returns retry information', () => {
  const config = getGatewayConfig({
    APOLLO_BACKEND_RATE_LIMIT_WINDOW_MS: '1000',
    APOLLO_BACKEND_LEAD_SEARCH_MAX_REQUESTS: '2',
  });
  const now = Date.now();
  const first = consumeEndpointRateLimit('lead-search', config, now);
  const second = consumeEndpointRateLimit('lead-search', config, now);
  const third = consumeEndpointRateLimit('lead-search', config, now);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok(third.retryAfterSeconds >= 1);
});

test('bounded JSON parsing rejects oversized request bodies before validation', async () => {
  const request = new Request('https://backend.example/api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lead: { id: 'apollo-person-id' } }),
  });

  const result = await readBoundedJsonBody(request, 10);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 413);
    assert.equal(result.code, 'REQUEST_TOO_LARGE');
  }
});

test('App Hosting binds the shared secret at runtime only', () => {
  const config = readFileSync(new URL('../../apphosting.yaml', import.meta.url), 'utf8');
  assert.match(config, /variable: ENRICHMENT_SERVICE_SECRET\s+secret: ENRICHMENT_SERVICE_SECRET\s+availability: \[RUNTIME\]/);
  assert.doesNotMatch(config, /variable: ENRICHMENT_SERVICE_SECRET[\s\S]{0,160}availability: \[BUILD/);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { getSupliaStepTimeoutMs, getSupliaToolLeasePolicy } from './tool-limits';

test('external search uses provider lease limits', () => {
  const env = { SUPLIA_APOLLO_CONCURRENCY_PER_ORG: '1', SUPLIA_PDL_CONCURRENCY_PER_ORG: '4', SUPLIA_TOOL_LEASE_TTL_SECONDS: '90' };

  assert.deepEqual(getSupliaToolLeasePolicy('prospecting.search_companies', { provider: 'apollo' }, env), {
    resourceKey: 'provider:apollo',
    maxConcurrent: 1,
    ttlSeconds: 90,
  });

  assert.deepEqual(getSupliaToolLeasePolicy('prospecting.search_people', { provider: 'pdl' }, env), {
    resourceKey: 'provider:pdl',
    maxConcurrent: 4,
    ttlSeconds: 90,
  });
});

test('email tools use email leases', () => {
  const env = { SUPLIA_EMAIL_CONCURRENCY_PER_ORG: '2', SUPLIA_BULK_SEND_CONCURRENCY_PER_ORG: '1' };

  assert.equal(getSupliaToolLeasePolicy('email.send', { provider: 'gmail' }, env)?.resourceKey, 'email:gmail');
  assert.equal(getSupliaToolLeasePolicy('thread.reply_send', {}, env)?.resourceKey, 'email:auto');
  assert.deepEqual(getSupliaToolLeasePolicy('email.bulk_send', {}, env), {
    resourceKey: 'email:bulk_send',
    maxConcurrent: 1,
    ttlSeconds: 120,
  });
});

test('gmail read tools use gmail read lease', () => {
  const env = { SUPLIA_GMAIL_READ_CONCURRENCY_PER_ORG: '2', SUPLIA_TOOL_LEASE_TTL_SECONDS: '45' };

  for (const toolName of ['gmail.search_messages', 'gmail.get_message', 'gmail.get_thread', 'gmail.search_threads', 'gmail.find_contacted_leads']) {
    assert.deepEqual(getSupliaToolLeasePolicy(toolName, {}, env), {
      resourceKey: 'gmail:read',
      maxConcurrent: 2,
      ttlSeconds: 45,
    }, toolName);
  }
});

test('safe internal tools do not require leases', () => {
  assert.equal(getSupliaToolLeasePolicy('compliance.preflight_campaign', {}, {}), null);
  assert.equal(getSupliaStepTimeoutMs({ SUPLIA_STEP_TIMEOUT_MS: '30000' }), 30000);
});

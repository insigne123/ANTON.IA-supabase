import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULLENRICH_CONTACT_FIELDS,
  fetchFullEnrichBulkEnrichmentResult,
  resolveFullEnrichWebhookUrl,
  submitFullEnrichBulkEnrichment,
  validateFullEnrichBulkContact,
} from './fullenrich-enrichment';

test('FullEnrich bulk contacts require a precise identity and only request work data', () => {
  assert.deepEqual(FULLENRICH_CONTACT_FIELDS, ['contact.work_emails', 'contact.phones']);
  assert.equal(validateFullEnrichBulkContact({ custom: { callback: 'one' } }), null);
  assert.equal(validateFullEnrichBulkContact({
    firstName: 'Ana',
    companyDomain: 'example.com',
    custom: { callback: 'one' },
  }), null);
  assert.deepEqual(validateFullEnrichBulkContact({
    firstName: 'Ana',
    lastName: 'Perez',
    companyDomain: 'https://www.example.com/team',
    enrichFields: ['contact.work_emails'],
    custom: { callback: 'one' },
  }), {
    first_name: 'Ana',
    last_name: 'Perez',
    domain: 'example.com',
    enrich_fields: ['contact.work_emails'],
    custom: { callback: 'one' },
  });
});

test('FullEnrich result retrieval uses a completed-batch GET without forceResults', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ id: 'enrichment-123', status: 'FINISHED', data: [] });
  };

  try {
    const result = await fetchFullEnrichBulkEnrichmentResult({
      apiKey: 'test-key',
      enrichmentId: 'enrichment-123',
    });
    assert.equal(result.kind, 'ready');
    assert.ok(request);
    const captured = request as { url: string; init?: RequestInit };
    assert.equal(captured.url, 'https://app.fullenrich.com/api/v2/contact/enrich/bulk/enrichment-123');
    assert.equal(new URL(captured.url).search, '');
    assert.equal(captured.init?.method, 'GET');
    assert.equal(new Headers(captured.init?.headers).get('authorization'), 'Bearer test-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich result retrieval leaves a provider batch pending when it is not finished', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 'error.enrichment.in_progress' }, { status: 400 });

  try {
    assert.deepEqual(await fetchFullEnrichBulkEnrichmentResult({
      apiKey: 'test-key',
      enrichmentId: 'enrichment-123',
    }), { kind: 'in_progress' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich result retrieval recognizes an authoritative credit failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    id: 'enrichment-123',
    status: 'CREDITS_INSUFFICIENT',
    data: [],
  }, { status: 402 });

  try {
    assert.deepEqual(await fetchFullEnrichBulkEnrichmentResult({
      apiKey: 'test-key',
      enrichmentId: 'enrichment-123',
    }), { kind: 'terminal_failure', providerStatus: 'CREDITS_INSUFFICIENT' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FullEnrich webhook URL must be public HTTPS', () => {
  assert.equal(resolveFullEnrichWebhookUrl({ CANONICAL_APP_URL: 'http://localhost:9003' }), null);
  assert.equal(
    resolveFullEnrichWebhookUrl({ CANONICAL_APP_URL: 'https://app.example.com/settings' }),
    'https://app.example.com/api/webhooks/fullenrich',
  );
});

test('FullEnrich bulk submission uses Bearer auth, opaque custom data, and enrichment_id', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return Response.json({ enrichment_id: 'enrichment-123' });
  };

  try {
    const result = await submitFullEnrichBulkEnrichment({
      apiKey: 'test-key',
      webhookUrl: 'https://app.example.com/api/webhooks/fullenrich',
      contacts: [{
        linkedinUrl: 'https://www.linkedin.com/in/ana-perez',
        custom: { fullenrich_callback_id: '11111111-1111-4111-8111-111111111111' },
      }],
    });
    assert.deepEqual(result, { enrichmentId: 'enrichment-123' });
    assert.ok(request);
    const captured = request as { url: string; init?: RequestInit };
    assert.equal(captured.url, 'https://app.fullenrich.com/api/v2/contact/enrich/bulk');
    assert.equal(new Headers(captured.init?.headers).get('authorization'), 'Bearer test-key');
    const payload = JSON.parse(String(captured.init?.body));
    assert.match(payload.name, /^ANTON\.IA enrichment /);
    assert.deepEqual(payload.data[0], {
      linkedin_url: 'https://www.linkedin.com/in/ana-perez',
      enrich_fields: ['contact.work_emails', 'contact.phones'],
      custom: { fullenrich_callback_id: '11111111-1111-4111-8111-111111111111' },
    });
    assert.equal(payload.webhook_url, 'https://app.example.com/api/webhooks/fullenrich');
    assert.equal(payload.webhook_events.contact_finished, 'https://app.example.com/api/webhooks/fullenrich');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

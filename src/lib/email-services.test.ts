import assert from 'node:assert/strict';
import test from 'node:test';

import { sendGmailEmail } from './gmail-email-service';
import { sendEmail } from './outlook-email-service';

test('Gmail sends only a canonical draft reference to the consolidated route', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      success: true,
      status: 'sent',
      receipt: {
        dispatchId: 'gmail-dispatch-1',
        status: 'sent',
        replayed: false,
        providerMessageId: 'gmail-message-1',
        providerResponse: { threadId: 'gmail-thread-1' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await sendGmailEmail({
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>HTML body</p>',
      text: 'Different text body',
      draftId: '50000000-0000-4000-8000-000000000001',
      versionId: '50000000-0000-4000-8000-000000000002',
      organizationId: '60000000-0000-4000-8000-000000000001',
      idempotencyKey: 'gmail-divergent-text',
    });
    assert.equal((requestBody as Record<string, unknown> | null)?.draftId, '50000000-0000-4000-8000-000000000001');
    assert.equal((requestBody as Record<string, unknown> | null)?.versionId, '50000000-0000-4000-8000-000000000002');
    assert.equal((requestBody as Record<string, unknown> | null)?.organizationId, '60000000-0000-4000-8000-000000000001');
    assert.equal((requestBody as Record<string, unknown> | null)?.htmlBody, undefined);
    assert.equal((requestBody as Record<string, unknown> | null)?.textBody, undefined);
    assert.equal(result.id, 'gmail-message-1');
    assert.equal(result.dispatchId, 'gmail-dispatch-1');
    assert.equal(result.status, 'sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Outlook sends only a canonical draft reference to the consolidated route', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({
      success: true,
      status: 'sent',
      receipt: {
        dispatchId: 'outlook-dispatch-1',
        status: 'sent',
        replayed: false,
        providerMessageId: 'message-1',
        providerResponse: { conversationId: 'conversation-1' },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const result = await sendEmail({
      to: 'ada@example.com',
      subject: 'Hello',
      htmlBody: '<p>Message</p>',
      requestReceipts: true,
      researchSnapshotId: '50000000-0000-4000-8000-000000000001',
      draftId: '50000000-0000-4000-8000-000000000002',
      versionId: '50000000-0000-4000-8000-000000000003',
      organizationId: '60000000-0000-4000-8000-000000000001',
      idempotencyKey: 'outlook-receipts',
    });

    assert.equal((requestBody as Record<string, unknown> | null)?.draftId, '50000000-0000-4000-8000-000000000002');
    assert.equal((requestBody as Record<string, unknown> | null)?.versionId, '50000000-0000-4000-8000-000000000003');
    assert.equal((requestBody as Record<string, unknown> | null)?.organizationId, '60000000-0000-4000-8000-000000000001');
    assert.equal((requestBody as Record<string, unknown> | null)?.htmlBody, undefined);
    assert.equal((requestBody as Record<string, unknown> | null)?.to, undefined);
    assert.equal(result.messageId, 'message-1');
    assert.equal(result.dispatchId, 'outlook-dispatch-1');
    assert.equal(result.status, 'sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email service facades reject sends without an approved draft reference', async () => {
  await assert.rejects(() => sendEmail({
    to: 'ada@example.com',
    subject: 'Hello',
    htmlBody: '<p>Message</p>',
    organizationId: '60000000-0000-4000-8000-000000000001',
    idempotencyKey: 'missing-approved-draft',
  }), /borrador aprobado/i);
});

test('Gmail returns a durable deferred receipt instead of throwing for a non-2xx response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    status: 'deferred',
    error: 'Daily quota exceeded',
    receipt: {
      dispatchId: 'gmail-dispatch-deferred',
      status: 'deferred',
      replayed: false,
      providerMessageId: null,
      errorCode: 'daily_quota_exceeded',
      errorMessage: 'Daily quota exceeded',
      retry: { retryable: true, phase: 'pre_provider', retryAfterMs: 60_000 },
    },
  }), { status: 429, headers: { 'Content-Type': 'application/json' } });

  try {
    const result = await sendGmailEmail({
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>Message</p>',
      draftId: '50000000-0000-4000-8000-000000000001',
      versionId: '50000000-0000-4000-8000-000000000002',
      organizationId: '60000000-0000-4000-8000-000000000001',
      idempotencyKey: 'gmail-deferred',
    });
    assert.equal(result.status, 'deferred');
    assert.equal(result.dispatchId, 'gmail-dispatch-deferred');
    assert.equal(result.retry?.retryable, true);
    assert.equal(result.error?.code, 'daily_quota_exceeded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Outlook returns a durable unknown receipt without converting it to a generic error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    status: 'unknown',
    error: 'Provider outcome requires reconciliation',
    receipt: {
      dispatchId: 'outlook-dispatch-unknown',
      status: 'unknown',
      replayed: false,
      providerMessageId: null,
      errorCode: 'provider_outcome_unknown',
      errorMessage: 'Provider outcome requires reconciliation',
    },
  }), { status: 502, headers: { 'Content-Type': 'application/json' } });

  try {
    const result = await sendEmail({
      to: 'ada@example.com',
      subject: 'Hello',
      htmlBody: '<p>Message</p>',
      draftId: '50000000-0000-4000-8000-000000000001',
      versionId: '50000000-0000-4000-8000-000000000002',
      organizationId: '60000000-0000-4000-8000-000000000001',
      idempotencyKey: 'outlook-unknown',
    });
    assert.equal(result.status, 'unknown');
    assert.equal(result.dispatchId, 'outlook-dispatch-unknown');
    assert.equal(result.error?.code, 'provider_outcome_unknown');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

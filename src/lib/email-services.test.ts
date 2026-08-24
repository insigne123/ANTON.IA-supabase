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
      idempotencyKey: 'gmail-divergent-text',
    });
    assert.equal((requestBody as Record<string, unknown> | null)?.draftId, '50000000-0000-4000-8000-000000000001');
    assert.equal((requestBody as Record<string, unknown> | null)?.versionId, '50000000-0000-4000-8000-000000000002');
    assert.equal((requestBody as Record<string, unknown> | null)?.htmlBody, undefined);
    assert.equal((requestBody as Record<string, unknown> | null)?.textBody, undefined);
    assert.equal(result.id, 'gmail-message-1');
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
      idempotencyKey: 'outlook-receipts',
    });

    assert.equal((requestBody as Record<string, unknown> | null)?.draftId, '50000000-0000-4000-8000-000000000002');
    assert.equal((requestBody as Record<string, unknown> | null)?.versionId, '50000000-0000-4000-8000-000000000003');
    assert.equal((requestBody as Record<string, unknown> | null)?.htmlBody, undefined);
    assert.equal((requestBody as Record<string, unknown> | null)?.to, undefined);
    assert.equal(result.messageId, 'message-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email service facades reject sends without an approved draft reference', async () => {
  await assert.rejects(() => sendEmail({
    to: 'ada@example.com',
    subject: 'Hello',
    htmlBody: '<p>Message</p>',
    idempotencyKey: 'missing-approved-draft',
  }), /borrador aprobado/i);
});

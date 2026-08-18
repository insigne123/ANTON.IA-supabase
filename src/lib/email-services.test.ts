import assert from 'node:assert/strict';
import test from 'node:test';

import { emailSignatureStorage } from './email-signature-storage';
import { sendGmailEmail } from './gmail-email-service';
import { sendEmail } from './outlook-email-service';

test('Gmail rejects a caller-supplied text part that diverges from HTML', async () => {
  const originalGet = emailSignatureStorage.get;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  emailSignatureStorage.get = async () => null;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called');
  };

  try {
    await assert.rejects(() => sendGmailEmail({
      to: 'ada@example.com',
      subject: 'Hello',
      html: '<p>HTML body</p>',
      text: 'Different text body',
      idempotencyKey: 'gmail-divergent-text',
    }), /parte de texto distinta/i);
    assert.equal(fetchCalled, false);
  } finally {
    emailSignatureStorage.get = originalGet;
    globalThis.fetch = originalFetch;
  }
});

test('Outlook propagates receipt requests to the consolidated route', async () => {
  const originalGet = emailSignatureStorage.get;
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  emailSignatureStorage.get = async () => null;
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
      idempotencyKey: 'outlook-receipts',
    });

    assert.equal((requestBody as Record<string, unknown> | null)?.requestReceipts, true);
    assert.equal(
      (requestBody as Record<string, unknown> | null)?.researchSnapshotId,
      '50000000-0000-4000-8000-000000000001',
    );
    assert.equal(result.messageId, 'message-1');
  } finally {
    emailSignatureStorage.get = originalGet;
    globalThis.fetch = originalFetch;
  }
});

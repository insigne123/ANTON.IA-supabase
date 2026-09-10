import assert from 'node:assert/strict';
import test from 'node:test';
import { sendGmail, sendOutlook } from './server-email-sender';
import { ConfirmedProviderRejectionError } from './server/outbound-dispatch';
import { prepareOutboundEmail } from './email-outbound';
import { encodeHeaderRFC2047 } from './email-header-utils';

const target = { provider: 'gmail' as const, parentDispatchId: 'dispatch', messageId: 'parent', threadId: 'thread' };
const options = { unsubscribeUrl: 'https://example.test/unsubscribe?token=test', idempotencyKey: 'dispatch-key', replyTarget: target };
const parent = () => ({ id: 'parent', threadId: 'thread', labelIds: ['SENT'], payload: { headers: [
  { name: 'To', value: 'Ada <ada@example.com>' }, { name: 'Subject', value: 'Hello' },
  { name: 'Message-ID', value: '<parent@example.com>' }, { name: 'References', value: '<root@example.com>' },
] } });

test('Gmail verified reply sends MIME reply headers, approved subject and body with threadId exactly once', async (t) => {
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    requests.push({ url, init });
    return Response.json(init?.method === 'POST' ? { id: 'sent', threadId: 'thread' } : parent());
  });
  const html = '<p>Following up.</p>';
  await sendGmail('fake-token', 'ada@example.com', 'Re: Hello', html, options);
  assert.equal(requests.length, 2);
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.threadId, 'thread');
  const mime = Buffer.from(body.raw, 'base64url').toString();
  assert.match(mime, /In-Reply-To: <parent@example.com>\r\n/);
  assert.match(mime, /References: <root@example.com> <parent@example.com>\r\n/);
  assert.match(mime, /X-ANTON-Dispatch: dispatch-key/);
  assert.ok(mime.includes(`Subject: ${encodeHeaderRFC2047('Re: Hello')}\r\n`));
  assert.equal(mime.split('\r\n\r\n')[1], prepareOutboundEmail({ html, unsubscribeUrl: options.unsubscribeUrl }).html);
});

test('Gmail unverified parents and mismatched subjects fail definitively without a new-mail fallback', async (t) => {
  for (const mutate of [
    (p: any) => { p.threadId = 'foreign'; },
    (p: any) => { p.labelIds = ['INBOX']; },
    (p: any) => { p.payload.headers[0].value = 'other@example.com'; },
    (p: any) => { p.payload.headers[1].value = 'Different'; },
    (p: any) => { p.payload.headers[2].value = '<parent@example.com>\r\nBcc: victim@example.com'; },
    (p: any) => { p.payload.headers[3].value = 'bad reference'; },
  ]) {
    const value = parent(); mutate(value);
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json(value); });
    await assert.rejects(sendGmail('fake', 'ada@example.com', 'Hello', '<p>Follow up</p>', options),
      (error: any) => error instanceof ConfirmedProviderRejectionError && error.response?.providerInvoked === false);
    assert.equal(calls, 1);
    mock.mock.restore();
  }
});

test('Gmail send failures retain confirmed rejection versus unknown-outcome semantics', async (t) => {
  for (const status of [400, 429, 500]) {
    const mock = t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => init?.method === 'POST'
      ? new Response('provider error', { status }) : Response.json(parent()));
    await assert.rejects(sendGmail('fake', 'ada@example.com', 'Hello', '<p>Follow up</p>', options),
      (error: any) => (error instanceof ConfirmedProviderRejectionError) === (status === 400));
    mock.mock.restore();
  }
});

test('Gmail parent lookup timeout, HTTP failures and malformed JSON are definitive pre-send failures', async (t) => {
  for (const response of ['timeout', 'json', 403, 404, 429, 500] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
      assert.notEqual(init?.method, 'POST');
      if (response === 'timeout') throw new Error('lookup timeout');
      if (response === 'json') return new Response('{');
      return new Response('lookup failed', { status: response });
    });
    await assert.rejects(sendGmail('fake', 'ada@example.com', 'Re: Hello', '<p>Approved</p>', options),
      (error: any) => error instanceof ConfirmedProviderRejectionError && error.response?.providerInvoked === false);
    mock.mock.restore();
  }
});

test('Outlook explicitly requested replies fail before any provider call or draft creation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('No provider call allowed'); });
  await assert.rejects(sendOutlook('fake', 'ada@example.com', 'Hello', '<p>Follow up</p>', options),
    (error: any) => error instanceof ConfirmedProviderRejectionError
      && error.message === 'OUTLOOK_NATIVE_REPLY_UNSUPPORTED' && error.response?.providerInvoked === false);
});

test('Outlook new-message mode preserves approved content, receipts and sent correlation', async (t) => {
  let posts = 0;
  const html = '<p>Approved follow-up with a new subject</p>';
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if (init?.method === 'POST') {
      posts++;
      assert.equal(url, 'https://graph.microsoft.com/v1.0/me/sendMail');
      const payload = JSON.parse(init.body);
      assert.equal(payload.saveToSentItems, true);
      assert.equal(payload.message.subject, 'A different approved subject');
      assert.equal(payload.message.body.content, prepareOutboundEmail({ html, unsubscribeUrl: options.unsubscribeUrl }).html);
      assert.deepEqual(payload.message.toRecipients, [{ emailAddress: { address: 'ada@example.com' } }]);
      assert.equal(payload.message.isDeliveryReceiptRequested, true);
      assert.equal(payload.message.isReadReceiptRequested, true);
      return new Response(null, { status: 202 });
    }
    assert.match(String(url), /mailFolders\('SentItems'\)\/messages\?/);
    return Response.json({ value: [{ id: 'sent', subject: 'A different approved subject', conversationId: 'new-thread',
      toRecipients: [{ emailAddress: { address: 'ada@example.com' } }],
      internetMessageHeaders: [{ name: 'X-ANTON-Dispatch', value: 'dispatch-key' }] }] });
  });
  const result = await sendOutlook('fake', 'ada@example.com', 'A different approved subject', html, { ...options, replyTarget: undefined, requestReceipts: true });
  assert.equal(result.id, 'sent');
  assert.equal(posts, 1);
});

test('Gmail first contact keeps its single-call new-message path', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.threadId, undefined);
    assert.doesNotMatch(Buffer.from(body.raw, 'base64url').toString(), /In-Reply-To:|References:/);
    return Response.json({ id: 'sent', threadId: 'new-thread' });
  });
  await sendGmail('fake', 'ada@example.com', 'Hello', '<p>First contact</p>', { unsubscribeUrl: options.unsubscribeUrl });
  assert.equal(calls, 1);
});

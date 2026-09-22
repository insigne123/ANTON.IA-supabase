import assert from 'node:assert/strict';
import test from 'node:test';
import { sendGmail, sendOutlook } from './server-email-sender';
import { ConfirmedProviderRejectionError } from './server/outbound-dispatch';
import { prepareOutboundEmail } from './email-outbound';
import { encodeHeaderRFC2047 } from './email-header-utils';

const target = { provider: 'gmail' as const, parentDispatchId: 'dispatch', messageId: 'parent', threadId: 'thread' };
const options = { unsubscribeUrl: 'https://example.test/unsubscribe?token=test', idempotencyKey: 'dispatch-key', trackingDispatchId: 'dispatch-key', replyTarget: target };
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
  const html = '<p>Following up.</p><a href="https://example.test/destination">Destino</a>';
  await sendGmail('fake-token', 'ada@example.com', 'Re: Hello', html, options);
  assert.equal(requests.length, 2);
  const body = JSON.parse(requests[1].init.body);
  assert.equal(body.threadId, 'thread');
  const mime = Buffer.from(body.raw, 'base64url').toString();
  assert.match(mime, /In-Reply-To: <parent@example.com>\r\n/);
  assert.match(mime, /References: <root@example.com> <parent@example.com>\r\n/);
  assert.match(mime, /X-ANTON-Dispatch: dispatch-key/);
  assert.match(mime, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.match(mime, /\/api\/tracking\/open\?dispatch=dispatch-key/);
  assert.match(mime, /\/api\/tracking\/click\?dispatch=dispatch-key&amp;url=https%3A%2F%2Fexample\.test%2Fdestination/);
  assert.ok(mime.includes(`Subject: ${encodeHeaderRFC2047('Re: Hello')}\r\n`));
  assert.match(mime.split('\r\n\r\n')[1], /Following up/);
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
      && error.message === 'OUTLOOK_REPLY_PROVIDER_MISMATCH' && error.response?.providerInvoked === false);
});

test('Outlook reply is built from the verified sent parent, sent in its conversation and correlated', async (t) => {
  const calls: Array<{ url: string; method: string }> = [];
  let patchedBody: any;
  t.mock.method(globalThis, 'fetch', async (rawUrl: any, init: any) => {
    const url = String(rawUrl); const method = init?.method || 'GET'; calls.push({ url, method });
    if (url.includes('/me/messages/parent?')) return Response.json({ id: 'parent', conversationId: 'conversation', subject: 'Hello', from: { emailAddress: { address: 'owner@example.com' } }, toRecipients: [{ emailAddress: { address: 'ada@example.com' } }], isDraft: false });
    if (url.endsWith('/me?$select=mail,userPrincipalName')) return Response.json({ mail: 'owner@example.com' });
    if (url.endsWith('/parent/createReply')) return Response.json({ id: 'reply-draft', conversationId: 'conversation' });
    if (url.endsWith('/messages/reply-draft') && method === 'PATCH') {
      const body = JSON.parse(init.body);
      patchedBody = body;
      assert.deepEqual(body.toRecipients, [{ emailAddress: { address: 'ada@example.com' } }]);
      assert.deepEqual(body.ccRecipients, []);
      assert.deepEqual(body.bccRecipients, []);
      assert.match(body.body.content, /responde a este mensaje indicándolo/i);
      assert.ok(body.internetMessageHeaders.some((header: any) => header.name === 'X-ANTON-Dispatch' && header.value === 'dispatch-key'));
      return Response.json({ id: 'reply-draft' });
    }
    if (url.includes('/messages/reply-draft?$select=')) return Response.json({ id: 'reply-draft', isDraft: true, conversationId: 'conversation', ...patchedBody });
    if (url.endsWith('/messages/reply-draft/send')) return new Response(null, { status: 202 });
    if (url.includes("mailFolders('SentItems')/messages?")) return Response.json({ value: [{ id: 'sent-reply', subject: 'RE: Hello', conversationId: 'conversation', toRecipients: [{ emailAddress: { address: 'ada@example.com' } }], internetMessageHeaders: [{ name: 'X-ANTON-Dispatch', value: 'dispatch-key' }] }] });
    throw new Error(`Unexpected Graph request ${method} ${url}`);
  });
  const result = await sendOutlook('fake', 'ada@example.com', 'Re: Hello', '<p>Gracias por responder</p>', { unsubscribeUrl: options.unsubscribeUrl, idempotencyKey: 'dispatch-key', replyTarget: { provider: 'outlook', contactedId: 'contact', messageId: 'parent', conversationId: 'conversation' } });
  assert.equal(result.id, 'sent-reply');
  assert.ok(calls.some(call => call.url.endsWith('/parent/createReply')));
  assert.ok(calls.some(call => call.url.endsWith('/messages/reply-draft/send')));
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
      assert.ok(payload.message.body.content.startsWith(prepareOutboundEmail({ html, unsubscribeUrl: options.unsubscribeUrl }).html));
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

test('Outlook refuses a reply draft addressed to the sender or containing extra recipients', async (t) => {
  for (const recipients of [
    { toRecipients: [{ emailAddress: { address: 'owner@example.com' } }], ccRecipients: [], bccRecipients: [] },
    { toRecipients: [{ emailAddress: { address: 'ada@example.com' } }], ccRecipients: [{ emailAddress: { address: 'other@example.com' } }], bccRecipients: [] },
  ]) {
    let patched: any;
    const mock = t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
      const url = String(input);
      assert.ok(!url.endsWith('/send'), 'Never send an unverified draft');
      if (url.includes('/messages/parent?')) return Response.json({ id: 'parent', conversationId: 'thread', subject: 'Hello', from: { emailAddress: { address: 'owner@example.com' } }, toRecipients: [{ emailAddress: { address: 'ada@example.com' } }] });
      if (url.includes('/me?$select=')) return Response.json({ mail: 'owner@example.com' });
      if (url.endsWith('/createReply')) return Response.json({ id: 'draft', conversationId: 'thread' });
      if (init?.method === 'PATCH') { patched = JSON.parse(init.body); return Response.json({ id: 'draft' }); }
      return Response.json({ ...patched, id: 'draft', isDraft: true, conversationId: 'thread', ...recipients });
    });
    await assert.rejects(sendOutlook('fake', 'ada@example.com', 'Re: Hello', '<p>Respuesta</p>', { unsubscribeUrl: options.unsubscribeUrl, idempotencyKey: 'key', replyTarget: { provider: 'outlook', contactedId: 'contact', messageId: 'parent', conversationId: 'thread' } }), /recipient, content or correlation/);
    mock.mock.restore();
  }
});

test('Gmail first contact keeps its single-call new-message path', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.threadId, undefined);
    const raw = Buffer.from(body.raw, 'base64url').toString();
    assert.doesNotMatch(raw, /In-Reply-To:|References:/);
    assert.match(raw, /List-Unsubscribe: <https:\/\/example\.test\/api\/tracking\/unsubscribe\?token=test>/i);
    assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/i);
    assert.match(raw, /responde a este mensaje indicándolo/i);
    assert.match(raw, /\/api\/tracking\/open\?dispatch=tracked-dispatch-01/);
    return Response.json({ id: 'sent', threadId: 'new-thread' });
  });
  await sendGmail('fake', 'ada@example.com', 'Hello', '<p><a href="https://example.test/offer">Ver propuesta</a></p>', { unsubscribeUrl: options.unsubscribeUrl, idempotencyKey: 'tracked-dispatch-01', trackingDispatchId: 'tracked-dispatch-01' });
  assert.equal(calls, 1);
});

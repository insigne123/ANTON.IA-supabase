import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Isolate provider polling from classification, notifications and all external services.
const source = readFileSync('src/lib/server/reply-sync.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load() {
  const exports: any = {};
  new Function('require', 'exports', compiled)(() => ({
    tokenService: { getToken: async () => null }, detectDeliveryFailure: () => null,
  }), exports);
  return exports;
}
const row = { id: 'contact', email: 'ada@example.com', sent_at: '2026-08-01T00:00:00Z', thread_id: 'thread', conversation_id: 'conversation' };
const gmailMessage = (overrides = {}) => ({ id: 'reply', threadId: 'thread', internalDate: String(Date.parse('2026-08-02T00:00:00Z')), payload: { headers: [{ name: 'From', value: 'ada@example.com' }] }, ...overrides });

test('Gmail provider failure is not an empty reply result', async (t) => {
  for (const status of [401, 429, 500]) {
    const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).endsWith('/profile')
      ? Response.json({ emailAddress: 'owner@example.com' }) : new Response('', { status }));
    await assert.rejects(load().findGmailReply('fake', row), /lookup failed/);
    mock.mock.restore();
  }
});
test('Gmail matches verified thread and sender, not unrelated or undated messages', async (t) => {
  for (const [message, expected] of [
    [gmailMessage(), 'reply'], [gmailMessage({ threadId: 'other' }), undefined],
    [gmailMessage({ internalDate: null }), undefined],
    [gmailMessage({ payload: { headers: [{ name: 'From', value: 'stranger@outlook.com' }] } }), undefined],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).endsWith('/profile')
      ? Response.json({ emailAddress: 'owner@example.com' }) : Response.json({ messages: [message] }));
    assert.equal((await load().findGmailReply('fake', row))?.id, expected);
    mock.mock.restore();
  }
});
test('empty Gmail thread does not widen to sender-only search', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any) => { calls.push(String(url)); return Response.json({ messages: [] }); });
  assert.equal(await load().findGmailReply('fake', row), null);
  assert.equal(calls.length, 2);
});
test('Outlook provider errors surface and empty conversations do not fall back', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(load().findOutlookReply('fake', row), /lookup failed/);
  mock.mock.restore();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ value: [] }); });
  assert.equal(await load().findOutlookReply('fake', row), null);
  assert.equal(calls, 1);
});

test('Outlook matching requires conversation, sender and a real timestamp', async (t) => {
  const message = { id: 'reply', conversationId: 'conversation', from: { emailAddress: { address: 'ada@example.com' } }, receivedDateTime: '2026-08-02T00:00:00Z' };
  for (const [item, expected] of [
    [message, 'reply'], [{ ...message, conversationId: 'other' }, undefined],
    [{ ...message, receivedDateTime: null }, undefined],
    [{ ...message, from: { emailAddress: { address: 'other@example.com' } } }, undefined],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ value: [item] }));
    assert.equal((await load().findOutlookReply('fake', row))?.id, expected);
    mock.mock.restore();
  }
});

test('Gmail search fallback requires an exact parent reference, not sender alone', async (t) => {
  const unthreaded = { ...row, thread_id: null, conversation_id: null, internet_message_id: 'parent@example.com' };
  for (const reference of ['<parent@example.com>', '<other@example.com>', '']) {
    const message = gmailMessage();
    message.payload.headers.push({ name: 'In-Reply-To', value: reference });
    const mock = t.mock.method(globalThis, 'fetch', async (url: any) => {
      if (String(url).endsWith('/profile')) return Response.json({ emailAddress: 'owner@example.com' });
      if (String(url).includes('messages?q=')) return Response.json({ messages: [{ id: 'reply' }] });
      return Response.json(message);
    });
    assert.equal((await load().findGmailReply('fake', unthreaded))?.id, reference === '<parent@example.com>' ? 'reply' : undefined);
    mock.mock.restore();
  }
});
test('bounded scan filters before limit and cursor advances beyond repeatedly unresponsive rows', async () => {
  const records = [
    { id: 'a', provider: 'gmail', status: 'replied', replied_at: 'date' },
    { id: 'b', provider: 'other', status: 'sent', replied_at: null },
    { id: 'c', provider: 'gmail', status: 'sent', replied_at: null },
    { id: 'd', provider: 'gmail', status: 'sent', replied_at: null },
    { id: 'e', provider: 'gmail', status: 'failed', replied_at: null },
  ];
  const client = { from() {
    let rows = records.slice();
    return {
      select() { return this; }, eq() { return this; },
      in(key: string, values: any[]) { rows = rows.filter((r: any) => values.includes(r[key])); return this; },
      is(key: string, value: any) { rows = rows.filter((r: any) => r[key] === value); return this; },
      or(filter: string) { assert.equal(filter, 'status.is.null,status.not.in.(replied,failed)'); rows = rows.filter((r) => !['replied', 'failed'].includes(r.status)); return this; },
      order(key: string) { assert.equal(key, 'id'); return this; },
      limit(value: number) { assert.equal(value, 2); return this; },
      gt(_key: string, cursor: string) { rows = rows.filter((r) => r.id > cursor); return this; },
      then(resolve: any) { return Promise.resolve({ data: rows.slice(0, 2), error: null }).then(resolve); },
    };
  } };
  const sync = load().syncRepliesForOrganization;
  const first = await sync(client, { organizationId: 'org', limit: 1 });
  assert.equal(first.scanned, 1); assert.equal(first.nextCursor, 'c');
  const second = await sync(client, { organizationId: 'org', limit: 1, cursor: first.nextCursor });
  assert.equal(second.scanned, 1); assert.equal(second.nextCursor, null);
  assert.equal(second.skippedNoToken, 1);
});

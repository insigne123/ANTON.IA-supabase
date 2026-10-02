import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { emailDomain, isFreeMailDomain } from '../cowork/send-cadence';
import { replyStageSuggestion } from '../reply-stage';

// Isolate provider polling from classification, notifications and all external services.
const source = readFileSync('src/lib/server/reply-sync.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(overrides: Record<string, unknown> = {}) {
  const exports: any = {};
  new Function('require', 'exports', compiled)(() => ({
    tokenService: { getToken: async () => null }, detectDeliveryFailure: () => null,
    detectAutoReplyHeaders: () => null,
    replySyncDueFilter: () => 'reply_sync_attempted_at.is.null',
    emailDomain, isFreeMailDomain,
    ...overrides,
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
    // Somebody else at the contact's company inside the conversation is the company answering; a stranger from another domain is not.
    [{ ...message, from: { emailAddress: { address: 'other@example.com' } } }, 'reply'],
    [{ ...message, from: { emailAddress: { address: 'other@elsewhere.org' } } }, undefined],
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
    { id: 'a', provider: 'gmail', status: 'replied', replied_at: 'date', sent_at: 'date' },
    { id: 'b', provider: 'other', status: 'sent', replied_at: null, sent_at: 'date' },
    { id: 'c', provider: 'gmail', status: 'sent', replied_at: null, sent_at: 'date' },
    { id: 'd', provider: 'gmail', status: 'sent', replied_at: null, sent_at: 'date' },
    { id: 'e', provider: 'gmail', status: 'failed', replied_at: null, sent_at: 'date' },
  ];
  const client = { from() {
    let rows = records.slice();
    return {
      select() { return this; }, update() { return this; }, eq() { return this; }, not() { return this; },
      in(key: string, values: any[]) { rows = rows.filter((r: any) => values.includes(r[key])); return this; },
      is(key: string, value: any) { rows = rows.filter((r: any) => r[key] === value); return this; },
      or(filter: string) {
        if (filter.startsWith('status.is.null')) {
          assert.equal(filter, 'status.is.null,status.not.in.(scheduled,failed)');
          rows = rows.filter((r) => !['failed'].includes(r.status));
        } else {
          assert.match(filter, /reply_sync_attempted_at/);
        }
        return this;
      },
      order(key: string) { assert.ok(key === 'reply_sync_attempted_at' || key === 'id'); return this; },
      limit(value: number) { assert.equal(value, 2); return this; },
      gt(_key: string, cursor: string) { rows = rows.filter((r) => r.id > cursor); return this; },
      then(resolve: any) { return Promise.resolve({ data: rows.slice(0, 2), error: null }).then(resolve); },
    };
  } };
  const sync = load().syncRepliesForOrganization;
  const first = await sync(client, { organizationId: 'org', limit: 1 });
  assert.equal(first.scanned, 1); assert.equal(first.nextCursor, 'a');
  const second = await sync(client, { organizationId: 'org', limit: 1, cursor: first.nextCursor });
  assert.equal(second.scanned, 1); assert.equal(second.nextCursor, 'c');
  assert.equal(second.skippedNoToken, 1);
  const third = await sync(client, { organizationId: 'org', limit: 1, cursor: second.nextCursor });
  assert.equal(third.scanned, 1); assert.equal(third.nextCursor, null);
});
test('sync writes one attempt update per page and groups error states', async () => {
  const records = [
    { id: 'a', provider: 'gmail', status: 'sent', replied_at: null, sent_at: 'date' },
    { id: 'c', provider: 'gmail', status: 'sent', replied_at: null, sent_at: 'date' },
  ];
  let updates = 0;
  const client = { from() {
    let rows = records.slice();
    return {
      select() { return this; }, update() { updates++; return this; }, eq() { return this; }, not() { return this; },
      in(key: string, values: any[]) { rows = rows.filter((r: any) => values.includes(r[key])); return this; },
      or() { return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve: any) { return Promise.resolve({ data: rows.slice(0, 10), error: null }).then(resolve); },
    };
  } };
  const result = await load().syncRepliesForOrganization(client, { organizationId: 'org', limit: 10 });
  assert.equal(result.scanned, 2);
  assert.equal(result.skippedNoToken, 2);
  assert.equal(updates, 2);
});

// Somebody else at the contact's company answers: the company is what stops (findCompanyReply), so the detector has to see it.
const companyRow = { id: 'contact', email: 'ada@example.com', company: 'Example', provider: 'gmail', sent_at: '2026-08-01T00:00:00Z', thread_id: 'thread', conversation_id: 'conversation', internet_message_id: 'parent@example.com' };

test('isCompanyColleague: another address on the same corporate domain, never a shared provider, a system sender or a mailbox nobody reads', () => {
  const { isCompanyColleague, corporateDomain } = load();
  assert.equal(isCompanyColleague('grace@example.com', 'ada@example.com'), true);
  assert.equal(isCompanyColleague(' Grace@Example.com ', 'ada@example.com'), true);
  assert.equal(isCompanyColleague('info@example.com', 'ada@example.com'), true, 'a shared inbox people answer from is the company');
  assert.equal(isCompanyColleague('ada@example.com', 'ada@example.com'), false, 'the contact is not a colleague');
  assert.equal(isCompanyColleague('grace@other.org', 'ada@example.com'), false);
  for (const shared of ['gmail.com', 'outlook.com', 'vtr.net', 'yahoo.cl']) assert.equal(isCompanyColleague(`grace@${shared}`, `ada@${shared}`), false, shared);
  for (const system of ['mailer-daemon@example.com', 'postmaster@example.com']) assert.equal(isCompanyColleague(system, 'ada@example.com'), false, system);
  for (const automated of ['no-reply@example.com', 'noreply@example.com', 'do-not-reply@example.com', 'auto-reply@example.com', 'notificaciones@example.com', 'newsletter@example.com']) {
    assert.equal(isCompanyColleague(automated, 'ada@example.com'), false, automated);
  }
  assert.equal(isCompanyColleague(null, 'ada@example.com'), false);
  assert.equal(corporateDomain('ada@example.com'), 'example.com');
  assert.equal(corporateDomain('ada@gmail.com'), null);
  assert.equal(corporateDomain('not-an-email'), null);
});

test('in the verified thread, a message from somebody else at the contact company is a reply; strangers, shared providers and automatic messages are not', () => {
  const { inboundCandidates } = load();
  const message = (from: string, extra: Record<string, unknown> = {}) => ({ provider: 'gmail', id: from, threadId: 'thread', from, receivedAt: '2026-08-02T00:00:00Z', ...extra });
  const ids = (messages: any[], contact: any = companyRow) => inboundCandidates(messages, contact, 'owner@mine.cl').map((item: any) => item.id);
  assert.deepEqual(ids([
    message('ada@example.com'), message('grace@example.com'), message('stranger@other.org'),
    message('grace@example.com', { id: 'ooo', autoReplyHeader: 'auto-submitted' }),
    message('grace@example.com', { id: 'elsewhere', threadId: 'other' }),
  ]), ['ada@example.com', 'grace@example.com']);
  assert.deepEqual(ids([message('ada@gmail.com'), message('grace@gmail.com')], { ...companyRow, email: 'ada@gmail.com' }), ['ada@gmail.com']);
});

const threadMessage = (id: string, from: string, to: string, at: string, labelIds: string[] = []) => ({
  id, threadId: 'thread', internalDate: String(Date.parse(at)), labelIds, payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: to }] },
});

test('the conversation view keeps showing the contact only; the sync also keeps what people at the company wrote in the thread', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ messages: [
    threadMessage('sent', 'owner@mine.cl', 'ada@example.com', '2026-08-01T00:00:00Z', ['SENT']),
    threadMessage('ada', 'ada@example.com', 'owner@mine.cl', '2026-08-02T00:00:00Z'),
    threadMessage('grace', 'Grace <grace@example.com>', 'owner@mine.cl', '2026-08-03T00:00:00Z'),
    threadMessage('stranger', 'stranger@other.org', 'owner@mine.cl', '2026-08-04T00:00:00Z'),
  ] }));
  const { readMailboxConversation } = load();
  const ids = async (options?: { colleagues?: boolean }) => (await readMailboxConversation('token', companyRow, options)).messages.map((item: any) => item.id);
  assert.deepEqual(await ids(), ['sent', 'ada']);
  assert.deepEqual(await ids({ colleagues: true }), ['sent', 'ada', 'grace']);
});

/** The collaborators of a reply that is recorded, replaced by recorders. */
function recorder(intent = 'neutral', inserted = true, deal: 'negotiation' | 'won' | null = null) {
  const ingested: any[] = [];
  const alerts: string[] = [];
  const exceptions: any[] = [];
  const crm: any[] = [];
  let classified = 0;
  const stubs = {
    readReplyDeal: async () => deal,
    replyStageSuggestion,
    classifyReply: async () => { classified++; return { intent, sentiment: 'neutral', confidence: 0.8, summary: 'Lo van a revisar', reason: 'revision', shouldContinue: false }; },
    extractReplyPreview: (text: string) => String(text).slice(0, 80),
    buildThreadKey: () => 'thread-key',
    ingestInboundReply: async (_supabase: unknown, input: any) => { ingested.push(input); return { inserted, reason: inserted ? 'inserted' : 'duplicate', eventKey: 'key' }; },
    conversationAdvice: () => ({}),
    notificationService: { sendAlert: async (_organization: string, _title: string, body: string) => { alerts.push(body); } },
    createAntoniaException: async (_supabase: unknown, input: any) => { exceptions.push(input); return {}; },
    syncLeadAutopilotToCrm: async (_supabase: unknown, update: any) => { crm.push(update); return {}; },
    maybeEscalateReplyReviewFromContactedId: async () => null,
    stripHtmlToText: (html: string) => html,
    isExplicitOptOut: () => false,
  };
  return { ingested, alerts, exceptions, crm, stubs, classifications: () => classified };
}
const supabaseStub = { rpc: async () => ({ error: null }) };
const gmailFull = (id: string, from: string, at: string, headers: Array<{ name: string; value: string }> = []) => ({
  id, threadId: 'unrelated-thread', internalDate: String(Date.parse(at)), snippet: 'Lo vemos con el equipo',
  payload: { mimeType: 'text/plain', body: { data: Buffer.from('Lo vemos con el equipo y te respondemos.').toString('base64url') },
    headers: [{ name: 'From', value: from }, { name: 'Subject', value: 'Re: propuesta' }, { name: 'Message-ID', value: `<${id}@example.com>` }, ...headers] },
});

test('somebody else at the company writing outside the thread is recorded as the company answering, without touching the contact thread', async (t) => {
  const { ingested, alerts, exceptions, stubs } = recorder('positive');
  t.mock.method(globalThis, 'fetch', async () => Response.json(gmailFull('m1', 'Grace <grace@example.com>', '2026-08-05T00:00:00Z')));
  const row = { ...companyRow, organization_id: 'org', user_id: 'user', lead_id: 'lead-1' };
  assert.deepEqual(await load(stubs).syncColleagueMessage(supabaseStub, row, 'token', 'm1'), { recorded: true, reason: 'recorded' });
  assert.equal(ingested.length, 1);
  const input = ingested[0];
  assert.equal(input.contactedId, 'contact');
  assert.equal(input.recipientEmail, 'ada@example.com', 'the ingestion checks the contact address, not the sender');
  assert.equal(input.messageId, 'm1');
  assert.equal(input.eventType, 'reply');
  // The message is not part of the contact's conversation: the thread the contact has stays as it is.
  assert.equal(input.threadId, null); assert.equal(input.conversationId, null); assert.equal(input.threadKey, null);
  assert.deepEqual(input.classification.repliedBy, { kind: 'colleague', email: 'grace@example.com' });
  assert.match(input.classification.summary, /^Respondió grace@example\.com, otra persona de la empresa\. Lo van a revisar/);
  assert.match(alerts[0], /^grace@example\.com, de la empresa de ada@example\.com, respondio: /);
  assert.equal(exceptions[0].category, 'positive_reply');
});

test('what is not the company answering is not recorded: the contact, strangers, shared providers, automatic messages, failures and older messages', async (t) => {
  const run = async (message: unknown, row: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
    const fixture = recorder();
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(message));
    const result = await load({ ...fixture.stubs, ...extra }).syncColleagueMessage(supabaseStub, { ...companyRow, ...row }, 'token', 'm1');
    mock.mock.restore();
    return { result, ingested: fixture.ingested, classified: fixture.classifications() };
  };
  const at = '2026-08-05T00:00:00Z';
  const cases: Array<[string, Awaited<ReturnType<typeof run>>['result']['reason'], Awaited<ReturnType<typeof run>>]> = [
    ['the contact themself', 'not_colleague', await run(gmailFull('m1', 'ada@example.com', at))],
    ['a stranger from another domain', 'not_colleague', await run(gmailFull('m1', 'stranger@other.org', at))],
    ['a shared provider', 'not_colleague', await run(gmailFull('m1', 'grace@gmail.com', at), { email: 'ada@gmail.com' })],
    ['a mailbox nobody reads', 'not_colleague', await run(gmailFull('m1', 'no-reply@example.com', at))],
    ['an automatic message', 'automatic', await run(gmailFull('m1', 'grace@example.com', at), {}, { detectAutoReplyHeaders: () => 'auto-submitted' })],
    ['a delivery failure', 'delivery_failure', await run(gmailFull('m1', 'grace@example.com', at), {}, { detectDeliveryFailure: () => ({ replyIntent: 'delivery_failure' }) })],
    ['a message from before the contact', 'before_contact', await run(gmailFull('m1', 'grace@example.com', '2026-07-31T00:00:00Z'))],
    ['a company that already answered after it', 'already_covered', await run(gmailFull('m1', 'grace@example.com', at), { replied_at: '2026-08-06T00:00:00Z' })],
  ];
  for (const [label, reason, outcome] of cases) {
    assert.deepEqual(outcome.result, { recorded: false, reason }, label);
    assert.equal(outcome.ingested.length, 0, label);
  }
  // A company that already answered later is skipped before the model reads anything.
  assert.equal(cases[7][2].classified, 0);
});

test('a message that was already recorded is a duplicate, not a second reply', async (t) => {
  const { stubs } = recorder('neutral', false);
  t.mock.method(globalThis, 'fetch', async () => Response.json(gmailFull('m1', 'grace@example.com', '2026-08-05T00:00:00Z')));
  assert.deepEqual(await load(stubs).syncColleagueMessage(supabaseStub, companyRow, 'token', 'm1'), { recorded: false, reason: 'duplicate' });
});

test('the Outlook message is read with its headers and its full text', async (t) => {
  const { ingested, stubs } = recorder();
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    urls.push(String(url));
    return Response.json({ id: 'o1', conversationId: 'other-conversation', internetMessageId: '<o1@example.com>', subject: 'Re: propuesta',
      from: { emailAddress: { address: 'grace@example.com' } }, receivedDateTime: '2026-08-05T00:00:00Z', bodyPreview: 'corto',
      body: { contentType: 'text', content: 'Texto completo de la respuesta' } });
  });
  const result = await load(stubs).syncColleagueMessage(supabaseStub, { ...companyRow, provider: 'outlook' }, 'token', 'o1');
  assert.deepEqual(result, { recorded: true, reason: 'recorded' });
  assert.match(urls[0], /\/me\/messages\/o1\?\$select=.*internetMessageHeaders/);
  assert.equal(ingested[0].content, 'Texto completo de la respuesta');
  assert.equal(ingested[0].conversationId, null);
});

test('inside the thread, the reply of a colleague is recorded through the same pipeline, on the thread the contact has', async (t) => {
  const { ingested, stubs } = recorder();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ messages: [
    threadMessage('sent', 'owner@mine.cl', 'ada@example.com', '2026-08-01T00:00:00Z', ['SENT']),
    { ...threadMessage('grace', 'Grace <grace@example.com>', 'owner@mine.cl', '2026-08-03T00:00:00Z'), snippet: 'Lo vemos' },
  ] }));
  const chain: any = { update() { return chain; }, eq() { return chain; }, select: async () => ({ data: [], error: null }) };
  const supabase = { rpc: async () => ({ error: null }), from: () => chain };
  const result = await load(stubs).syncSingleContactRow(supabase, 'org', companyRow, 'token');
  assert.deepEqual(result, { synced: 1, state: 'ok' });
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].threadId, 'thread');
  assert.equal(ingested[0].threadKey, 'thread-key');
  assert.deepEqual(ingested[0].classification.repliedBy, { kind: 'colleague', email: 'grace@example.com' });
});

test('what we sent is never the company answering, even when the contact is on our own domain', async (t) => {
  const { inboundCandidates } = load();
  const sent = { provider: 'gmail', id: 'follow-up', threadId: 'thread', from: 'owner@example.com', receivedAt: '2026-08-02T00:00:00Z', direction: 'outbound' as const };
  const reply = { provider: 'gmail', id: 'grace', threadId: 'thread', from: 'grace@example.com', receivedAt: '2026-08-03T00:00:00Z', direction: 'inbound' as const };
  assert.deepEqual(inboundCandidates([sent, reply], companyRow, null).map((item: any) => item.id), ['grace']);

  // Through the sync: the thread holds our own follow-up to a contact on the same domain, and nothing else.
  const { ingested, stubs } = recorder();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ messages: [
    threadMessage('sent', 'owner@example.com', 'ada@example.com', '2026-08-01T00:00:00Z', ['SENT']),
    threadMessage('follow-up', 'owner@example.com', 'ada@example.com', '2026-08-03T00:00:00Z', ['SENT']),
  ] }));
  const chain: any = { update() { return chain; }, eq() { return chain; }, select: async () => ({ data: [], error: null }) };
  const result = await load(stubs).syncSingleContactRow({ rpc: async () => ({ error: null }), from: () => chain }, 'org', companyRow, 'token');
  assert.deepEqual(result, { synced: 0, state: 'ok' });
  assert.equal(ingested.length, 0);
});

test('each reply proposes its pipeline stage: a meeting, a proposal Jev reads, a refusal and an opt-out (Plan 6, PR-B)', async (t) => {
  const row = { ...companyRow, organization_id: 'org', user_id: 'user', lead_id: 'lead-1' };
  const run = async (intent: string, deal: 'negotiation' | 'won' | null = null) => {
    const fixture = recorder(intent, true, deal);
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(gmailFull('m1', 'Grace <grace@example.com>', '2026-08-05T00:00:00Z')));
    await load(fixture.stubs).syncColleagueMessage(supabaseStub, row, 'token', 'm1');
    mock.mock.restore();
    return fixture.crm.map(update => [update.stage, update.lastAutopilotEvent]);
  };
  assert.deepEqual(await run('meeting_request'), [['meeting', 'meeting_request']], 'a meeting request proposes «Reunión», not «Interesado»');
  assert.deepEqual(await run('positive'), [['engaged', 'positive']]);
  assert.deepEqual(await run('positive', 'negotiation'), [['negotiation', 'reply_negotiation']], 'Jev reads a request for a proposal');
  assert.deepEqual(await run('meeting_request', 'won'), [['closed_won', 'reply_won']]);
  assert.deepEqual(await run('negative'), [['closed_lost', 'not_interested']], 'a refusal proposes «Perdido»');
  assert.deepEqual(await run('unsubscribe'), [['closed_lost', 'unsubscribe']]);
  assert.deepEqual(await run('auto_reply'), [], 'an automatic reply proposes nothing');
  assert.deepEqual(await run('neutral'), []);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/lib/server/mailbox-sweep.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(contactCount: number, failAt = -1) {
  const writes: Array<Record<string, unknown>> = [];
  let synced = 0;
  const contacts = Array.from({ length: contactCount }, (_, index) => ({
    id: `c${index}`, email: 'lead@example.test', sent_at: '2026-09-01T00:00:00Z',
  }));
  const exports: any = {};
  const modules: Record<string, unknown> = {
    './reply-sync': {
      mailboxAccessToken: async () => 'token',
      normalizeEmail: (value: string) => value.toLowerCase(),
      extractEmailAddress: (value: string) => value,
      corporateDomain: () => null, isCompanyColleague: () => false, syncColleagueMessage: async () => ({ recorded: false, reason: 'not_colleague' }),
      syncSingleContactRow: async () => {
        synced++;
        return { synced: 0, state: synced === failAt ? 'sync_failed' : 'ok' };
      },
    },
    './reply-sync-policy': {
      mailboxSweepDue: () => ({ due: true, reason: 'never_swept' }),
      SWEEP_MATCH_BUDGET: 5, SWEEP_COLLEAGUE_BUDGET: 5, SWEEP_PAGE_BUDGET: 2, SWEEP_WINDOW_DAYS: 30,
    },
  };
  new Function('require', 'exports', compiled)((name: string) => modules[name], exports);
  const supabase = { from(table: string) {
    if (table === 'cowork_mailbox_sweep_state') return {
      select() { return this; }, eq() { return this; }, limit: async () => ({ data: [], error: null }),
      upsert: async (row: Record<string, unknown>) => { writes.push(row); return { error: null }; },
    };
    if (table === 'contacted_leads') return {
      select() { return this; }, eq() { return this; }, not() { return this; }, gte() { return this; }, order() { return this; },
      limit: async () => ({ data: contacts, error: null }),
    };
    throw new Error(`Unexpected table ${table}`);
  } };
  return { sweep: () => exports.sweepMailboxForOwner(supabase, { organizationId: 'org', userId: 'user', provider: 'gmail' }, Date.parse('2026-09-23T00:00:00Z')), writes, getSynced: () => synced };
}

test('mailbox sweep never completes a page whose matches exceed its processing budget', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).includes('/messages?')
    ? Response.json({ messages: [{ id: 'm1' }] })
    : Response.json({ id: 'm1', internalDate: String(Date.parse('2026-09-22T00:00:00Z')), payload: { headers: [{ name: 'From', value: 'lead@example.test' }] } }));
  const fixture = harness(6);
  const result = await fixture.sweep();
  assert.equal(result.completedWindow, false);
  assert.equal(result.error, 'sweep_match_budget_exceeded');
  assert.equal(fixture.getSynced(), 0);
  assert.equal(fixture.writes.some((write) => write.last_completed_at), false);
  mock.mock.restore();
});

test('mailbox sweep only reports coverage after all matches have synced', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).includes('/messages?')
    ? Response.json({ messages: [{ id: 'm1' }] })
    : Response.json({ id: 'm1', internalDate: String(Date.parse('2026-09-22T00:00:00Z')), payload: { headers: [{ name: 'From', value: 'lead@example.test' }] } }));
  const failed = harness(2, 2);
  const result = await failed.sweep();
  assert.equal(result.completedWindow, false);
  assert.equal(result.error, 'sync_failed');
  assert.equal(failed.writes.some((write) => write.last_completed_at), false);
  const succeeded = harness(2);
  assert.equal((await succeeded.sweep()).completedWindow, true);
  assert.equal(succeeded.writes.some((write) => write.last_completed_at), true);
  mock.mock.restore();
});

// Somebody who is not a contact but works at a company we wrote to is the company answering (stage 6.4).
const SHARED_PROVIDERS = new Set(['gmail.com', 'outlook.com']);
const domainOf = (email: string) => String(email || '').split('@')[1] || '';
const corporate = (email: string) => { const domain = domainOf(email); return domain && !SHARED_PROVIDERS.has(domain) ? domain : null; };
const NOW = Date.parse('2026-09-23T00:00:00Z');
const contact = (id: string, email: string, sentAt: string, extra: Record<string, unknown> = {}) => ({ id, email, sent_at: sentAt, status: 'sent', replied_at: null, ...extra });

function colleagueWorld(input: { contacts: any[]; messages: Array<{ id: string; from: string; at: string }>; own?: string; record?: (row: any, id: string) => unknown }) {
  const calls: Array<{ rowId: string; messageId: string }> = [];
  const writes: Array<Record<string, unknown>> = [];
  const synced: string[] = [];
  const counters = { profile: 0 };
  const exports: any = {};
  const modules: Record<string, unknown> = {
    './reply-sync': {
      mailboxAccessToken: async () => 'token',
      normalizeEmail: (value: string) => String(value || '').toLowerCase(),
      extractEmailAddress: (value: string) => value,
      corporateDomain: corporate,
      isCompanyColleague: (from: string, contactEmail: string) => from !== contactEmail && !/^no-?reply@/.test(from) && corporate(from) !== null && corporate(from) === corporate(contactEmail),
      syncSingleContactRow: async (_supabase: unknown, _organization: string, row: any) => { synced.push(row.id); return { synced: 0, state: 'ok' }; },
      syncColleagueMessage: async (_supabase: unknown, row: any, _token: string, messageId: string) => {
        calls.push({ rowId: row.id, messageId });
        return input.record ? input.record(row, messageId) : { recorded: true, reason: 'recorded' };
      },
    },
    './reply-sync-policy': { mailboxSweepDue: () => ({ due: true, reason: 'never_swept' }), SWEEP_MATCH_BUDGET: 5, SWEEP_COLLEAGUE_BUDGET: 5, SWEEP_PAGE_BUDGET: 2, SWEEP_WINDOW_DAYS: 30 },
  };
  new Function('require', 'exports', compiled)((name: string) => modules[name], exports);
  const contacts = input.contacts;
  const supabase = { from(table: string) {
    if (table === 'cowork_mailbox_sweep_state') return {
      select() { return this; }, eq() { return this; }, limit: async () => ({ data: [], error: null }),
      upsert: async (row: Record<string, unknown>) => { writes.push(row); return { error: null }; },
    };
    if (table === 'contacted_leads') return {
      select() { return this; }, eq() { return this; }, not() { return this; }, gte() { return this; }, order() { return this; },
      limit: async () => ({ data: contacts, error: null }),
    };
    throw new Error(`Unexpected table ${table}`);
  } };
  const fetchMock = async (url: any) => {
    const href = String(url);
    if (href.endsWith('/profile')) { counters.profile++; return Response.json({ emailAddress: input.own || 'owner@mine.cl' }); }
    if (href.includes('/messages?')) return Response.json({ messages: input.messages.map(message => ({ id: message.id })) });
    const message = input.messages.find(item => href.includes(`/messages/${item.id}?`));
    if (!message) return new Response('', { status: 404 });
    return Response.json({ id: message.id, internalDate: String(Date.parse(message.at)), payload: { headers: [{ name: 'From', value: message.from }] } });
  };
  return { sweep: () => exports.sweepMailboxForOwner(supabase, { organizationId: 'org', userId: 'user', provider: 'gmail' }, NOW), calls, writes, synced, counters, fetchMock };
}

test('a message from somebody else at a company we wrote to is read and recorded on the latest contact of that company', async (t) => {
  const world = colleagueWorld({
    contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z'), contact('c2', 'lead2@empresa.cl', '2026-09-10T00:00:00Z'), contact('c3', 'lead3@otra.cl', '2026-09-12T00:00:00Z')],
    messages: [{ id: 'm1', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }],
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  const result = await world.sweep();
  assert.deepEqual(world.calls, [{ rowId: 'c2', messageId: 'm1' }]);
  assert.equal(result.colleagues, 1);
  assert.equal(result.synced, 1);
  assert.equal(result.completedWindow, true);
  assert.equal(world.writes.some(write => write.last_completed_at), true);
});

test('what is not a company answering is not read: contacts, the owner, shared providers, automatic mailboxes, older messages, bounced and covered contacts', async (t) => {
  const world = colleagueWorld({
    own: 'owner@mine.cl',
    contacts: [
      contact('lead', 'lead1@empresa.cl', '2026-09-01T00:00:00Z'),
      contact('other', 'lead2@empresa.cl', '2026-09-10T00:00:00Z'),
      contact('inside', 'inside@mine.cl', '2026-09-01T00:00:00Z'),
      contact('free', 'x@gmail.com', '2026-09-01T00:00:00Z'),
      contact('bounced', 'lost@caida.cl', '2026-09-01T00:00:00Z', { status: 'failed' }),
      contact('covered', 'cov@cubierta.cl', '2026-09-01T00:00:00Z', { replied_at: '2026-09-16T00:00:00Z' }),
      contact('late', 'late@tarde.cl', '2026-09-20T00:00:00Z'),
    ],
    messages: [
      { id: 'known', from: 'lead1@empresa.cl', at: '2026-09-15T00:00:00Z' },          // a contact, even with a colleague in the list: the verified-thread pipeline reads it
      { id: 'owner', from: 'boss@mine.cl', at: '2026-09-15T00:00:00Z' },              // the owner's own domain
      { id: 'shared', from: 'y@gmail.com', at: '2026-09-15T00:00:00Z' },              // a shared provider says nothing about a company
      { id: 'robot', from: 'no-reply@empresa.cl', at: '2026-09-15T00:00:00Z' },       // a mailbox nobody answers from
      { id: 'bounced', from: 'grace@caida.cl', at: '2026-09-15T00:00:00Z' },          // the only contact of that company bounced
      { id: 'covered', from: 'grace@cubierta.cl', at: '2026-09-15T00:00:00Z' },       // the company already answered after this
      { id: 'early', from: 'grace@tarde.cl', at: '2026-09-15T00:00:00Z' },            // from before that contact was written to
      { id: 'stranger', from: 'grace@desconocida.cl', at: '2026-09-15T00:00:00Z' },   // a company we never wrote to
    ],
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  const result = await world.sweep();
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.synced, ['lead']);
  assert.equal(result.colleagues, 0);
  assert.equal(result.completedWindow, true);
  assert.equal(world.counters.profile, 1, 'the owner is looked up once, and only when there is a candidate to compare');
});

test('a company that wrote several times is recorded once, by its newest message', async (t) => {
  const world = colleagueWorld({
    contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z')],
    messages: [{ id: 'm3', from: 'grace@empresa.cl', at: '2026-09-17T00:00:00Z' }, { id: 'm2', from: 'luis@empresa.cl', at: '2026-09-16T00:00:00Z' }, { id: 'm1', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }],
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  await world.sweep();
  assert.deepEqual(world.calls, [{ rowId: 'c1', messageId: 'm3' }]);
});

test('the colleague messages a page reads are bounded, and what is left is not lost: it is still unrecorded for the next window', async (t) => {
  const domains = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(letter => `${letter}.cl`);
  const world = colleagueWorld({
    contacts: domains.map((domain, index) => contact(`c${index}`, `lead@${domain}`, '2026-09-01T00:00:00Z')),
    messages: domains.map((domain, index) => ({ id: `m${index}`, from: `grace@${domain}`, at: '2026-09-15T00:00:00Z' })),
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  const result = await world.sweep();
  assert.equal(world.calls.length, 5);
  assert.equal(result.colleagues, 5);
  assert.equal(result.error, undefined);
  assert.equal(result.completedWindow, true);
});

test('a provider failure while reading a colleague message does not complete the window: it is retried', async (t) => {
  const failing = colleagueWorld({
    contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z')],
    messages: [{ id: 'm1', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }],
    record: () => { throw new Error('Gmail message lookup failed (500)'); },
  });
  t.mock.method(globalThis, 'fetch', failing.fetchMock);
  const result = await failing.sweep();
  assert.equal(result.completedWindow, false);
  assert.equal(result.error, 'mailbox_provider_unavailable');
  assert.equal(failing.writes.some(write => write.last_completed_at), false);
});

test('Gmail metadata failures preserve the incomplete window instead of treating messages as absent', async (t) => {
  for (const status of [403, 429, 500]) {
    const world = colleagueWorld({
      contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z')],
      messages: [{ id: 'm1', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }],
    });
    const mock = t.mock.method(globalThis, 'fetch', async (url: any) => String(url).includes('format=metadata')
      ? new Response('', { status }) : world.fetchMock(url));
    try {
      const result = await world.sweep();
      assert.equal(result.completedWindow, false, `HTTP ${status} must not claim full coverage`);
      assert.equal(result.error, 'mailbox_provider_unavailable');
      assert.equal(world.writes.some(write => write.last_completed_at), false);
      assert.deepEqual(world.calls, []);
    } finally { mock.mock.restore(); }
  }
});

test('a message that turns out not to be a reply is read once and the window still completes', async (t) => {
  const world = colleagueWorld({
    contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z')],
    messages: [{ id: 'm1', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }],
    record: () => ({ recorded: false, reason: 'automatic' }),
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  const result = await world.sweep();
  assert.equal(world.calls.length, 1);
  assert.equal(result.colleagues, 0);
  assert.equal(result.synced, 0);
  assert.equal(result.completedWindow, true);
});

test('a message that is gone when it is read does not stop the window, and the others are still read', async (t) => {
  const world = colleagueWorld({
    contacts: [contact('c1', 'lead1@empresa.cl', '2026-09-01T00:00:00Z'), contact('c2', 'lead2@otra.cl', '2026-09-01T00:00:00Z')],
    messages: [{ id: 'gone', from: 'grace@empresa.cl', at: '2026-09-15T00:00:00Z' }, { id: 'here', from: 'luis@otra.cl', at: '2026-09-15T00:00:00Z' }],
    record: (_row, id) => { if (id === 'gone') throw new Error('Gmail message lookup failed (404)'); return { recorded: true, reason: 'recorded' }; },
  });
  t.mock.method(globalThis, 'fetch', world.fetchMock);
  const result = await world.sweep();
  assert.deepEqual(world.calls.map(call => call.messageId), ['gone', 'here']);
  assert.equal(result.colleagues, 1);
  assert.equal(result.error, undefined);
  assert.equal(result.completedWindow, true);
});

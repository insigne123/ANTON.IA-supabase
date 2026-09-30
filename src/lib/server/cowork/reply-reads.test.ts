import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INTERESTED_WAITING_LIMIT, readContactedAccount, readInterestedWaiting, readMailboxCoverage, readMeetingChain,
  readRepliesAttention, readRepliesStalled,
} from './reply-reads';

const scope = { userId: 'user-1', organizationId: 'org-1' };
const LEAD = '00000000-0000-4000-8000-000000000001';

function mockClient(tables: Record<string, { rows?: unknown[]; error?: { message: string } }> = {}) {
  const client = {
    from: (table: string) => {
      const state = tables[table] || {};
      const chain: Record<string, (...args: any[]) => any> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        or: () => chain, gte: () => chain, in: () => chain, not: () => chain, is: () => chain,
        then: (resolve: (value: unknown) => void) => resolve(state.error
          ? { data: null, error: state.error }
          : { data: state.rows ?? [], error: null }),
      };
      return chain;
    },
  } as never;
  return client;
}

test('coverage degrades to unknown when the sweep table is missing', async () => {
  const coverage = await readMailboxCoverage(mockClient(), scope);
  assert.deepEqual(coverage, { gmail: null, outlook: null });
});

test('coverage reports window completion per mailbox', async () => {
  const client = mockClient({ cowork_mailbox_sweep_state: { rows: [
    { provider: 'gmail', window_days: 30, page_token: null, last_completed_at: '2026-09-22T10:00:00.000Z', last_error: null },
    { provider: 'outlook', window_days: 30, page_token: 'skip-1', last_completed_at: null, last_error: 'timeout' },
  ] } });
  const coverage = await readMailboxCoverage(client, scope);
  assert.equal(coverage.gmail?.windowComplete, true);
  assert.equal(coverage.outlook?.windowComplete, false);
  assert.equal(coverage.outlook?.lastError, 'timeout');
});

test('attention separates failures, unclassified and auto replies with actions', async () => {
  const client = mockClient({ contacted_leads: { rows: [
    { id: 'c1', reply_intent: 'delivery_failure', delivery_status: 'bounced', bounce_category: 'mailbox_not_found', replied_at: null },
  ] } });
  const result = await readRepliesAttention(client, scope);
  assert.equal(result.failures[0].action, 'do_not_contact_fix_email');
  assert.equal(result.scope, 'organization_replies');
  assert.ok(result.coverage);
});

test('attention stays generic on database errors', async () => {
  const client = mockClient({ contacted_leads: { error: { message: 'db down' } } });
  await assert.rejects(readRepliesAttention(client, scope), /No se pudieron consultar las respuestas pendientes/);
});

test('stalled applies the 48h interested rule', async () => {
  const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const client = mockClient({ contacted_leads: { rows: [
    { id: 'c1', lead_id: LEAD, replied_at: old, reply_intent: 'positive', conversation_outbound_at: null, data: null },
  ] } });
  const result = await readRepliesStalled(client, scope);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].contactedId, 'c1');
  assert.match(result.rule, /48 horas/);
});

test('account expands one contact to the whole company', async () => {
  const client = mockClient({ contacted_leads: { rows: [
    { id: 'c1', lead_id: LEAD, company: 'Acme SpA', user_id: 'user-1', sent_at: old(), replied_at: null },
    { id: 'c2', lead_id: LEAD, company: 'acme spa', user_id: 'user-2', sent_at: old(), replied_at: old() },
    { id: 'c3', lead_id: LEAD, company: 'Other', user_id: 'user-1', sent_at: old(), replied_at: null },
  ] } });
  function old() { return new Date(Date.now() - 3600000).toISOString(); }
  const result = await readContactedAccount(client, scope, LEAD);
  assert.equal(result.total, 2);
  assert.deepEqual(result.conflicts, ['multiple_owners', 'mixed_replied_pending']);
});

test('meeting chain links outbound, reply and confirmed commitment', async () => {
  const sent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const replied = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const client = mockClient({
    contacted_leads: { rows: [
      { id: 'c1', sent_at: sent, message_id: 'm1', thread_key: 't1', provider: 'gmail',
        data: { commitment: { id: 'k1', kind: 'meeting', title: 'Demo', dueAt: replied, completedAt: replied,
          origin: { replyEventKey: 'e1', threadKey: 't1', derivedAt: replied } } } },
    ] },
    email_events: { rows: [
      { contacted_id: 'c1', event_type: 'reply', event_at: replied, thread_key: 't1', message_id: 'r1', inbound_event_key: 'e1', meta: { preview: 'Hablemos' } },
    ] },
  });
  const result = await readMeetingChain(client, scope, LEAD);
  assert.equal(result.chains[0].verdict, 'complete');
});

test('interested waiting counts an answer that came in this morning, which stalled does not see for 48 hours', async () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
  const client = mockClient({ contacted_leads: { rows: [
    { id: 'fresh', lead_id: LEAD, name: 'Ana', email: 'ana@acme.cl', company: 'Acme', replied_at: hoursAgo(3), reply_intent: 'positive', conversation_outbound_at: null, data: null },
    { id: 'answered', name: 'Luis', email: 'luis@beta.cl', company: 'Beta', replied_at: hoursAgo(30), reply_intent: 'positive', conversation_outbound_at: hoursAgo(20), data: null },
    { id: 'booked', name: 'Eva', email: 'eva@gamma.cl', company: 'Gamma', replied_at: hoursAgo(50), reply_intent: 'meeting_request', conversation_outbound_at: null,
      data: { commitment: { id: 'k1', kind: 'meeting', completedAt: null } } },
    { id: 'old', name: 'Raúl', email: 'raul@delta.cl', company: 'Delta', replied_at: hoursAgo(24 * 20), reply_intent: 'meeting_request', conversation_outbound_at: null, data: null },
  ] } });
  const waiting = await readInterestedWaiting(client, scope);
  assert.deepEqual(waiting.items.map(item => item.contactedId).sort(), ['fresh', 'old']);
  const fresh = waiting.items.find(item => item.contactedId === 'fresh')!;
  assert.equal(fresh.company, 'Acme');
  assert.equal(fresh.daysWaiting, 0);
  assert.equal(waiting.items.find(item => item.contactedId === 'old')!.daysWaiting, 20);
  assert.equal(waiting.truncated, false);
  const stalled = await readRepliesStalled(client, scope);
  assert.deepEqual(stalled.items.map(item => item.contactedId), ['old'], 'the 48 hour rule leaves the reply of this morning out');
  assert.equal(stalled.items[0].company, 'Delta', 'stalled items carry the company too');
});

test('interested waiting says when the page is full, because older replies may be missing', async () => {
  const rows = Array.from({ length: INTERESTED_WAITING_LIMIT }, (_, index) => ({
    id: `c${index}`, replied_at: new Date(Date.now() - 3600000).toISOString(), reply_intent: 'positive', conversation_outbound_at: new Date().toISOString(), data: null,
  }));
  const waiting = await readInterestedWaiting(mockClient({ contacted_leads: { rows } }), scope);
  assert.equal(waiting.items.length, 0);
  assert.equal(waiting.truncated, true);
});

test('interested waiting stays generic on database errors', async () => {
  await assert.rejects(readInterestedWaiting(mockClient({ contacted_leads: { error: { message: 'db down' } } }), scope),
    /No se pudieron consultar los interesados sin respuesta/);
});

function recordingClient() {
  const eqs: Array<{ table: string; key: string; value: unknown }> = [];
  const client = { from: (table: string) => {
    const chain: Record<string, (...args: any[]) => any> = {
      select: () => chain, order: () => chain, limit: () => chain, in: () => chain, not: () => chain, is: () => chain, gte: () => chain, or: () => chain,
      eq: (key: string, value: unknown) => { eqs.push({ table, key, value }); return chain; },
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return chain;
  } } as never;
  return { client, eqs };
}

test('the agenda reads only what the person sent; the team reads stay as they were', async () => {
  const own = recordingClient();
  await readInterestedWaiting(own.client, scope);
  await readRepliesAttention(own.client, scope, { own: true });
  const mine = own.eqs.filter(call => call.table === 'contacted_leads' && call.key === 'user_id');
  assert.equal(mine.length, 4, 'the interested read and the three attention reads');
  assert.ok(mine.every(call => call.value === scope.userId));
  const team = recordingClient();
  await readRepliesAttention(team.client, scope);
  await readRepliesStalled(team.client, scope);
  assert.equal(team.eqs.filter(call => call.table === 'contacted_leads' && call.key === 'user_id').length, 0, 'replies.attention and replies.stalled belong to the team');
});

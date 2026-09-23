import assert from 'node:assert/strict';
import test from 'node:test';
import { accountConflicts, buildMeetingChain, normalizeAccountCompany, selectAccountMembers, selectStalledInterested, STALLED_AFTER_MS } from './reply-followup';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

test('stalled selects interested replies with no follow-up after 48h', () => {
  const rows = [
    { id: 'c1', lead_id: 'l1', name: 'Ana', email: 'ana@x.test', replied_at: daysAgo(5), reply_intent: 'positive', conversation_outbound_at: null, data: null },
    { id: 'c2', replied_at: daysAgo(5), reply_intent: 'meeting_request', conversation_outbound_at: daysAgo(1), data: null },
    { id: 'c3', replied_at: daysAgo(5), reply_intent: 'positive', conversation_outbound_at: null, data: { commitment: { id: 'k1', kind: 'call', title: 'Llamar', dueAt: daysAgo(-1) } } },
    { id: 'c4', replied_at: daysAgo(5), reply_intent: 'auto_reply', conversation_outbound_at: null, data: null },
    { id: 'c5', replied_at: daysAgo(5), reply_intent: 'negative', conversation_outbound_at: null, data: null },
    { id: 'c6', replied_at: daysAgo(1), reply_intent: 'positive', conversation_outbound_at: null, data: null },
    { id: 'c7', replied_at: null, reply_intent: null, conversation_outbound_at: null, data: null },
  ];
  const stalled = selectStalledInterested(rows, NOW);
  assert.deepEqual(stalled.map((item) => item.contactedId), ['c1']);
  assert.equal(stalled[0].daysWaiting, 5);
});

test('stalled threshold is exactly 48 hours', () => {
  const justBefore = new Date(NOW - STALLED_AFTER_MS + 60000).toISOString();
  assert.equal(selectStalledInterested([{ id: 'c', replied_at: justBefore, reply_intent: 'positive' }], NOW).length, 0);
});

test('account groups by exact normalized company only', () => {
  const rows = [
    { id: 'c1', company: 'Acme  SpA' },
    { id: 'c2', company: 'acme spa' },
    { id: 'c3', company: 'Acme SpA Chile' },
    { id: 'c4', company: null },
  ];
  assert.deepEqual(selectAccountMembers(rows, 'ACME SPA').map((row) => row.id), ['c1', 'c2']);
  assert.deepEqual(selectAccountMembers(rows, ''), []);
});

test('account conflicts surface shared work explicitly', () => {
  assert.deepEqual(accountConflicts([
    { id: 'c1', company: 'Acme', user_id: 'u1', replied_at: daysAgo(2) },
    { id: 'c2', company: 'Acme', user_id: 'u2', replied_at: null },
  ]), ['multiple_owners', 'mixed_replied_pending']);
  assert.deepEqual(accountConflicts([{ id: 'c1', company: 'Acme', user_id: 'u1', evaluation_status: 'do_not_contact' }]), ['do_not_contact_present']);
  assert.equal(normalizeAccountCompany('  Acme   SpA '), 'acme spa');
});

test('chain verdict is complete only with verified origin end to end', () => {
  const contact = {
    id: 'c1', sent_at: daysAgo(10), message_id: 'm1', thread_key: 't1', provider: 'gmail',
    data: { commitment: { id: 'k1', kind: 'meeting', title: 'Demo', dueAt: daysAgo(-2), completedAt: daysAgo(-1), origin: { replyEventKey: 'e1', threadKey: 't1', derivedAt: daysAgo(3) } } },
  };
  const events = [{ event_type: 'reply', event_at: daysAgo(4), thread_key: 't1', message_id: 'r1', inbound_event_key: 'e1', meta: { preview: 'Hablemos' } }];
  const complete = buildMeetingChain({ contact, events });
  assert.equal(complete.verdict, 'complete');
  assert.deepEqual(complete.links.map((link) => link.kind), ['outbound', 'inbound', 'commitment', 'meeting_confirmed']);

  const noOrigin = buildMeetingChain({ contact: { ...contact, data: { commitment: { id: 'k1', kind: 'meeting', title: 'Demo', dueAt: daysAgo(-2), completedAt: daysAgo(-1) } } }, events });
  assert.equal(noOrigin.verdict, 'partial');

  const empty = buildMeetingChain({ contact: { id: 'c9' }, events: [] });
  assert.equal(empty.verdict, 'unverified');
});

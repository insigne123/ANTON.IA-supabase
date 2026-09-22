import assert from 'node:assert/strict';
import test from 'node:test';
import { activeTouch, conversationStatus, groupConversations, needsReply } from './contacted-conversations';

const row = (overrides: Record<string, unknown> = {}) => ({ id: 'a', organization_id: 'org', user_id: 'user', email: 'ana@example.com', provider: 'gmail', status: 'replied', replied_at: '2026-09-22T10:00:00Z', ...overrides });

test('a reply needs attention until resolution or a later outbound message', () => {
  assert.equal(needsReply(row() as any), true);
  assert.equal(needsReply(row({ conversation_resolved_at: '2026-09-22T10:01:00Z' }) as any), false);
  assert.equal(needsReply(row({ conversation_outbound_at: '2026-09-22T10:01:00Z' }) as any), false);
});

test('conversation state distinguishes meeting requests, opt-outs and resolved records', () => {
  assert.equal(conversationStatus(row({ reply_intent: 'meeting_request' }) as any), 'Solicitó una reunión');
  assert.equal(conversationStatus(row({ reply_intent: 'unsubscribe' }) as any), 'No contactar · Baja solicitada');
  assert.equal(conversationStatus(row({ conversation_resolved_at: '2026-09-22T10:01:00Z' }) as any), 'Resuelto');
});

test('history groups only same owner/provider/recipient and keeps records', () => {
  const groups = groupConversations([row(), row({ id: 'b', replied_at: null, sent_at: '2026-09-21T10:00:00Z' }), row({ id: 'c', user_id: 'another' })] as any);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(group => group.row.user_id === 'user')?.history.length, 2);
});

test('planned touch is active only when sequence remains active and step is unresolved', () => {
  const touch = { id: 'x', email: 'a', ownerId: 'u', campaignId: 'c', enrollmentId: 'e', kind: 'first_contact' as const, state: 'approved', dueAt: null, enrollmentState: 'active', draftId: null, versionId: null, index: 1, error: null, autoSend: false };
  assert.equal(activeTouch(touch), true);
  assert.equal(activeTouch({ ...touch, state: 'sent' }), false);
  assert.equal(activeTouch({ ...touch, enrollmentState: 'stopped' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { contactRecordEvidence } from './contact-evidence';
const now = '2026-08-31T12:00:00Z';
const row = { id: 'a', sent_at: '2026-08-12T12:00:00Z', replied_at: '2026-08-13T12:00:00Z', reply_intent: 'positive' };

test('fresh DB evidence cannot certify mailbox coverage or a pending reply', () => {
  const result = contactRecordEvidence([row], false, now);
  assert.equal(result.observedTurn.status, 'our_turn');
  assert.equal(result.turn.status, 'unknown');
  assert.equal(result.mailboxSyncedAt, null);
  assert.equal(result.pendingStatus, 'needs_verification');
});
test('later outbound changes recorded turn, not certainty about synchronization', () => {
  const result = contactRecordEvidence([row, { id: 'b', sent_at: '2026-08-14T12:00:00Z' }], false, now);
  assert.equal(result.observedTurn.status, 'their_turn');
  assert.equal(result.turn.status, 'unknown');
});
test('truncated, unclassified, future and failed records cannot certify the recorded turn', () => {
  for (const [rows, truncated] of [
    [[row], true], [[{ ...row, reply_intent: null }], false],
    [[{ ...row, replied_at: '2027-01-01T00:00:00Z' }], false],
    [[{ ...row, delivery_status: 'failed' }], false],
  ] as const) assert.equal(contactRecordEvidence([...rows], truncated, now).observedTurn.status, 'unknown');
});
test('autoresponse is not a human response', () => {
  assert.equal(contactRecordEvidence([{ ...row, reply_intent: 'auto_reply' }], false, now).observedTurn.status, 'their_turn');
});

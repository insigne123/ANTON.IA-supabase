import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countUniqueMeetingRequestContacts,
  countUniquePositiveReplyContacts,
  countUniqueReplyContacts,
  hasReplySignal,
} from '@/lib/antonia-reply-metrics';

test('hasReplySignal detects replies from multiple fields', () => {
  assert.equal(hasReplySignal({ replied_at: '2026-01-01T10:00:00Z' }), true);
  assert.equal(hasReplySignal({ reply_intent: 'positive' }), true);
  assert.equal(hasReplySignal({ last_reply_text: 'Gracias por escribir' }), true);
  assert.equal(hasReplySignal({}), false);
});

test('countUniqueReplyContacts merges lead responses with contacted leads without double counting', () => {
  const contacts = [
    { id: 'c1', lead_id: 'l1', email: 'uno@empresa.com', replied_at: '2026-01-01T10:00:00Z' },
    { id: 'c2', lead_id: 'l2', email: 'dos@empresa.com' },
    { id: 'c3', lead_id: 'l3', email: 'tres@empresa.com', reply_intent: 'meeting_request' },
  ];
  const replies = [
    { contacted_id: 'c1', lead_id: 'l1', type: 'reply' },
    { contacted_id: 'c2', lead_id: 'l2', type: 'reply' },
  ];

  assert.equal(countUniqueReplyContacts(contacts as any[], replies as any[]), 3);
});

test('count positive and meeting request replies uniquely', () => {
  const contacts = [
    { id: 'c1', lead_id: 'l1', email: 'uno@empresa.com', reply_intent: 'positive' },
    { id: 'c2', lead_id: 'l2', email: 'dos@empresa.com', reply_intent: 'meeting_request' },
    { id: 'c3', lead_id: 'l2', email: 'dos@empresa.com', reply_intent: 'meeting_request' },
  ];

  assert.equal(countUniquePositiveReplyContacts(contacts as any[]), 2);
  assert.equal(countUniqueMeetingRequestContacts(contacts as any[]), 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSupliaThreadResponseStepKey, findSupliaActionableReplyCandidate } from './job-transition-helpers';

test('thread response step key is stable and sanitized by contacted id', () => {
  assert.equal(
    buildSupliaThreadResponseStepKey('contacted id/with spaces'),
    'thread_response_contacted_id_with_spaces',
  );
  assert.equal(
    buildSupliaThreadResponseStepKey('contacted id/with spaces'),
    buildSupliaThreadResponseStepKey('contacted id/with spaces'),
  );
  assert.equal(buildSupliaThreadResponseStepKey(''), 'thread_response_unknown');
});

test('actionable reply candidate ignores non-actionable intents and missing contacted ids', () => {
  const candidate = findSupliaActionableReplyCandidate({
    results: [
      { contactedId: 'a', classification: { intent: 'not_interested' } },
      { classification: { intent: 'meeting_request' } },
      { contactedId: 'b', classification: { intent: 'meeting_request' } },
    ],
  });

  assert.equal(candidate?.contactedId, 'b');
});

test('actionable reply candidate returns null when no reply should trigger thread responder', () => {
  const candidate = findSupliaActionableReplyCandidate({
    results: [
      { contactedId: 'a', classification: { intent: 'unsubscribe' } },
      { contactedId: 'b', classification: { intent: 'bounce' } },
      { contactedId: 'c', classification: { intent: 'out_of_office' } },
    ],
  });

  assert.equal(candidate, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationAdvice } from './conversation-advice';
test('uncertain interest needs review; explicit opt-out always blocks', () => {
  const base = { intent: 'positive' as const, sentiment: 'positive' as const, confidence: 0.4, shouldContinue: true };
  assert.equal(conversationAdvice(base, 'reply').action, 'review');
  assert.equal(conversationAdvice({ ...base, intent: 'unsubscribe' }, 'reply').action, 'blocked');
});
test('meeting intent suggests coordination but invents no commitment or date', () => {
  const advice = conversationAdvice({ intent: 'meeting_request', sentiment: 'positive', confidence: 0.9, shouldContinue: false }, 'reply');
  assert.equal(advice.action, 'meeting');
  assert.equal(advice.replyId, 'reply');
  assert.equal('dueAt' in advice, false);
});

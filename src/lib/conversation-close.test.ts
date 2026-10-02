import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_CLOSE_OPTIONS,
  conversationCloseOption,
  conversationCloseRefusal,
  isConversationCloseOutcome,
} from '@/lib/conversation-close';

test('the four outcomes of «Cerrar conversación», each with what happens alone and in a team', () => {
  assert.deepEqual(CONVERSATION_CLOSE_OPTIONS.map(option => option.label), ['Sin acuerdo', 'Ganado', 'No interesado', 'Lo retomo yo']);
  for (const option of CONVERSATION_CLOSE_OPTIONS) {
    assert.ok(option.solo.length > 10 && option.team.length > 10, option.outcome);
    assert.ok(!option.solo.includes('equipo'), `alone, ${option.outcome} does not talk about a team`);
  }
  assert.match(conversationCloseOption('no_deal').team, /libre/);
  assert.match(conversationCloseOption('not_interested').team, /nadie del equipo vuelve a contactarlo/);
  assert.match(conversationCloseOption('keep').team, /Sigue siendo tuyo/);
});

test('the pipeline stage and the follow-ups each outcome sets', () => {
  assert.equal(conversationCloseOption('won').stage, 'closed_won');
  assert.equal(conversationCloseOption('no_deal').stage, 'closed_lost');
  assert.equal(conversationCloseOption('not_interested').stage, 'closed_lost');
  assert.equal(conversationCloseOption('keep').stage, null);
  assert.deepEqual(CONVERSATION_CLOSE_OPTIONS.filter(option => option.doNotContact).map(option => option.outcome), ['not_interested']);
});

test('only the four outcomes are accepted', () => {
  assert.ok(isConversationCloseOutcome('won'));
  for (const value of ['resolved', '', null, undefined, 3, 'WON']) assert.equal(isConversationCloseOutcome(value), false, String(value));
});

test('what the database refuses reads in plain words', () => {
  assert.deepEqual(conversationCloseRefusal({ code: '42501', message: 'not authorized' })?.status, 403);
  assert.match(conversationCloseRefusal({ code: '42501' })!.message, /otra persona del equipo/);
  assert.match(conversationCloseRefusal({ code: '55000', message: 'Contact thread has an in-flight dispatch' })!.message, /envío en curso/);
  assert.equal(conversationCloseRefusal({ code: '55000', message: 'Only an active contact thread can be closed' })?.status, 409);
  assert.equal(conversationCloseRefusal({ code: '22023' })?.status, 400);
  assert.equal(conversationCloseRefusal({ code: 'XX000', message: 'boom' }), null);
});

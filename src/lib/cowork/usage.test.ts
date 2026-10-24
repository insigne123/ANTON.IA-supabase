import assert from 'node:assert/strict';
import test from 'node:test';
import { COWORK_CONVERSATION_CAP, COWORK_DAILY_CAP, coworkUsageLine, coworkUsageShare, coworkUsageWarning } from './usage';

test('the share is whichever cap is closer: the calls or the reserved tokens', () => {
  assert.equal(coworkUsageShare([], COWORK_CONVERSATION_CAP), 0);
  // 20 calls of the coordinator: 10 % of the calls, 12 % of the tokens.
  assert.equal(coworkUsageShare(Array(20).fill(6000), COWORK_CONVERSATION_CAP), 0.12);
  // 150 small calls: 75 % of the calls.
  assert.equal(coworkUsageShare(Array(150).fill(1500), COWORK_CONVERSATION_CAP), 0.75);
  assert.equal(coworkUsageShare(Array(400).fill(6000), COWORK_DAILY_CAP), 1, 'never more than all of it');
});

test('a quiet line for the summary, and a warning only when little is left', () => {
  assert.equal(coworkUsageLine({ conversation: 0.404, today: 0.12 }), 'Uso del asistente: esta conversación 40 % · hoy 12 %');
  assert.equal(coworkUsageWarning(null), null);
  assert.equal(coworkUsageWarning({ conversation: 0.79, today: 0.5 }), null);
  assert.deepEqual(coworkUsageWarning({ conversation: 0.85, today: 0.5 }),
    { text: 'Esta conversación va en el 85 % de su uso del asistente.', newConversation: true });
  // The day's cap goes first: a new conversation does not help with it.
  assert.deepEqual(coworkUsageWarning({ conversation: 0.9, today: 0.82 }),
    { text: 'Llevas el 82 % del uso de hoy del asistente. Se renueva a medianoche, hora de Chile.', newConversation: false });
  assert.equal(coworkUsageWarning({ conversation: 0.2, today: 1 })?.text, 'Llegaste al uso de hoy del asistente. Se renueva a medianoche, hora de Chile.');
});

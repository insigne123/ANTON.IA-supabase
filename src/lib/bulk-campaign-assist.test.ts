import test from 'node:test';
import assert from 'node:assert/strict';
import { BulkAssistInputSchema, validateSequenceProposal } from './bulk-campaign-assist';

const input = { mode: 'sequence', objective: 'Presentar AXIS', audience: 'Recursos humanos', relationship: 'never_contacted', followUpDelays: [3, 7] };
test('sequence requires an explicit schedule and supports zero through four followups', () => {
  assert.equal(BulkAssistInputSchema.safeParse({ ...input, followUpDelays: undefined }).success, false);
  for (let count = 0; count <= 4; count++) assert.equal(BulkAssistInputSchema.safeParse({ ...input, followUpDelays: Array(count).fill(3) }).success, true);
  for (const delays of [[0], [91], [1.5], [1, 1, 1, 1, 1]]) assert.equal(BulkAssistInputSchema.safeParse({ ...input, followUpDelays: delays }).success, false);
});
test('incomplete sequences fail atomically; user delays override model delays', () => {
  const messages = Array.from({ length: 3 }, (_, index) => ({ subject: `Asunto ${index}`, body: `Mensaje ${index}`, delayDays: 90 }));
  assert.deepEqual(validateSequenceProposal({ messages }, [3, 7]).map(value => value.delayDays), [0, 3, 7]);
  assert.throws(() => validateSequenceProposal({ messages: messages.slice(1) }, [3, 7]), /secuencia completa/);
  assert.throws(() => validateSequenceProposal({ messages: messages.map(value => ({ ...value, body: '' })) }, [3, 7]), /secuencia completa/);
});

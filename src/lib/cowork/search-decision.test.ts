import test from 'node:test';
import assert from 'node:assert/strict';
import { runCoworkReadLoop, coworkDecisionSchema } from './agent-loop';

test('unambiguous single matching read preserves search input when model omits query', async () => {
  const calls: string[] = [];
  await runCoworkReadLoop({ message: 'Revisa pendientes', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {},
    execute: async (action, input) => { calls.push(`${action}:${input}`); return { items: [] }; },
    decide: async observations => coworkDecisionSchema.parse(observations.length
      ? { action: 'answer', query: null, leadId: null, answer: { reply: 'Sin registros', document: null } }
      : { action: 'contacted.search', query: null, leadId: null, answer: null,
        reads: [{ action: 'contacted.search', input: 'Rafael' }] }),
  });
  assert.deepEqual(calls, ['contacted.search:Rafael']);
});
test('mismatched read cannot supply a direct search argument', async () => {
  await assert.rejects(runCoworkReadLoop({ message: 'Revisa pendientes', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {}, execute: async () => { assert.fail('must not execute'); },
    decide: async () => coworkDecisionSchema.parse({ action: 'contacted.search', query: null, leadId: null, answer: null,
      reads: [{ action: 'leads.search', input: 'Rafael' }] }),
  }), /Missing tool argument/);
});

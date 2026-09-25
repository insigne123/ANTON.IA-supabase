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
  const feedback: string[] = [];
  // The model is told why and may correct itself; repeating the mistake never executes it.
  await assert.rejects(runCoworkReadLoop({ message: 'Revisa pendientes', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {}, execute: async () => { assert.fail('must not execute'); },
    decide: async (_observations, _mustAnswer, rejections = []) => {
      feedback.push(rejections.map(item => item.reason).join('|'));
      return coworkDecisionSchema.parse({ action: 'contacted.search', query: null, leadId: null, answer: null,
        reads: [{ action: 'leads.search', input: 'Rafael' }] });
    },
  }), /Missing tool argument|budget exhausted/);
  assert.equal(feedback.length, 4);
  assert.equal(feedback[0], '');
  assert.match(feedback[1], /Falta el argumento de la consulta/);
});

test('a corrected decision after a refusal proceeds normally', async () => {
  const calls: string[] = [];
  let attempt = 0;
  const result = await runCoworkReadLoop({ message: 'Busca a Rafael', signal: new AbortController().signal,
    authorize: async () => {}, record: async () => {},
    execute: async (action, input) => { calls.push(`${action}:${input}`); return { items: [] }; },
    decide: async (observations, _mustAnswer, rejections = []) => {
      attempt++;
      if (observations.length) return coworkDecisionSchema.parse({ action: 'answer', query: null, leadId: null, answer: { reply: 'Sin registros de Rafael.', document: null } });
      if (!rejections.length) return coworkDecisionSchema.parse({ action: 'leads.search', query: null, leadId: null, answer: null });
      return coworkDecisionSchema.parse({ action: 'leads.search', query: 'Rafael', leadId: null, answer: null });
    },
  });
  assert.equal(result.reply, 'Sin registros de Rafael.');
  assert.deepEqual(calls, ['leads.search:Rafael']);
  assert.equal(attempt, 3);
});

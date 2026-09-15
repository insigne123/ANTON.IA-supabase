import assert from 'node:assert/strict';
import test from 'node:test';
import { runCoworkReadLoop } from './agent-loop';

const answer = { action: 'answer' as const, query: null, leadId: null, answer: { reply: 'Un contacto encontrado.', document: null } };
const search = { action: 'leads.search' as const, query: 'Logística', leadId: null, answer: null };

test('read loop gives observed results to the next decision and records real queries', async () => {
  let decisions = 0;
  const recorded: unknown[] = [];
  const result = await runCoworkReadLoop({
    message: 'Busca logística', signal: new AbortController().signal, authorize: async () => {},
    decide: async observations => {
      if (decisions++ === 0) return search;
      assert.deepEqual(observations[0].result, { items: [{ name: 'Ejemplo' }] });
      return answer;
    },
    execute: async (action, value) => { assert.equal(action, 'leads.search'); assert.equal(value, 'Logística'); return { items: [{ name: 'Ejemplo' }] }; },
    record: async value => { recorded.push(value); },
  });
  assert.equal(result.reply, 'Un contacto encontrado.');
  assert.equal(recorded.length, 1);
});

test('tool loop is bounded even when the model never finishes', async () => {
  let calls = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: new AbortController().signal, authorize: async () => {},
    decide: async () => search, execute: async () => { calls++; return {}; }, record: async () => {},
  }), /budget exhausted/);
  assert.equal(calls, 3);
});

test('access revoked after a model decision prevents tool execution', async () => {
  let authorized = true;
  let calls = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: new AbortController().signal,
    authorize: async () => { if (!authorized) throw new Error('revoked'); },
    decide: async () => { authorized = false; return search; },
    execute: async () => { calls++; return {}; }, record: async () => {},
  }), /revoked/);
  assert.equal(calls, 0);
});

test('cancellation during a read prevents publication', async () => {
  const controller = new AbortController();
  let records = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Busca', signal: controller.signal, authorize: async () => {}, decide: async () => search,
    execute: async () => { controller.abort(); return {}; }, record: async () => { records++; },
  }));
  assert.equal(records, 0);
});

test('note review requires an observed target and persists before returning', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const proposal = { action: 'crm.propose_note' as const, query: null, leadId: id, note: 'Llamar el lunes', answer: null };
  let proposals = 0;
  const base = {
    message: 'Actualiza la nota', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ items: [{ id }] }), record: async () => {},
    proposeNote: async (leadId: string, note: string) => { assert.equal(leadId, id); assert.equal(note, proposal.note); proposals++; },
  };
  await assert.rejects(runCoworkReadLoop({ ...base, decide: async () => proposal }), /observed/);
  assert.equal(proposals, 0);
  const result = await runCoworkReadLoop({ ...base, decide: async observations => observations.length ? proposal : search });
  assert.match(result.reply, /Revisa/);
  assert.equal(proposals, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkSpecialistsEnabled, prepareCoworkSpecialists, runCoworkSpecialists, type SpecialistTask } from './specialists';
import { runCoworkReadLoop } from './agent-loop';

const tasks: SpecialistTask[] = [
  { role: 'analyst', objective: 'Resumir', evidence: [0] },
  { role: 'verifier', objective: 'Verificar', evidence: [1] },
];
const answer = (index: number) => ({ summary: 'Resultado', findings: [{ text: 'Dato', evidence: [index] }], limitations: [] });

test('queued review resumes synthesis without refreshing tool or specialist budgets', async () => {
  let decisions = 0;
  const options = {
    message: 'Resume', signal: new AbortController().signal, authorize: async () => {},
    resumedObservations: [{ action: 'specialists.review' as const, input: '', result: [{ status: 'uncertain' }] }],
    execute: async () => { throw new Error('Unexpected tool'); },
    record: async () => { throw new Error('Unexpected observation'); },
    review: async () => { throw new Error('Unexpected review'); },
  };
  const result = await runCoworkReadLoop({ ...options, decide: async (observations, mustAnswer) => {
    decisions++; assert.equal(mustAnswer,true); assert.equal(observations[0].action,'specialists.review');
    return { action: 'answer', query: null, leadId: null, answer: { reply: 'Resultado incierto', document: null } };
  } });
  assert.equal(decisions,1); assert.equal(result.reply,'Resultado incierto');
  await assert.rejects(runCoworkReadLoop({ ...options, decide: async () => ({ action: 'leads.search', query: '', leadId: null, answer: null }) }), /final answer/);
});

test('specialists cannot enable paid generation with a legacy operation ledger', () => {
  assert.equal(coworkSpecialistsEnabled({}), false);
  assert.equal(coworkSpecialistsEnabled({ COWORK_SPECIALISTS_ENABLED: 'true' }), false);
  assert.equal(coworkSpecialistsEnabled({ COWORK_OPERATION_LEASES_ENABLED: 'true' }), false);
  assert.equal(coworkSpecialistsEnabled({ COWORK_SPECIALISTS_ENABLED: 'true', COWORK_OPERATION_LEASES_ENABLED: 'true' }), true);
});

test('specialists receive only assigned observations and run concurrently', async () => {
  let active = 0;
  let peak = 0;
  const observed: unknown[][] = [];
  const result = await runCoworkSpecialists(tasks, ['uno', 'dos', 'privado'], {
    authorize: async () => {}, signal: new AbortController().signal,
    invoke: async (task, evidence) => {
      active++; peak = Math.max(peak, active); observed.push(evidence);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return answer(task.evidence[0]);
    },
  });
  assert.equal(peak, 2);
  assert.deepEqual(observed, [[{ index: 0, observation: 'uno' }], [{ index: 1, observation: 'dos' }]]);
  assert.deepEqual(result.map(item => item.role), ['analyst', 'verifier']);
});

test('unknown evidence and oversized context never call a model', async () => {
  let calls = 0;
  const options = { authorize: async () => {}, signal: new AbortController().signal,
    invoke: async () => { calls++; return answer(0); } };
  await assert.rejects(runCoworkSpecialists(tasks, ['one'], options), /Unavailable/);
  await assert.rejects(runCoworkSpecialists([tasks[0]], ['x'.repeat(24001)], options), /budget/);
  await assert.rejects(runCoworkSpecialists([tasks[0], tasks[0]], ['one'], options));
  assert.equal(calls, 0);
});

test('fabricated evidence references are rejected and all active calls settle', async () => {
  let settled = false;
  await assert.rejects(runCoworkSpecialists(tasks, ['one', 'two'], {
    authorize: async () => {}, signal: new AbortController().signal,
    invoke: async task => {
      if (task.role === 'analyst') return answer(2);
      await new Promise(resolve => setImmediate(resolve)); settled = true; return answer(1);
    },
  }), /unavailable evidence/);
  assert.equal(settled, true);
});

test('revocation and cancellation after generation prevent result publication', async () => {
  for (const mode of ['revoke', 'cancel']) {
    let allowed = true;
    const controller = new AbortController();
    await assert.rejects(runCoworkSpecialists([tasks[0]], ['one'], {
      signal: controller.signal,
      authorize: async () => { if (!allowed) throw new Error('Revoked'); },
      invoke: async () => {
        if (mode === 'revoke') allowed = false;
        else controller.abort();
        return answer(0);
      },
    }));
  }
});

test('coordinator delegates once and receives observed specialist results', async () => {
  let turn = 0;
  let reviews = 0;
  const result = await runCoworkReadLoop({
    message: 'Analiza', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({ rows: 2 }), record: async () => {},
    review: async (assigned, observations) => {
      reviews++; assert.equal(assigned.length, 1); assert.equal(observations.length, 1);
      return [{ role: 'analyst', result: answer(0) }];
    },
    decide: async observations => {
      turn++;
      if (turn === 1) return { action: 'leads.search', query: '', leadId: null, answer: null };
      if (turn === 2) return { action: 'specialists.review', specialists: [tasks[0]], query: null, leadId: null, answer: null };
      assert.equal(observations[1].action, 'specialists.review');
      return { action: 'answer', query: null, leadId: null, answer: { reply: 'Listo', document: null } };
    },
  });
  assert.equal(reviews, 1); assert.equal(result.reply, 'Listo');
});

test('second delegation cannot multiply model budget', async () => {
  let turn = 0;
  let reviews = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Analiza', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => ({}), record: async () => {}, review: async () => { reviews++; return []; },
    decide: async () => ++turn === 1
      ? { action: 'leads.search', query: '', leadId: null, answer: null }
      : { action: 'specialists.review', specialists: [tasks[0]], query: null, leadId: null, answer: null },
  }), /budget exhausted/);
  assert.equal(reviews, 1);
});
test('delegated reads preserve the shared budget, role allowlist and observed targets', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const task = { role: 'researcher' as const, objective: 'Consultar', evidence: [0], read: { action: 'leads.get' as const, input: id } };
  assert.equal(prepareCoworkSpecialists([task], [{ result: { items: [{ id }] } }])[0].task.read?.input, id);
  assert.throws(() => prepareCoworkSpecialists([task], [{ result: {} }]), /Unobserved/);
  assert.throws(() => prepareCoworkSpecialists([{ ...task, role: 'analyst' }], [{ result: { id } }]), /tool unavailable/);
  assert.throws(() => prepareCoworkSpecialists([task], [{ result: { id } }, {}, {}]), /shared read budget/);
});

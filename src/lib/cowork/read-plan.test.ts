import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkReadPlanSchema, executeCoworkReadPlan, type CoworkReadPlan } from './read-plan';
import { runCoworkReadLoop } from './agent-loop';

const plan: CoworkReadPlan = [
  { id: 'context', dependsOn: [], read: { action: 'app.context', input: '' } },
  { id: 'metrics', dependsOn: [], read: { action: 'metrics.overview', input: '' } },
  { id: 'campaigns', dependsOn: ['context', 'metrics'], read: { action: 'campaigns.list', input: '' } },
];

test('plan validates the graph and disallows writes before any execution', () => {
  assert.equal(coworkReadPlanSchema.safeParse(plan).success, true);
  for (const invalid of [
    [plan[0], plan[0]],
    [{ ...plan[0], dependsOn: ['missing'] }],
    [{ ...plan[0], dependsOn: ['context'] }],
    [{ ...plan[0], dependsOn: ['metrics'] }, { ...plan[1], dependsOn: ['context'] }],
    [{ ...plan[0], read: { action: 'email.send', input: '' } }],
    [plan[0], { ...plan[0], id: 'other' }],
  ]) assert.equal(coworkReadPlanSchema.safeParse(invalid).success, false);
});

test('independent tasks overlap; dependencies start after durable records', async () => {
  let active = 0;
  let peak = 0;
  const recorded: string[] = [];
  const gates = new Map<string, () => void>();
  const running = executeCoworkReadPlan(plan, {
    signal: new AbortController().signal, authorize: async () => {},
    execute: async read => {
      active++; peak = Math.max(peak, active);
      if (read.action === 'campaigns.list') assert.deepEqual(recorded.sort(), ['context', 'metrics']);
      else await new Promise<void>(resolve => gates.set(read.action, resolve));
      active--;
      return read.action;
    },
    record: async task => { recorded.push(task.id); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(gates.size, 2);
  for (const release of gates.values()) release();
  const results = await running;
  assert.equal(peak, 2);
  assert.deepEqual(results.map(value => value.task.id), ['context', 'metrics', 'campaigns']);
});

test('failed prerequisite blocks dependent work and preserves completed records', async () => {
  const executed: string[] = [];
  const recorded: string[] = [];
  await assert.rejects(executeCoworkReadPlan(plan, {
    signal: new AbortController().signal, authorize: async () => {},
    execute: async read => {
      executed.push(read.action);
      if (read.action === 'metrics.overview') {
        await new Promise(resolve => setImmediate(resolve));
        throw new Error('Unavailable');
      }
      return read.action;
    },
    record: async task => { recorded.push(task.id); },
  }), /Unavailable/);
  assert.deepEqual(recorded, ['context']);
  assert.equal(executed.includes('campaigns.list'), false);
});

test('revocation before publication prevents recording and dependent dispatch', async () => {
  let allowed = true;
  let records = 0;
  await assert.rejects(executeCoworkReadPlan([plan[0]], {
    signal: new AbortController().signal,
    authorize: async () => { if (!allowed) throw new Error('Revoked'); },
    execute: async () => { allowed = false; return 'private'; },
    record: async () => { records++; },
  }), /Revoked/);
  assert.equal(records, 0);
});

test('agent dispatches plan through the same gateway and shared read budget', async () => {
  const records: unknown[] = [];
  let decisions = 0;
  const result = await runCoworkReadLoop({
    message: 'Consulta contexto, métricas y campañas', signal: new AbortController().signal,
    authorize: async () => {}, execute: async action => ({ action }),
    record: async observation => { records.push(observation); },
    decide: async (observations, mustAnswer) => {
      decisions++;
      if (decisions === 1) return { action: 'reads.plan', plan, query: null, leadId: null, answer: null };
      assert.equal(mustAnswer, true);
      assert.equal(observations.length, 3);
      return { action: 'answer', query: null, leadId: null, answer: { reply: 'Listo', document: null } };
    },
  });
  assert.equal(result.reply, 'Listo');
  assert.equal(records.length, 3);
  assert.deepEqual((records[2] as { task: unknown }).task, { id: 'campaigns', dependsOn: ['context', 'metrics'] });
});

test('cancellation after a prerequisite settles blocks dependent reads', async () => {
  const controller = new AbortController();
  let executions = 0;
  await assert.rejects(executeCoworkReadPlan([plan[0], { ...plan[2], dependsOn: ['context'] }], {
    signal: controller.signal, authorize: async () => {},
    execute: async () => { executions++; return 'observed'; },
    record: async () => { controller.abort(); },
  }));
  assert.equal(executions, 1);
});

test('plan cannot bypass budget already consumed by sequential reads', async () => {
  let decisions = 0;
  let executions = 0;
  await assert.rejects(runCoworkReadLoop({
    message: 'Consulta', signal: new AbortController().signal, authorize: async () => {},
    execute: async () => { executions++; return {}; }, record: async () => {},
    decide: async () => {
      decisions++;
      return decisions === 1
        ? { action: 'leads.search', query: '', leadId: null, answer: null }
        : { action: 'reads.plan', plan, query: null, leadId: null, answer: null };
    },
  }), /budget exhausted/);
  assert.equal(executions, 1);
});

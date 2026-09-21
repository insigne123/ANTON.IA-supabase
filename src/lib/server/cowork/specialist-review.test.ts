import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewCoworkEvidence } from './specialist-review';
import { coworkOperationHash } from './operations';
import type { CoworkGatewayDependencies } from '@/lib/cowork/capabilities';
import type { SpecialistTask } from '@/lib/cowork/specialists';

test('completed assignments replay, changed plans cannot buy more model calls', async () => {
  const rows = new Map<string, unknown>();
  const store: Pick<CoworkGatewayDependencies, 'withOperation'> = {
    withOperation: async (scope, operation, execute) => {
      const key = `${scope.runId}:${operation.capability}:${coworkOperationHash(operation.input)}`;
      if (rows.has(key)) return rows.get(key);
      const result = await execute(); rows.set(key, result); return result;
    },
  };
  let calls = 0;
  const tasks: SpecialistTask[] = [{ role: 'analyst', objective: 'Analiza', evidence: [0] }];
  const options = {
    scope: { userId: 'owner', organizationId: 'org', runId: 'run' }, tasks,
    observations: [{ action: 'leads.search' as const, input: '', result: { items: [] } }],
    signal: new AbortController().signal, authorize: async () => {}, store,
    generate: async () => { calls++; return { summary: 'Sin contactos', findings: [], limitations: ['Lista vacía'] }; },
  };
  const first = await reviewCoworkEvidence(options);
  assert.deepEqual(await reviewCoworkEvidence(options), first);
  assert.equal(calls, 1);
  await assert.rejects(reviewCoworkEvidence({ ...options, tasks: [{ ...tasks[0], objective: 'Otro encargo' }] }), /plan.*cambió/);
  assert.equal(calls, 1);
  assert.equal(rows.size, 2);
});

test('invalid assignments never reserve or store unassigned observations', async () => {
  let reservations = 0;
  const stored: unknown[] = [];
  const options = {
    scope: { userId: 'owner', organizationId: 'org', runId: 'run' },
    tasks: [{ role: 'analyst', objective: 'Analiza', evidence: [0] }] as SpecialistTask[],
    observations: [
      { action: 'leads.search' as const, input: '', result: 'assigned' },
      { action: 'leads.search' as const, input: '', result: 'unassigned-private' },
    ],
    signal: new AbortController().signal, authorize: async () => {},
    store: { withOperation: async (_scope, _operation, execute) => {
      reservations++; const result = await execute(); stored.push(result); return result;
    } } as Pick<CoworkGatewayDependencies, 'withOperation'>,
    generate: async () => ({ summary: 'Resumen', findings: [], limitations: [] }),
  };
  await assert.rejects(reviewCoworkEvidence({ ...options, tasks: [{ ...options.tasks[0], evidence: [2] }] }), /Unavailable/);
  assert.equal(reservations, 0);
  await reviewCoworkEvidence(options);
  assert.equal(JSON.stringify(stored).includes('unassigned-private'), false);
});

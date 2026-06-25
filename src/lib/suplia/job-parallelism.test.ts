import test from 'node:test';
import assert from 'node:assert/strict';

import { getSupliaParallelBatchLabel, isSupliaStepRunnable, pickSupliaRunnableStepBatch } from './job-parallelism';

const nowIso = new Date('2026-06-02T02:00:00.000Z').toISOString();

test('non-parallel earliest runnable step runs alone', () => {
  const steps = [
    { id: 'a', step_order: 1, status: 'queued', can_run_in_parallel: false, depends_on_step_ids: [], scheduled_for: nowIso, title: 'A' },
    { id: 'b', step_order: 2, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: nowIso, title: 'B' },
  ];

  assert.deepEqual(pickSupliaRunnableStepBatch(steps, Date.parse(nowIso), 3).map((step) => step.id), ['a']);
});

test('parallel runnable steps batch together up to limit', () => {
  const steps = [
    { id: 'a', step_order: 1, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: nowIso, title: 'A' },
    { id: 'b', step_order: 2, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: nowIso, title: 'B' },
    { id: 'c', step_order: 3, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: nowIso, title: 'C' },
    { id: 'd', step_order: 4, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: nowIso, title: 'D' },
  ];

  assert.deepEqual(pickSupliaRunnableStepBatch(steps, Date.parse(nowIso), 3).map((step) => step.id), ['a', 'b', 'c']);
});

test('future or blocked steps are not runnable', () => {
  const steps = [
    { id: 'done', step_order: 1, status: 'completed', can_run_in_parallel: false, depends_on_step_ids: [], scheduled_for: nowIso, title: 'Done' },
    { id: 'future', step_order: 2, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: [], scheduled_for: '2026-06-03T02:00:00.000Z', title: 'Future' },
    { id: 'blocked', step_order: 3, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: ['missing'], scheduled_for: nowIso, title: 'Blocked' },
    { id: 'ready', step_order: 4, status: 'queued', can_run_in_parallel: true, depends_on_step_ids: ['done'], scheduled_for: nowIso, title: 'Ready' },
  ];

  assert.equal(isSupliaStepRunnable(steps[1], steps, Date.parse(nowIso)), false);
  assert.equal(isSupliaStepRunnable(steps[2], steps, Date.parse(nowIso)), false);
  assert.equal(isSupliaStepRunnable(steps[3], steps, Date.parse(nowIso)), true);
  assert.deepEqual(pickSupliaRunnableStepBatch(steps, Date.parse(nowIso), 3).map((step) => step.id), ['ready']);
});

test('parallel batch label reflects batch size', () => {
  assert.equal(getSupliaParallelBatchLabel([{ title: 'Solo step' }]), 'Solo step');
  assert.equal(getSupliaParallelBatchLabel([{ title: 'A' }, { title: 'B' }]), 'Ejecutando 2 steps en paralelo');
});

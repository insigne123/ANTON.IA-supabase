import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_NATIVE_DRAFT_BATCH_SIZE,
  createNativeDraftBatch,
  type NativeDraftBatchTarget,
} from './native-draft-batch';

function target(index: number): NativeDraftBatchTarget {
  return { leadId: `lead-${index}`, researchSnapshotId: `snapshot-${index}` };
}

test('native draft batches preserve selection order and isolate individual failures', async () => {
  const progress: number[] = [];
  const results = await createNativeDraftBatch({
    targets: [target(1), target(2), target(3)],
    concurrency: 2,
    createDraft: async (item) => {
      if (item.leadId === 'lead-2') throw new Error('evidence unavailable');
      return { draftId: `draft-${item.leadId}` };
    },
    onProgress: (completed) => progress.push(completed),
  });

  assert.deepEqual(results.map((result) => result.target.leadId), ['lead-1', 'lead-2', 'lead-3']);
  assert.equal(results[0].status, 'drafted');
  assert.deepEqual(results[1], {
    status: 'failed',
    target: target(2),
    error: 'evidence unavailable',
  });
  assert.equal(results[2].status, 'drafted');
  assert.deepEqual(progress.slice().sort((left, right) => left - right), [1, 2, 3]);
});

test('native draft batches enforce the product batch limit', async () => {
  const targets = Array.from({ length: MAX_NATIVE_DRAFT_BATCH_SIZE + 5 }, (_, index) => target(index));
  let calls = 0;
  const results = await createNativeDraftBatch({
    targets,
    createDraft: async () => {
      calls += 1;
      return { ok: true };
    },
  });

  assert.equal(results.length, MAX_NATIVE_DRAFT_BATCH_SIZE);
  assert.equal(calls, MAX_NATIVE_DRAFT_BATCH_SIZE);
});

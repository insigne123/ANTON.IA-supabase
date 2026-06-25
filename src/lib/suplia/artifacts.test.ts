import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSupliaArtifactChangeSummary, buildSupliaArtifactRestoreSummary, selectSupliaArtifactUpdateTarget } from './artifacts';
import type { SupliaIntentResult } from './intent';

const updateIntent: SupliaIntentResult = { intent: 'artifact_update', confidence: 0.9, reason: 'test' };
const createIntent: SupliaIntentResult = { intent: 'artifact_create', confidence: 0.9, reason: 'test' };

test('selects active artifact for update intent', () => {
  assert.equal(selectSupliaArtifactUpdateTarget(updateIntent, 'artifact-2', [{ id: 'artifact-1' }, { id: 'artifact-2' }]), 'artifact-2');
});

test('falls back to most recent artifact for update intent', () => {
  assert.equal(selectSupliaArtifactUpdateTarget(updateIntent, null, [{ id: 'artifact-1' }, { id: 'artifact-2' }]), 'artifact-1');
});

test('does not select artifact for create intent', () => {
  assert.equal(selectSupliaArtifactUpdateTarget(createIntent, 'artifact-1', [{ id: 'artifact-1' }]), null);
});

test('builds concise artifact change summary', () => {
  const summary = buildSupliaArtifactChangeSummary('  hazlo mas corto y mas directo  ');
  assert.equal(summary, 'hazlo mas corto y mas directo');
  assert.ok(buildSupliaArtifactChangeSummary('x'.repeat(220)).length <= 180);
});

test('builds safe artifact restore summary', () => {
  assert.equal(buildSupliaArtifactRestoreSummary(3), 'Restaurado desde la version 3.');
  assert.equal(buildSupliaArtifactRestoreSummary(0), 'Restaurado desde la version 1.');
});

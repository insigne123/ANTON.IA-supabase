import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPending, reportStatusLabel } from '../ui/research-state.ts';
test('collection-to-synthesis handoff keeps polling until final document arrives', () => {
  const collection = { status: 'partial', researchSnapshotId: 'snapshot', reportSynthesisV2: null };
  assert.equal(reportPending(collection), true);
  assert.equal(reportStatusLabel(collection), 'Preparando el análisis comercial…');
  assert.equal(reportPending({ ...collection, reportSynthesisV2: { status: 'running' } }), true);
  assert.equal(reportPending({ ...collection, reportDocumentV2: { synthesis: { status: 'completed' } } }), false);
  assert.equal(reportPending({ ...collection, reportSynthesisV2: { status: 'failed_permanent' } }), false);
  assert.equal(reportPending({ status: 'insufficient_data', researchSnapshotId: 'snapshot' }), false);
});

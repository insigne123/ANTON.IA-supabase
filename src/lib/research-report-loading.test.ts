import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicResearchReportDocumentV1 } from '@/ai/flows/synthesize-research-report';
import { draftSnapshotFixture } from '@/lib/server/draft-v2-test-fixtures';
import { parseResearchReportDetail, parseResearchWorkspaceRun } from '@/lib/research-workspace';
import { estimatedResearchProgress, researchDetailLoadingState, researchItemPresentation, researchReportLoadingState } from './research-report-loading';

test('raw evidence never becomes a report while research or editorial work is pending', () => {
  for (const status of ['queued', 'running', 'retry_scheduled'] as const) {
    const state = researchReportLoadingState({ status: 'partial', snapshotId: 'snapshot', document: {}, synthesis: { status } });
    assert.equal(state.pending, true);
    assert.equal(state.showReport, false);
  }
  assert.equal(researchReportLoadingState({ status: 'completed', snapshotId: 'snapshot' }).pending, true);
  for (const status of ['failed', 'cancelled'] as const) {
    assert.equal(researchReportLoadingState({ status, snapshotId: 'snapshot' }).pending, false);
  }
  for (const status of ['completed', 'partial'] as const) {
    assert.equal(researchReportLoadingState({ status: 'completed', synthesis: { status } }).unavailable, true);
    assert.equal(researchReportLoadingState({ status: 'completed', document: {}, synthesis: { status } }).showReport, true);
  }
});

test('preferred V2 waits through V1 completion; terminal V2 failure permits historical V1, not drafting', () => {
  const snapshot = draftSnapshotFixture();
  const reportDocument = buildDeterministicResearchReportDocumentV1({ snapshot, generatedAt: '2026-08-22T12:00:00.000Z' });
  const payload = { status: 'completed', researchSnapshotId: snapshot.id, snapshot, reportDocument,
    reportSynthesis: { status: 'completed' }, preferredReportSchemaVersion: 'research-report-document/v2' };
  for (const status of [null, 'queued', 'running', 'retry_scheduled', 'failed_permanent'] as const) {
    const detail = parseResearchReportDetail({ ...payload, reportSyntheses: status ? [{ schemaVersion: 'research-report-document/v2', synthesis: { status } }] : [] })!;
    const state = researchDetailLoadingState(detail);
    assert.equal(state.pending, status !== 'failed_permanent');
    assert.equal(state.showReport, status === 'failed_permanent');
    assert.equal(state.failed, status === 'failed_permanent');
  }
  const legacy = parseResearchReportDetail({ ...payload, preferredReportSchemaVersion: 'research-report-document/v1' })!;
  assert.equal(researchDetailLoadingState(legacy).showReport, true);
});

test('terminal V1 failure without a document stops polling and retry resumes it', () => {
  const failed = parseResearchReportDetail({ status: 'partial', researchSnapshotId: 'snapshot', reportSynthesis: { status: 'failed_permanent' } })!;
  assert.equal(researchDetailLoadingState(failed).failed, true);
  assert.equal(researchDetailLoadingState(failed).pending, false);
  const retry = { ...failed, preferredReportSynthesis: { ...failed.preferredReportSynthesis!, status: 'queued' as const } };
  assert.equal(researchDetailLoadingState(retry).pending, true);
});

test('rail labels and drafting follow editorial state, including load errors', () => {
  const item = parseResearchWorkspaceRun({ id: 'run', items: [{ id: 'item', status: 'completed', job: { researchSnapshotId: 'snapshot', resultPayload: { status: 'completed', researchSnapshotId: 'snapshot' } } }] }, [])!.items[0];
  item.readiness = 'ready';
  item.canCreateDraft = true;
  assert.equal(researchItemPresentation(item).status, 'running');
  assert.equal(researchItemPresentation(item).canCreateDraft, false);
  assert.equal(researchItemPresentation(item, null, true).readiness, 'needs_attention');
  const detail = parseResearchReportDetail({ status: 'completed', researchSnapshotId: 'snapshot', reportSynthesis: { status: 'failed_permanent' } })!;
  assert.equal(researchItemPresentation(item, detail).status, 'failed');
  assert.equal(researchItemPresentation(item, detail).canCreateDraft, false);
});

test('elapsed estimate advances beyond two minutes, survives remounts and never reaches 100', (t) => {
  const start = '2026-09-09T12:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  let previous = 0;
  for (let second = 1; second <= 600; second++) {
    t.mock.timers.tick(1000);
    const progress = estimatedResearchProgress(start, Date.now());
    assert.ok(progress.value > previous && progress.value < 95);
    assert.equal(progress.longRunning, second >= 120);
    previous = progress.value;
  }
  assert.equal(estimatedResearchProgress(start, Date.now()).value, previous);
  assert.equal(estimatedResearchProgress(new Date(Date.now()).toISOString(), Date.now()).value, 0);
  assert.equal(estimatedResearchProgress(start, Date.now()).value, previous);
  assert.equal(estimatedResearchProgress('invalid', Date.now()).hasStart, false);
  assert.equal(estimatedResearchProgress('2099-01-01', Date.now()).value, 0);
});

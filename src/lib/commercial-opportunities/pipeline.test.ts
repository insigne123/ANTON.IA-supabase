import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticMove, automaticUndo, daysToClose, pipelineStage } from './pipeline';

test('each opportunity sits in one stage: the work state once someone works it, the AI evaluation before', () => {
  const item = (evaluation?: string) => ({ kind: 'tender', data: { evaluation } }) as any;
  assert.equal(pipelineStage(item('recommended')), 'recommended');
  assert.equal(pipelineStage(item('review')), 'found');
  assert.equal(pipelineStage(item(undefined)), 'found');
  assert.equal(pipelineStage(item('excluded')), 'excluded');
  assert.equal(pipelineStage(item('excluded'), { state: 'assigned' }), 'assigned', 'assigned overrides the evaluation');
  assert.equal(pipelineStage(item('recommended'), { state: 'blocked' }), 'working');
  for (const state of ['submitted', 'won', 'lost', 'archived'] as const) assert.equal(pipelineStage(item('recommended'), { state }), state);
});

test('the work moves the stage on its own, forward only and with a reason', () => {
  assert.deepEqual(automaticMove('assigned', { kind: 'report_ready' }), { to: 'working', reason: 'el informe quedó listo' });
  assert.deepEqual(automaticMove('assigned', { kind: 'marked_done', label: 'Pedir la boleta' }), { to: 'working', reason: 'se marcó «Pedir la boleta»' });
  assert.deepEqual(automaticMove('assigned', { kind: 'task_started' }), { to: 'working', reason: 'empezó una tarea' });
  assert.deepEqual(automaticMove('working', { kind: 'marked_done', routeKind: 'submit', label: 'Subir la oferta al portal' })?.to, 'submitted');
  assert.deepEqual(automaticMove('blocked', { kind: 'marked_done', label: 'Presentar la oferta en Mercado Público' })?.to, 'submitted');
  assert.equal(automaticMove('working', { kind: 'report_ready' }), null, 'already in preparation');
  assert.equal(automaticMove('working', { kind: 'marked_done', label: 'Revisar la oferta técnica' }), null, 'reviewing is not submitting');
  for (const closed of ['submitted', 'won', 'lost', 'archived', 'unassigned'] as const)
    assert.equal(automaticMove(closed, { kind: 'marked_done', routeKind: 'submit', label: 'Subir la oferta' }), null, closed);
});

test('days to close count whole days and go negative once closed', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  assert.equal(daysToClose('2026-10-18T12:00:00Z', now), 2);
  assert.equal(daysToClose('2026-10-16T15:00:00Z', now), 1);
  assert.equal(daysToClose('2026-10-15T12:00:00Z', now), -1);
  assert.equal(daysToClose(null, now), null);
});

test('taking back the tick of the step to submit returns the opportunity to preparation only when that tick moved it', () => {
  const submit = { routeKind: 'submit', label: 'Subir la oferta al portal' };
  assert.deepEqual(automaticUndo('submitted', submit, { kind: 'auto_state', to: 'submitted' }), { to: 'working', reason: 'se desmarcó «Subir la oferta al portal»' });
  assert.equal(automaticUndo('submitted', { label: 'Presentar la oferta' }, { kind: 'auto_state', to: 'submitted' })?.to, 'working', 'the same step by its name');
  assert.equal(automaticUndo('submitted', submit, { kind: 'state', to: null }), null, 'a stage a person chose stays');
  assert.equal(automaticUndo('submitted', submit, { kind: 'auto_state', to: 'working' }), null);
  assert.equal(automaticUndo('submitted', submit, null), null);
  assert.equal(automaticUndo('submitted', { routeKind: 'prepare', label: 'Reunir los certificados' }, { kind: 'auto_state', to: 'submitted' }), null, 'another step does not undo it');
  for (const state of ['working', 'won', 'lost', 'archived', 'assigned', null, undefined] as const) assert.equal(automaticUndo(state, submit, { kind: 'auto_state', to: 'submitted' }), null, String(state));
});

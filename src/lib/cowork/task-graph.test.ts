import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkStoredTaskProgress, coworkTaskGraph, coworkTaskProgress, coworkTaskReadyNode } from './task-graph';
const plan = { goal: 'Preparar contactos y campaña pausada', steps: [{ kind: 'prepare' as const, label: 'Preparar los contactos' },
  { kind: 'write' as const, label: 'Escribir el correo' }, { kind: 'campaign' as const, label: 'Guardar campaña pausada' }], limits: { searches: 0, credits: 2 } };
test('admission and queued research do not unlock writing; delivered references and dependencies persist', () => {
  const admitted = { runId: 'prepare-run', kind: 'task.step', payload: { kind: 'lead_prepare_batch', stepId: 'root:step:1', targets: ['lead1'] } };
  const queued = { runId: 'prepare-run', kind: 'effect.completed', payload: { kind: 'lead_prepare_batch', result: { items: [{ id: 'lead1', status: 'ready', research: 'queued' }] } } };
  assert.equal(coworkTaskReadyNode(coworkTaskGraph('root', plan, [admitted, queued]), 'write'), undefined);
  const completedResearch = { runId: 'notice-run', kind: 'tool.completed', payload: { action: 'research.get_existing', input: 'lead1', result: { availability: 'available', research: { status: 'completed' } } } };
  assert.equal(coworkTaskReadyNode(coworkTaskGraph('root', plan, [admitted, queued, completedResearch]), 'write')?.id, 'root:step:2');
  const ready = { ...queued, payload: { kind: 'lead_prepare_batch', result: { items: [{ id: 'lead1', status: 'ready', research: 'completed' }] } } };
  const written = { runId: 'write-run', kind: 'run.completed', payload: { blocks: [{ type: 'email_draft', subject: 'hola', body: 'Texto' }] } };
  const graph = coworkTaskGraph('root', plan, [admitted, ready, written]);
  assert.deepEqual(graph.map(node => node.state), ['succeeded', 'succeeded', 'pending']);
  assert.deepEqual(graph[0].targets, ['lead1']); assert.deepEqual(graph[1].resultRefs, ['write-run:block:0']);
  assert.equal(coworkTaskReadyNode(graph, 'campaign')?.id, 'root:step:3');
});
test('a partially prepared batch keeps later dependencies blocked', () => {
  const graph = coworkTaskGraph('root', plan, [{ runId: 'prepare-run', kind: 'effect.completed', payload: { kind: 'lead_prepare_batch',
    result: { items: [{ id: 'lead1', status: 'ready', research: 'completed' }, { id: 'lead2', status: 'partial' }] } } }]);
  assert.deepEqual(graph.map(node => node.state), ['partial', 'blocked', 'blocked']);
});
test('a campaign carries its own emails: proposed right after the contacts, it is ready, and created it delivers the write step too', () => {
  const ready = { runId: 'prepare-run', kind: 'effect.completed', payload: { kind: 'lead_prepare_batch', result: { items: [{ id: 'lead1', status: 'ready' }] } } };
  assert.equal(coworkTaskReadyNode(coworkTaskGraph('root', plan, []), 'campaign'), undefined, 'not before the contacts');
  assert.equal(coworkTaskReadyNode(coworkTaskGraph('root', plan, [ready]), 'campaign')?.id, 'root:step:3');
  const created = { runId: 'campaign-run', kind: 'effect.completed', payload: { kind: 'campaign_create', result: { campaignId: 'c1', status: 'paused' } } };
  const graph = coworkTaskGraph('root', plan, [ready, created]);
  assert.deepEqual(graph.map(node => node.state), ['succeeded', 'succeeded', 'succeeded']);
  assert.deepEqual(graph[1].resultRefs, ['campaign-run:campaign']);
  assert.ok(graph[2].resultRefs.includes('campaign:c1'));
});

test('the conversation shows each step as done, the one it goes on with, still to come or with something to look at', () => {
  const written = { runId: 'write-run', kind: 'run.completed', payload: { blocks: [{ type: 'email_draft', subject: 'hola', body: 'Texto' }] } };
  const ready = { runId: 'prepare-run', kind: 'effect.completed', payload: { kind: 'lead_prepare_batch', result: { items: [{ id: 'lead1', status: 'ready' }] } } };
  assert.deepEqual(coworkTaskProgress(plan.goal, coworkTaskGraph('root', plan, [])).steps.map(step => step.state), ['current', 'pending', 'pending']);
  const progress = coworkTaskProgress(plan.goal, coworkTaskGraph('root', plan, [ready, written]));
  assert.deepEqual(progress, { goal: plan.goal, steps: [{ label: 'Preparar los contactos', state: 'done' }, { label: 'Escribir el correo', state: 'done' },
    { label: 'Guardar campaña pausada', state: 'current' }] });
  const partial = { ...ready, payload: { kind: 'lead_prepare_batch', result: { items: [{ id: 'lead1', status: 'partial' }] } } };
  assert.deepEqual(coworkTaskProgress(plan.goal, coworkTaskGraph('root', plan, [partial])).steps.map(step => step.state), ['attention', 'pending', 'pending']);
  // What the page reads back: the same shape, or nothing.
  assert.deepEqual(coworkStoredTaskProgress(progress), progress);
  for (const bad of [null, 'x', { goal: '', steps: progress.steps }, { goal: 'x', steps: progress.steps.slice(0, 1) }, { goal: 'x', steps: [...progress.steps.slice(0, 2), { label: 'y', state: 'running' }] }]) {
    assert.equal(coworkStoredTaskProgress(bad), null);
  }
});

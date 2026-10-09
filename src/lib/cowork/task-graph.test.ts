import test from 'node:test';
import assert from 'node:assert/strict';
import { coworkTaskGraph, coworkTaskReadyNode } from './task-graph';
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

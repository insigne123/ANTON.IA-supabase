import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPipelineFlow, flowStage, formatPercent } from '@/lib/pipeline-flow';
import type { UnifiedRow } from '@/lib/unified-sheet-types';

const NOW = Date.parse('2026-10-02T12:00:00Z'); // a Friday
const row = (gid: string, stage: string | null, patch: Partial<UnifiedRow> = {}): UnifiedRow =>
  ({ gid, sourceId: gid, status: 'saved', kind: 'lead_saved', name: gid, stage, ...patch } as UnifiedRow);

const rows = [
  row('a', null), row('b', 'inbox'), row('c', 'legacy_unknown'),
  row('d', 'contacted'), row('e', 'contacted'), row('f', 'contacted'), row('g', 'contacted'),
  row('h', 'engaged'), row('i', 'meeting'), row('j', 'closed_won'), row('k', 'closed_lost'), row('l', 'closed_lost'),
];

test('each lead counts once, in its stage; unknown or empty stages are «Nuevos» like the board', () => {
  assert.equal(flowStage({ stage: 'legacy_unknown' }), 'inbox');
  const flow = buildPipelineFlow(rows, { now: NOW });
  assert.deepEqual(flow.nodes.map(node => [node.stage, node.count]), [
    ['inbox', 3], ['qualified', 0], ['contacted', 4], ['engaged', 1], ['meeting', 1], ['negotiation', 0], ['closed_won', 1],
  ]);
  assert.equal(flow.lost.count, 2);
  assert.equal(flow.total, 12);
});

test('conversion is the share of those that reached a stage that reached the next; lost leads stay out of the flow', () => {
  const flow = buildPipelineFlow(rows, { now: NOW });
  const node = (stage: string) => flow.nodes.find(item => item.stage === stage)!;
  assert.equal(node('inbox').reached, 10);
  assert.equal(node('contacted').reached, 7);
  assert.equal(node('contacted').conversionToNext, 3 / 7);
  assert.equal(node('meeting').conversionToNext, 1 / 2);
  assert.equal(node('closed_won').conversionToNext, null);
  assert.equal(node('negotiation').conversionToNext, 1);
  assert.equal(buildPipelineFlow([], { now: NOW }).nodes[0].conversionToNext, null);
});

test('the figures: active, response rate, meetings and won', () => {
  const flow = buildPipelineFlow(rows, { now: NOW });
  assert.deepEqual(flow.kpis, { active: 9, responseRate: 3 / 7, meetings: 2, won: 1 });
  assert.equal(formatPercent(flow.kpis.responseRate), '43 %');
  assert.equal(buildPipelineFlow([row('x', 'inbox')], { now: NOW }).kpis.responseRate, null);
  assert.equal(formatPercent(null), '—');
});

test('the five most recently updated leads of each stage', () => {
  const many = Array.from({ length: 7 }, (_, index) => row(`r${index}`, 'contacted', { updatedAt: `2026-09-2${index}T10:00:00Z` }));
  const flow = buildPipelineFlow(many, { now: NOW });
  assert.deepEqual(flow.nodes.find(node => node.stage === 'contacted')!.recent.map(lead => lead.gid), ['r6', 'r5', 'r4', 'r3', 'r2']);
});

test('the weekly trend counts new leads per week, Monday to Sunday, for the last 8 weeks', () => {
  const flow = buildPipelineFlow([
    row('w1', 'inbox', { createdAt: '2026-09-28T09:00:00Z' }), // Monday of this week
    row('w2', 'inbox', { createdAt: '2026-10-02T09:00:00Z' }),
    row('w3', 'inbox', { createdAt: '2026-09-27T23:00:00Z' }), // Sunday of the week before
    row('w4', 'inbox', { createdAt: '2026-08-01T00:00:00Z' }), // before the window
    row('w5', 'inbox', { createdAt: null }),
  ], { now: NOW });
  assert.equal(flow.weekly.length, 8);
  assert.equal(flow.weekly[7].weekStart, '2026-09-28');
  assert.equal(flow.weekly[7].count, 2);
  assert.equal(flow.weekly[6].count, 1);
  assert.equal(flow.weekly.reduce((sum, week) => sum + week.count, 0), 3);
  assert.equal(flow.weekly[0].weekStart, '2026-08-10');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedRow } from '@/lib/unified-sheet-types';
import { OPEN_STAGES, buildPipelineDashboard, filterPipelineRows, monthKey, pipelineOwners, trendText } from './pipeline-dashboard';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const lead = (gid: string, patch: Partial<UnifiedRow> = {}): UnifiedRow => ({
  gid, sourceId: gid, status: 'saved', kind: 'lead_saved', name: gid, stage: 'inbox', createdAt: daysAgo(3), updatedAt: daysAgo(3), ...patch,
});
const send = (gid: string, sentDaysAgo: number, replied = false, patch: Partial<UnifiedRow> = {}) =>
  lead(gid, { kind: 'contacted', status: replied ? 'replied' : 'sent', stage: replied ? 'engaged' : 'contacted', sentAt: daysAgo(sentDaysAgo), createdAt: daysAgo(sentDaysAgo), updatedAt: daysAgo(sentDaysAgo), ...patch });

test('the figures compare the period with the one before, only where there are dates to compare', () => {
  const rows = [
    lead('nuevo-1', { createdAt: daysAgo(2) }), lead('nuevo-2', { createdAt: daysAgo(10) }), lead('viejo', { createdAt: daysAgo(40) }),
    send('a', 5, true), send('b', 6), send('c', 20, true), send('d', 25), send('e', 35, true), send('f', 50),
    lead('reunion', { stage: 'meeting' }), lead('ganado', { stage: 'closed_won' }), lead('perdido', { stage: 'closed_lost' }), lead('perdido-2', { stage: 'closed_lost' }),
  ];
  const panel = buildPipelineDashboard(rows, { now: NOW, period: '30d' });
  assert.equal(panel.period.label, 'Últimos 30 días');
  assert.deepEqual(panel.newLeads, { value: 6, previous: 1, delta: 5, direction: 'up' }, 'people added, not conversations');
  assert.deepEqual(panel.contacted, { value: 4, previous: 2, delta: 2, direction: 'up' });
  assert.deepEqual(panel.responseRate, { value: 0.5, previous: 0.5, deltaPoints: 0 }, 'of those contacted in each period, how many replied');
  assert.equal(panel.total, rows.length);
  assert.equal(panel.open, rows.length - 3, 'won and lost are not open');
  assert.equal(panel.won, 1);
  assert.equal(panel.lost, 2);
  assert.equal(Math.round((panel.winRate || 0) * 100), 33);
  assert.equal(panel.meetings, 2, 'reunión or later, won included');
});

test('the donut is the open pipeline by stage, in order, and its shares add up to the whole', () => {
  const rows = [lead('a'), lead('b', { stage: 'qualified' }), send('c', 2), send('d', 2), lead('e', { stage: 'negotiation' }), lead('f', { stage: 'closed_won' }), lead('g', { stage: null })];
  const panel = buildPipelineDashboard(rows, { now: NOW });
  assert.deepEqual(panel.stages.map(slice => slice.stage), OPEN_STAGES);
  assert.deepEqual(panel.stages.map(slice => slice.count), [2, 1, 2, 0, 0, 1], 'a lead without stage counts as Nuevos, like the board');
  assert.equal(Math.round(panel.stages.reduce((sum, slice) => sum + slice.share, 0) * 1000) / 1000, 1);
  assert.equal(panel.funnel[0].reached, 7, 'everyone not lost reached Nuevos');
  assert.equal(panel.funnel.at(-1)?.stage, 'closed_won');
});

test('months run 13 back in Chilean time, and the reference is the average of the three months before this one', () => {
  assert.equal(monthKey(Date.parse('2026-10-01T02:00:00Z')), '2026-09', 'still September in Santiago');
  const rows = [send('jul', 75), send('ago-1', 45), send('ago-2', 46, true), send('sep', 20, true), send('oct', 2), lead('nuevo', { createdAt: daysAgo(1) })];
  const panel = buildPipelineDashboard(rows, { now: NOW });
  assert.equal(panel.months.length, 13);
  assert.equal(panel.months.at(-1)?.key, '2026-10');
  assert.equal(panel.months[0].key, '2025-10');
  const byKey = Object.fromEntries(panel.months.map(month => [month.key, month]));
  assert.equal(byKey['2026-08'].contacted, 2);
  assert.equal(byKey['2026-08'].replied, 1);
  assert.equal(byKey['2026-08'].responseRate, 0.5);
  assert.equal(byKey['2026-10'].newLeads, 1);
  assert.equal(panel.contactedThreshold, Math.round(((1 + 2 + 1) / 3) * 10) / 10, 'July, August and September');
  assert.equal(buildPipelineDashboard([], { now: NOW }).contactedThreshold, null, 'no history, no reference line');
});

test('the panel reads itself: contacts against the period before, replies, and the stage where leads stall', () => {
  const stalled = ['x', 'y', 'z', 'w'].map(gid => send(gid, 40));
  const rows = [send('a', 3, true), send('b', 4), send('c', 5, true), send('d', 40), ...stalled];
  const panel = buildPipelineDashboard(rows, { now: NOW, period: '30d' });
  const text = panel.insights.map(insight => insight.text);
  assert.equal(text[0], 'En últimos 30 días contactaste a 3 personas, 2 menos que en los 30 días anteriores.');
  assert.match(text[1], /^Respondió el 67 % de quienes contactaste, más que en los 30 días anteriores \(0 %\)\.$/);
  assert.equal(panel.insights[2].stage, 'contacted');
  assert.match(text[2], /«Contactado» tiene 5 leads sin movimiento hace más de 14 días/);
  assert.deepEqual(buildPipelineDashboard([], { now: NOW }).insights.map(insight => insight.id), ['empty']);
});

test('filters keep one owner and one origin, and the owners are listed once', () => {
  const rows = [lead('a', { owner: 'Ana Pérez' }), lead('b', { owner: 'ana perez' }), lead('c', { owner: 'Luis' }), send('d', 2, false, { owner: 'Ana Pérez' })];
  assert.deepEqual(filterPipelineRows(rows, { owner: 'Ana Pérez' }).map(row => row.gid), ['a', 'b', 'd']);
  assert.deepEqual(filterPipelineRows(rows, { owner: 'Ana Pérez', origin: 'contacted' }).map(row => row.gid), ['d']);
  assert.equal(filterPipelineRows(rows, { owner: 'all', origin: 'all' }).length, 4);
  assert.deepEqual(pipelineOwners(rows), ['ana perez', 'Ana Pérez', 'Luis']);
  assert.equal(trendText(4, 'los 30 días anteriores'), '+4 vs los 30 días anteriores');
  assert.equal(trendText(-2, 'el año anterior'), '−2 vs el año anterior');
  assert.equal(trendText(0, 'los 7 días anteriores'), 'igual que los 7 días anteriores');
});
